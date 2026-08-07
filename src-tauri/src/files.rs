//! Filesystem commands: reading a file's bytes, saving the database atomically,
//! rotating backups, exporting bytes, and the lock that serializes writers
//! across Kivarion processes.
//!
//! All database/attachment file I/O lives in the backend so the webview never
//! holds a broad `fs` scope. The frontend can only invoke these specific
//! operations on a path the user picked through a native dialog (or the saved
//! last-database path). This keeps an XSS-compromised frontend from reading or
//! writing arbitrary files under the user's home directory.
//!
//! The absence of an `fs` capability is not what enforces that: `invoke` reaches
//! these commands regardless, so each one that takes a path runs it past the
//! allowlist in `access.rs` first. A path enters the allowlist only by being
//! picked in a (backend-owned) native dialog or by being the remembered database
//! or its key file.
//!
//! Every command here is `async` and hands its blocking work to
//! [`crate::run_blocking`] — see the threading note in `lib.rs` for why even a
//! bare `stat` goes through it.

use crate::access::{Access, PathAccess};
use crate::{arg, process_is_running, raw_body, run_blocking, with_suffix};

/// Read a file's raw bytes (used to load the selected `.kdbx`, a rotated backup,
/// a key file, or a user-picked attachment source).
///
/// Returned as a raw IPC `Response` so the bytes reach the webview as an
/// `ArrayBuffer` instead of an inflated JSON number array.
#[tauri::command]
pub async fn read_database(
    path: String,
    access: tauri::State<'_, PathAccess>,
) -> Result<tauri::ipc::Response, String> {
    let path = access.check(&path, Access::Read)?;

    let bytes = run_blocking(move || std::fs::read(&path))
        .await?
        .map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Marker prefix returned when the on-disk file changed since the caller last
/// read it (another app instance or external program wrote to it). The frontend
/// detects this prefix to offer an "overwrite anyway" choice instead of silently
/// clobbering the other writer's changes.
const CONFLICT_PREFIX: &str = "EXTERNAL_CONFLICT";

/// Upper bound when scanning rotated backup slots. The retention depth the UI
/// allows is far below this; the slack exists so slots left behind by a larger
/// depth used earlier are still found — both to clean them up and to keep them
/// listed for restore.
const MAX_BACKUP_SLOTS: u32 = 64;

/// `<path>.bak` for index 0, `<path>.bak.N` for N ≥ 1.
fn backup_path(target: &std::path::Path, index: u32) -> std::path::PathBuf {
    if index == 0 {
        with_suffix(target, ".bak")
    } else {
        with_suffix(target, &format!(".bak.{index}"))
    }
}

/// Lock file used to serialize writers across Kivarion processes.
fn lock_path(target: &std::path::Path) -> std::path::PathBuf {
    with_suffix(target, ".lock")
}

const STALE_LOCK_MS: u128 = 2 * 60 * 1000;

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn parse_lock_field<'a>(contents: &'a str, key: &str) -> Option<&'a str> {
    contents.split_whitespace().find_map(|part| {
        let (part_key, value) = part.split_once('=')?;
        (part_key == key).then_some(value)
    })
}

fn parse_lock_value(contents: &str, key: &str) -> Option<u128> {
    parse_lock_field(contents, key).and_then(|value| value.parse::<u128>().ok())
}

/// Keeps a lock-file value on one whitespace-free token. The id is only ever
/// compared against this machine's own, so mangling an exotic hostname is
/// harmless — two machines whose ids collide simply fall back to the PID check.
fn sanitize_lock_value(value: &str) -> String {
    value
        .trim()
        .chars()
        .take(64)
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':') {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn read_machine_id() -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        for path in ["/etc/machine-id", "/var/lib/dbus/machine-id"] {
            if let Some(id) = std::fs::read_to_string(path)
                .ok()
                .filter(|id| !id.trim().is_empty())
            {
                return Some(id);
            }
        }
    }

    let hostname = tauri_plugin_os::hostname();
    (!hostname.trim().is_empty()).then_some(hostname)
}

/// Identifies the machine that wrote a lock file. On Linux the systemd/D-Bus
/// machine id is preferred because it survives the hostname changing under us
/// (a DHCP-derived hostname does that on its own); elsewhere the hostname is
/// the best answer available without spawning anything. When neither can be
/// read the id is `unknown`, which means two such machines see each other's
/// locks as local and fall back to the plain PID check — the behaviour that
/// predates this field.
fn machine_id() -> &'static str {
    static ID: std::sync::OnceLock<String> = std::sync::OnceLock::new();

    ID.get_or_init(|| {
        let id = sanitize_lock_value(&read_machine_id().unwrap_or_default());
        if id.is_empty() {
            "unknown".to_string()
        } else {
            id
        }
    })
}

/// A lock file written before this field existed is treated as local: an
/// upgrade must not let one window take over the lock of another window that
/// is genuinely writing.
fn lock_was_written_here(contents: &str) -> bool {
    parse_lock_field(contents, "host").is_none_or(|host| host == machine_id())
}

fn lock_file_is_stale(path: &std::path::Path) -> bool {
    let contents = match std::fs::read_to_string(path) {
        Ok(contents) => contents,
        // Gone between the failed `create_new` and this read: the writer that
        // held it finished in that window. Without this the empty contents
        // parse to no `created_ms` and no `pid`, which reads as a live local
        // lock — and the save was refused with `SAVE_LOCKED` naming a file
        // that no longer exists.
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return true,
        Err(_) => String::new(),
    };
    let created_ms = parse_lock_value(&contents, "created_ms").or_else(|| {
        std::fs::metadata(path)
            .ok()
            .and_then(|meta| meta.modified().ok())
            .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis())
    });

    if let Some(created_ms) = created_ms {
        if now_ms().saturating_sub(created_ms) > STALE_LOCK_MS {
            return true;
        }
    }

    // A vault in a synced folder (Syncthing/Dropbox/iCloud) carries its lock
    // file to the other machines too, and a PID from another system means
    // nothing here: PID numbers are small and reused, so a foreign writer's PID
    // that happens to be taken locally reads as "still saving" for the whole
    // stale window, and one that happens to be free reads as stale and gets
    // taken over while that writer is mid-write. So the PID is only consulted
    // for a lock this machine wrote; a foreign one is judged by age alone.
    if !lock_was_written_here(&contents) {
        return false;
    }

    let pid = parse_lock_value(&contents, "pid").and_then(|pid| u32::try_from(pid).ok());
    matches!(pid, Some(pid) if !process_is_running(pid))
}

struct SaveLockGuard {
    path: std::path::PathBuf,
    file: Option<std::fs::File>,
}

impl SaveLockGuard {
    fn acquire(target: &std::path::Path) -> Result<Self, String> {
        use std::io::Write;

        let path = lock_path(target);

        for attempt in 0..2 {
            match std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
            {
                Ok(mut file) => {
                    let _ = writeln!(
                        file,
                        "pid={} host={} created_ms={}",
                        std::process::id(),
                        machine_id(),
                        now_ms()
                    );
                    let _ = file.sync_all();

                    return Ok(Self {
                        path,
                        file: Some(file),
                    });
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    if attempt == 0 && lock_file_is_stale(&path) {
                        let _ = std::fs::remove_file(&path);
                        continue;
                    }

                    return Err(format!(
                        "SAVE_LOCKED: another Kivarion process is already saving this database ({})",
                        path.to_string_lossy()
                    ));
                }
                Err(e) => return Err(e.to_string()),
            }
        }

        Err(format!(
            "SAVE_LOCKED: another Kivarion process is already saving this database ({})",
            path.to_string_lossy()
        ))
    }
}

impl Drop for SaveLockGuard {
    fn drop(&mut self) {
        // Close the handle before deleting the lock file; Windows refuses to
        // remove an open file even if this process owns the handle.
        let _ = self.file.take();
        let _ = std::fs::remove_file(&self.path);
    }
}

/// File modification time in milliseconds since the Unix epoch, if available.
fn modified_ms(path: &std::path::Path) -> Option<f64> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    let dur = modified.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(dur.as_millis() as f64)
}

/// Modification time (ms since epoch) of a file, or `None` if it doesn't exist
/// (or is not a path the user granted). Used by the frontend to track external
/// changes for conflict detection; callers already treat `None` as "unknown".
#[tauri::command]
pub async fn file_mtime(
    path: String,
    access: tauri::State<'_, PathAccess>,
) -> Result<Option<f64>, String> {
    let Ok(path) = access.check(&path, Access::Read) else {
        return Ok(None);
    };

    Ok(run_blocking(move || modified_ms(&path))
        .await
        .ok()
        .flatten())
}

/// Owner-only permissions for a database file: read/write for the user who
/// created it, nothing for anyone else.
#[cfg(unix)]
const OWNER_ONLY_MODE: u32 = 0o600;

/// Create the temp file the save writes into.
///
/// On unix it is opened at [`OWNER_ONLY_MODE`] rather than at `0666 & !umask`,
/// so the file never exists world-readable — not even in the window between the
/// write and the rename. `apply_saved_file_permissions` below then settles the
/// final mode; the flag only helps when the file is created, so a temp file left
/// behind by a crashed save (reused here rather than refused, or the save would
/// stay broken until someone deleted it by hand) still gets its mode fixed
/// there.
fn create_temp_file(path: &std::path::Path) -> std::io::Result<std::fs::File> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(OWNER_ONLY_MODE);
    }
    options.open(path)
}

/// Decide the permissions of the file the save is about to move into place.
///
/// The atomic save writes a brand-new file and renames it over the target, so
/// the saved database carries the *temp* file's permissions rather than the
/// target's. That leaves two cases:
///
/// * **Replacing an existing vault** — its permissions are preserved. Without
///   this a `.kdbx` the user (or KeePassXC) had locked down to 0600 became
///   readable by everyone on the machine on the very first auto-save, the temp
///   file having been created at `0666 & !umask` — typically 0644. Only acts
///   when the two actually differ: on a filesystem without real permission bits
///   (exFAT/FAT on a removable volume) every file reports the same
///   mount-derived mode, so there is nothing to carry over and `chmod` would
///   only fail. When they do differ, a failure is reported rather than ignored —
///   the alternative is writing a vault more exposed than the one it replaces,
///   without telling anyone.
/// * **Creating a new one** — there is nothing to preserve, so on unix it is
///   pinned to owner-only instead of whatever the umask happened to allow. This
///   repeats what `create_temp_file` already asked for, because that flag has no
///   effect on a temp file left behind by an earlier crashed save. Best effort:
///   a filesystem that cannot represent permissions at all must not be a reason
///   to refuse to create a database on it.
fn apply_saved_file_permissions(
    tmp: &std::path::Path,
    original: Option<&std::fs::Permissions>,
) -> Result<(), String> {
    let Some(original) = original else {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(tmp, std::fs::Permissions::from_mode(OWNER_ONLY_MODE));
        }
        return Ok(());
    };

    let current = std::fs::metadata(tmp)
        .map_err(|e| e.to_string())?
        .permissions();
    if &current == original {
        return Ok(());
    }

    std::fs::set_permissions(tmp, original.clone()).map_err(|e| e.to_string())
}

/// Rotate `<path>.bak` → `<path>.bak.1` → … keeping at most `depth` backups,
/// then copy the current `target` into the freshly-vacated `<path>.bak` slot.
fn rotate_backups(target: &std::path::Path, depth: u32) -> std::io::Result<()> {
    if depth == 0 {
        return Ok(());
    }
    // Drop every slot outside the retention window, not just the first one:
    // lowering the depth (say 10 → 3) used to strand `.bak.3`…`.bak.9` on disk
    // forever — invisible to the restore UI, yet still holding old copies of
    // the vault. Removing the whole tail also vacates `depth - 1` for the shift
    // below.
    for index in (depth - 1)..MAX_BACKUP_SLOTS {
        let _ = std::fs::remove_file(backup_path(target, index));
    }
    // Shift each remaining backup one slot older: .bak.(i-1) → .bak.i.
    for i in (1..depth).rev() {
        let from = backup_path(target, i - 1);
        if from.exists() {
            let _ = std::fs::rename(&from, backup_path(target, i));
        }
    }
    // The current good file becomes the most recent backup.
    std::fs::copy(target, backup_path(target, 0))?;
    Ok(())
}

/// Atomically and durably save the database.
///
/// First acquires a sibling lock file with atomic `create_new`, serializing all
/// Kivarion writers for this target across processes. Then writes to a sibling
/// temp file (fsync'd), gives it the permissions of the file it will replace,
/// optionally rotates `.bak` backups, renames the temp file over the original
/// and fsyncs the directory. A crash mid-write leaves the
/// original `.kdbx` intact; `std::fs::rename` replaces an existing destination
/// on every platform (including Windows via `MoveFileEx`), so the swap is
/// atomic everywhere.
///
/// `expected_mtime` (ms since epoch) implements optimistic concurrency: when it
/// is `Some` and the target's current mtime differs, the save is refused with an
/// `EXTERNAL_CONFLICT` error rather than overwriting another writer's changes.
/// On success the new file's mtime is returned so the caller can keep tracking.
///
/// The database bytes arrive as the raw IPC body; everything else comes in
/// headers (see the *Raw-byte IPC* note in `lib.rs`).
#[tauri::command]
pub async fn save_database(
    request: tauri::ipc::Request<'_>,
    access: tauri::State<'_, PathAccess>,
) -> Result<f64, String> {
    let path = arg(&request, "path").ok_or("Missing target path")?;
    let path = access.check(&path, Access::Write)?;
    // An absent mtime means "don't check" — either nothing is known about the
    // file yet or the user chose to overwrite an external change.
    let expected_mtime = arg(&request, "expected-mtime").and_then(|v| v.parse::<f64>().ok());
    let backup = arg(&request, "backup").map(|v| v == "true");
    let backup_depth = arg(&request, "backup-depth").and_then(|v| v.parse::<u32>().ok());
    // The blocking pool needs an owned payload. One memcpy is nothing next to
    // the write and two fsyncs it is about to do.
    let data = raw_body(&request)?.to_vec();

    run_blocking(move || save_database_bytes(&path, &data, expected_mtime, backup, backup_depth))
        .await?
}

fn save_database_bytes(
    target: &std::path::Path,
    data: &[u8],
    expected_mtime: Option<f64>,
    backup: Option<bool>,
    backup_depth: Option<u32>,
) -> Result<f64, String> {
    let _lock = SaveLockGuard::acquire(target)?;
    let tmp = with_suffix(target, ".tmp");

    // Optimistic concurrency: bail out if the file changed under us. This check
    // happens after the lock is acquired, so no other Kivarion writer can pass
    // the same check and race us to the rename.
    if let Some(expected) = expected_mtime {
        if let Some(current) = modified_ms(target) {
            if current != expected {
                return Err(format!(
                    "{CONFLICT_PREFIX}: the file was modified on disk since it was opened"
                ));
            }
        }
    }

    // The rename in step 4 replaces the file wholesale, so the permissions of
    // the vault being saved have to be read now and re-applied by hand.
    let original_permissions = std::fs::metadata(target)
        .ok()
        .map(|metadata| metadata.permissions());

    // 1. Write the new contents to the temp file and flush to stable storage.
    {
        use std::io::Write;
        let mut file = create_temp_file(&tmp).map_err(|e| e.to_string())?;
        if let Err(e) = file.write_all(data).and_then(|_| file.sync_all()) {
            let _ = std::fs::remove_file(&tmp);
            return Err(e.to_string());
        }
    }

    // 2. Preserve the original file's permissions, or keep a brand-new database
    //    owner-only.
    if let Err(e) = apply_saved_file_permissions(&tmp, original_permissions.as_ref()) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }

    // 3. Back up the current good file (with rotation) before replacing it.
    if target.exists() && backup.unwrap_or(true) {
        if let Err(e) = rotate_backups(target, backup_depth.unwrap_or(3)) {
            let _ = std::fs::remove_file(&tmp);
            return Err(e.to_string());
        }
    }

    // 4. Atomically replace the original with the temp file.
    if let Err(e) = std::fs::rename(&tmp, target) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.to_string());
    }

    // 5. fsync the directory so the rename itself is durable.
    if let Some(dir) = target.parent() {
        if let Ok(handle) = std::fs::File::open(dir) {
            let _ = handle.sync_all();
        }
    }

    modified_ms(target).ok_or_else(|| "Saved but could not read new file time".to_string())
}

/// Metadata for one rotated backup file, newest-first to the caller.
#[derive(serde::Serialize)]
pub struct BackupInfo {
    path: String,
    mtime: Option<f64>,
    size: u64,
}

/// List the rotated backups (`<path>.bak`, `<path>.bak.N`) for a database,
/// most-recent first, so the UI can offer a restore.
#[tauri::command]
pub async fn list_backups(
    path: String,
    access: tauri::State<'_, PathAccess>,
) -> Result<Vec<BackupInfo>, String> {
    let path = access.check(&path, Access::Read)?;

    Ok(run_blocking(move || collect_backups(&path))
        .await
        .unwrap_or_default())
}

fn collect_backups(target: &std::path::Path) -> Vec<BackupInfo> {
    let mut out = Vec::new();
    // Scan every slot instead of stopping at the first gap. Numbering is not
    // guaranteed contiguous — a backup deleted externally, or slots left by a
    // depth that was lowered and raised again, leave holes — and the files past
    // a hole are still perfectly good restore points.
    for index in 0..MAX_BACKUP_SLOTS {
        let p = backup_path(target, index);
        let Ok(meta) = std::fs::metadata(&p) else {
            continue;
        };
        out.push(BackupInfo {
            path: p.to_string_lossy().into_owned(),
            mtime: modified_ms(&p),
            size: meta.len(),
        });
    }
    out.sort_by(|a, b| {
        b.mtime
            .partial_cmp(&a.mtime)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    out
}

/// Write bytes to a user-chosen path (used to export a decrypted attachment).
/// The bytes are the raw IPC body; the target path comes in a header.
#[tauri::command]
pub async fn export_file(
    request: tauri::ipc::Request<'_>,
    access: tauri::State<'_, PathAccess>,
) -> Result<(), String> {
    let path = arg(&request, "path").ok_or("Missing target path")?;
    let path = access.check(&path, Access::Write)?;
    let data = raw_body(&request)?.to_vec();

    run_blocking(move || export_file_bytes(&path, &data)).await?
}

/// Temp file → rename, the same shape as `save_database` minus the lock and the
/// backups.
///
/// A plain `std::fs::write` truncates the destination before it writes, so an
/// export that failed part way — a full disk, a volume pulled out — left a
/// half-written file where the user's own file used to be. Exporting over an
/// existing file must either replace it or leave it alone.
///
/// The temp file is owner-only while it is being written (`create_temp_file`),
/// which matters here as much as it does for a vault: these are decrypted
/// attachment bytes. `apply_saved_file_permissions` then settles the final mode
/// the same way — the file being replaced keeps its permissions, a new one is
/// created owner-only rather than at whatever the umask allows.
fn export_file_bytes(target: &std::path::Path, data: &[u8]) -> Result<(), String> {
    use std::io::Write;

    let tmp = with_suffix(target, ".tmp");
    let original_permissions = std::fs::metadata(target)
        .ok()
        .map(|metadata| metadata.permissions());

    {
        let mut file = create_temp_file(&tmp).map_err(|e| e.to_string())?;
        if let Err(e) = file.write_all(data).and_then(|_| file.sync_all()) {
            let _ = std::fs::remove_file(&tmp);
            return Err(e.to_string());
        }
    }

    if let Err(e) = apply_saved_file_permissions(&tmp, original_permissions.as_ref()) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }

    if let Err(e) = std::fs::rename(&tmp, target) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.to_string());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::*;

    #[test]
    fn backup_path_uses_expected_rotation_names() {
        let target = std::path::Path::new("vault.kdbx");

        assert_eq!(
            backup_path(target, 0),
            std::path::PathBuf::from("vault.kdbx.bak")
        );
        assert_eq!(
            backup_path(target, 1),
            std::path::PathBuf::from("vault.kdbx.bak.1")
        );
        assert_eq!(
            backup_path(target, 7),
            std::path::PathBuf::from("vault.kdbx.bak.7")
        );
    }

    #[test]
    fn rotate_backups_shifts_existing_backups_and_keeps_depth() {
        let dir = TempDir::new();
        let target = dir.path().join("vault.kdbx");
        std::fs::write(&target, b"current").unwrap();
        std::fs::write(backup_path(&target, 0), b"backup-0").unwrap();
        std::fs::write(backup_path(&target, 1), b"backup-1").unwrap();
        std::fs::write(backup_path(&target, 2), b"too-old").unwrap();

        rotate_backups(&target, 3).unwrap();

        assert_eq!(read_bytes(&backup_path(&target, 0)), b"current");
        assert_eq!(read_bytes(&backup_path(&target, 1)), b"backup-0");
        assert_eq!(read_bytes(&backup_path(&target, 2)), b"backup-1");
    }

    #[test]
    fn rotate_backups_drops_slots_left_behind_by_a_larger_depth() {
        let dir = TempDir::new();
        let target = dir.path().join("vault.kdbx");
        std::fs::write(&target, b"current").unwrap();
        // State from when the retention depth was still 6.
        for index in 0..6 {
            std::fs::write(backup_path(&target, index), format!("old-{index}")).unwrap();
        }

        // The user lowered the depth to 2.
        rotate_backups(&target, 2).unwrap();

        assert_eq!(read_bytes(&backup_path(&target, 0)), b"current");
        assert_eq!(read_bytes(&backup_path(&target, 1)), b"old-0");
        for index in 2..6 {
            assert!(
                !backup_path(&target, index).exists(),
                ".bak.{index} was left stranded on disk"
            );
        }
    }

    #[test]
    fn list_backups_reports_slots_after_a_gap() {
        let dir = TempDir::new();
        let target = dir.path().join("vault.kdbx");
        // `.bak.1` is missing — deleted externally, or left by an earlier depth.
        std::fs::write(backup_path(&target, 0), b"newest").unwrap();
        std::fs::write(backup_path(&target, 2), b"older").unwrap();

        let backups = collect_backups(&target);

        let paths: Vec<String> = backups.into_iter().map(|b| b.path).collect();
        assert!(
            paths.contains(&backup_path(&target, 2).to_string_lossy().into_owned()),
            "a backup past the gap was hidden from restore: {paths:?}"
        );
        assert_eq!(paths.len(), 2);
    }

    #[test]
    fn save_database_writes_atomically_and_creates_backup() {
        let dir = TempDir::new();
        let target = dir.path().join("vault.kdbx");
        std::fs::write(&target, b"old").unwrap();

        let new_mtime = save_database_bytes(&target, b"new", None, Some(true), Some(2)).unwrap();

        assert!(new_mtime > 0.0);
        assert_eq!(read_bytes(&target), b"new");
        assert_eq!(read_bytes(&backup_path(&target, 0)), b"old");
        assert!(!lock_path(&target).exists());
        assert!(!with_suffix(&target, ".tmp").exists());
    }

    #[cfg(unix)]
    #[test]
    fn save_database_keeps_the_original_file_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let dir = TempDir::new();
        let target = dir.path().join("vault.kdbx");
        std::fs::write(&target, b"old").unwrap();
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o600)).unwrap();

        save_database_bytes(&target, b"new", None, Some(true), Some(2)).unwrap();

        // The save renames a fresh temp file over the target, so without
        // carrying the mode across, a vault locked to 0600 came back 0644
        // (`File::create` uses 0666 & !umask).
        assert_eq!(mode_of(&target), 0o600);
        // The rotated backup is a copy of that file and holds the same secrets.
        assert_eq!(mode_of(&backup_path(&target, 0)), 0o600);
    }

    #[cfg(unix)]
    #[test]
    fn save_database_restores_permissions_across_repeated_saves() {
        use std::os::unix::fs::PermissionsExt;

        let dir = TempDir::new();
        let target = dir.path().join("vault.kdbx");
        std::fs::write(&target, b"old").unwrap();
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o640)).unwrap();

        for _ in 0..3 {
            save_database_bytes(&target, b"new", None, Some(false), Some(1)).unwrap();
        }

        // Each save is a fresh file: the mode must not drift towards the umask
        // default over a session's worth of auto-saves.
        assert_eq!(mode_of(&target), 0o640);
    }

    #[test]
    fn save_database_creates_a_file_that_did_not_exist_yet() {
        let dir = TempDir::new();
        let target = dir.path().join("fresh.kdbx");

        // A database created from the app: there are no permissions to carry
        // over and nothing to back up, and the save must still go through.
        save_database_bytes(&target, b"new", None, Some(true), Some(2)).unwrap();

        assert_eq!(read_bytes(&target), b"new");
        assert!(!backup_path(&target, 0).exists());
    }

    #[cfg(unix)]
    #[test]
    fn save_database_creates_a_new_database_owner_only() {
        let dir = TempDir::new();
        let target = dir.path().join("fresh.kdbx");

        save_database_bytes(&target, b"new", None, Some(true), Some(2)).unwrap();

        // Nothing to preserve, so the new vault keeps owner-only permissions
        // rather than whatever the umask allows — 0644 under the usual 022,
        // i.e. readable by every account on the machine.
        assert_eq!(mode_of(&target), 0o600);
    }

    #[cfg(unix)]
    #[test]
    fn save_database_fixes_the_mode_of_a_leftover_temp_file() {
        use std::os::unix::fs::PermissionsExt;

        let dir = TempDir::new();
        let target = dir.path().join("fresh.kdbx");
        // A temp file left behind by a save that crashed. It is reused (the
        // alternative is a save that stays broken until someone deletes it by
        // hand), so its mode must not survive into the database.
        let tmp = with_suffix(&target, ".tmp");
        std::fs::write(&tmp, b"partial").unwrap();
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o666)).unwrap();

        save_database_bytes(&target, b"new", None, Some(true), Some(2)).unwrap();

        assert_eq!(read_bytes(&target), b"new");
        assert_eq!(mode_of(&target), 0o600);
    }

    #[test]
    fn save_database_rejects_stale_mtime_without_overwriting() {
        let dir = TempDir::new();
        let target = dir.path().join("vault.kdbx");
        std::fs::write(&target, b"current").unwrap();
        let stale_mtime = modified_ms(&target).unwrap() - 1.0;

        let err = save_database_bytes(&target, b"new", Some(stale_mtime), Some(true), Some(2))
            .unwrap_err();

        assert!(err.starts_with(CONFLICT_PREFIX));
        assert_eq!(read_bytes(&target), b"current");
        assert!(!backup_path(&target, 0).exists());
        assert!(!with_suffix(&target, ".tmp").exists());
        assert!(!lock_path(&target).exists());
    }

    /// Reads as dead everywhere: it exceeds `pid_t`, so the unix conversion
    /// fails, and no `tasklist` row matches it on Windows.
    const DEAD_PID: u32 = u32::MAX;

    fn write_lock_file(target: &std::path::Path, contents: &str) {
        std::fs::write(lock_path(target), contents).unwrap();
    }

    #[test]
    fn machine_id_is_a_single_sanitized_token() {
        let id = machine_id();

        assert!(!id.is_empty());
        assert_eq!(id, sanitize_lock_value(id));
        assert!(!id.chars().any(char::is_whitespace));
    }

    #[test]
    fn sanitize_lock_value_replaces_separators_and_truncates() {
        assert_eq!(sanitize_lock_value(" my host.local\n"), "my_host.local");
        assert_eq!(sanitize_lock_value(&"x".repeat(200)).len(), 64);
    }

    #[test]
    fn a_lock_file_from_another_machine_ignores_the_pid() {
        let dir = TempDir::new();
        let target = dir.path().join("vault.kdbx");

        // Fresh: locked, even though the PID it names is dead here. The writer
        // is on the other machine and its PID says nothing about that.
        write_lock_file(
            &target,
            &format!(
                "pid={DEAD_PID} host=another-machine created_ms={}",
                now_ms()
            ),
        );
        assert!(!lock_file_is_stale(&lock_path(&target)));

        // Old: stale by age alone, even though the PID it names is alive here.
        write_lock_file(
            &target,
            &format!(
                "pid={} host=another-machine created_ms=0",
                std::process::id()
            ),
        );
        assert!(lock_file_is_stale(&lock_path(&target)));
    }

    #[test]
    fn a_lock_file_from_this_machine_still_follows_the_pid() {
        let dir = TempDir::new();
        let target = dir.path().join("vault.kdbx");

        write_lock_file(
            &target,
            &format!(
                "pid={DEAD_PID} host={} created_ms={}",
                machine_id(),
                now_ms()
            ),
        );
        assert!(lock_file_is_stale(&lock_path(&target)));

        write_lock_file(
            &target,
            &format!(
                "pid={} host={} created_ms={}",
                std::process::id(),
                machine_id(),
                now_ms()
            ),
        );
        assert!(!lock_file_is_stale(&lock_path(&target)));
    }

    #[test]
    fn save_database_refuses_a_fresh_lock_file_from_another_machine() {
        let dir = TempDir::new();
        let target = dir.path().join("vault.kdbx");
        std::fs::write(&target, b"old").unwrap();
        write_lock_file(
            &target,
            &format!(
                "pid={DEAD_PID} host=another-machine created_ms={}",
                now_ms()
            ),
        );

        let err = save_database_bytes(&target, b"new", None, Some(false), Some(1)).unwrap_err();

        assert!(err.starts_with("SAVE_LOCKED"));
        assert_eq!(read_bytes(&target), b"old");
    }

    #[test]
    fn a_taken_lock_file_records_this_machine() {
        let dir = TempDir::new();
        let target = dir.path().join("vault.kdbx");
        let guard = SaveLockGuard::acquire(&target).unwrap();

        let contents = std::fs::read_to_string(lock_path(&target)).unwrap();
        assert_eq!(parse_lock_field(&contents, "host"), Some(machine_id()));
        assert_eq!(
            parse_lock_value(&contents, "pid"),
            Some(u128::from(std::process::id()))
        );
        assert!(lock_was_written_here(&contents));

        drop(guard);
        assert!(!lock_path(&target).exists());
    }

    #[test]
    fn a_lock_file_that_is_already_gone_counts_as_stale() {
        let dir = TempDir::new();
        let target = dir.path().join("vault.kdbx");

        // The holder released it between our failed `create_new` and the read.
        // Judged as live, the save came back `SAVE_LOCKED` over a lock file
        // that no longer existed.
        assert!(lock_file_is_stale(&lock_path(&target)));
    }

    #[test]
    fn export_file_leaves_the_previous_file_intact_when_the_write_fails() {
        let dir = TempDir::new();
        let target = dir.path().join("attachment.bin");
        std::fs::write(&target, b"previously exported").unwrap();

        // A directory cannot be opened for writing, so the temp step fails the
        // way a full disk or a removed volume would.
        std::fs::create_dir(with_suffix(&target, ".tmp")).unwrap();

        assert!(export_file_bytes(&target, b"new bytes").is_err());
        // The old export used `std::fs::write`, which truncates first.
        assert_eq!(read_bytes(&target), b"previously exported");
    }

    #[test]
    fn export_file_replaces_an_existing_file_and_cleans_up() {
        let dir = TempDir::new();
        let target = dir.path().join("attachment.bin");
        std::fs::write(&target, b"old").unwrap();

        export_file_bytes(&target, b"new").unwrap();

        assert_eq!(read_bytes(&target), b"new");
        assert!(!with_suffix(&target, ".tmp").exists());
    }

    #[cfg(unix)]
    #[test]
    fn export_file_keeps_a_new_file_owner_only() {
        let dir = TempDir::new();
        let target = dir.path().join("attachment.bin");

        export_file_bytes(&target, b"decrypted").unwrap();

        // Decrypted vault content, so it does not land at 0644 because that is
        // what the umask happened to allow.
        assert_eq!(mode_of(&target), 0o600);
    }

    #[cfg(unix)]
    #[test]
    fn export_file_preserves_the_permissions_of_the_file_it_replaces() {
        use std::os::unix::fs::PermissionsExt;

        let dir = TempDir::new();
        let target = dir.path().join("attachment.bin");
        std::fs::write(&target, b"old").unwrap();
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o640)).unwrap();

        export_file_bytes(&target, b"new").unwrap();

        assert_eq!(mode_of(&target), 0o640);
    }

    #[test]
    fn save_database_takes_over_stale_lock_file() {
        let dir = TempDir::new();
        let target = dir.path().join("vault.kdbx");
        std::fs::write(&target, b"old").unwrap();
        std::fs::write(lock_path(&target), "pid=1 created_ms=0").unwrap();

        save_database_bytes(&target, b"new", None, Some(false), Some(1)).unwrap();

        assert_eq!(read_bytes(&target), b"new");
        assert!(!lock_path(&target).exists());
    }

    #[test]
    fn save_database_refuses_live_lock_file() {
        let dir = TempDir::new();
        let target = dir.path().join("vault.kdbx");
        std::fs::write(&target, b"old").unwrap();
        // No `host=`: a lock file written by a version that predates the field
        // counts as local, so its PID still decides.
        std::fs::write(
            lock_path(&target),
            format!("pid={} created_ms={}", std::process::id(), now_ms()),
        )
        .unwrap();

        let err = save_database_bytes(&target, b"new", None, Some(false), Some(1)).unwrap_err();

        assert!(err.starts_with("SAVE_LOCKED"));
        assert_eq!(read_bytes(&target), b"old");
        let _ = std::fs::remove_file(lock_path(&target));
    }

    // --- Raw-byte IPC contract --------------------------------------------
    //
    // These drive real invoke requests through the handler on Tauri's mock
    // runtime, so they cover the part plain function tests cannot: that the
    // bytes arrive as an untransformed body and that the scalar arguments are
    // found under the exact header names `src/ipc.js` writes. Getting either
    // side of that contract wrong breaks every save at runtime while the rest
    // of the suite stays green.

    /// A mock app with the given paths already granted, as if the user had
    /// picked them in a native dialog.
    fn mock_webview(
        granted: &[&std::path::Path],
    ) -> tauri::WebviewWindow<tauri::test::MockRuntime> {
        use tauri::Manager;

        let access = PathAccess::new(None);
        for path in granted {
            access.grant_database(path);
        }

        let app = tauri::test::mock_builder()
            .invoke_handler(tauri::generate_handler![save_database, export_file])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("failed to build mock app");
        app.manage(access);

        tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("failed to build mock webview")
    }

    /// Encode a header value exactly the way `invokeWithBytes` does.
    fn arg_header(value: &str) -> String {
        value
            .bytes()
            .map(|b| match b {
                b'A'..=b'Z'
                | b'a'..=b'z'
                | b'0'..=b'9'
                | b'-'
                | b'_'
                | b'.'
                | b'!'
                | b'~'
                | b'*'
                | b'\''
                | b'('
                | b')' => (b as char).to_string(),
                _ => format!("%{b:02X}"),
            })
            .collect()
    }

    fn raw_invoke(
        webview: &tauri::WebviewWindow<tauri::test::MockRuntime>,
        cmd: &str,
        data: &[u8],
        args: &[(&str, &str)],
    ) -> Result<tauri::ipc::InvokeResponseBody, String> {
        let mut headers = tauri::http::HeaderMap::new();
        for (name, value) in args {
            headers.insert(
                tauri::http::HeaderName::from_bytes(
                    format!("{}{name}", crate::ARG_HEADER_PREFIX).as_bytes(),
                )
                .unwrap(),
                arg_header(value).parse().unwrap(),
            );
        }

        tauri::test::get_ipc_response(
            webview,
            tauri::webview::InvokeRequest {
                cmd: cmd.into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: crate::mock_ipc_url(),
                body: tauri::ipc::InvokeBody::Raw(data.to_vec()),
                headers,
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        )
        .map_err(|e| format!("{e:?}"))
    }

    #[test]
    fn save_database_command_reads_raw_body_and_header_arguments() {
        let dir = TempDir::new();
        // A non-ASCII path is the case percent-encoded headers exist for.
        let target = dir.path().join("Хранилище.kdbx");
        std::fs::write(&target, b"old").unwrap();
        let webview = mock_webview(&[&target]);

        raw_invoke(
            &webview,
            "save_database",
            b"new-vault-bytes",
            &[
                ("path", &target.to_string_lossy()),
                ("backup", "true"),
                ("backup-depth", "2"),
            ],
        )
        .expect("save_database rejected a raw request");

        assert_eq!(read_bytes(&target), b"new-vault-bytes");
        assert_eq!(read_bytes(&backup_path(&target, 0)), b"old");
    }

    #[test]
    fn save_database_command_honours_the_expected_mtime_header() {
        let dir = TempDir::new();
        let target = dir.path().join("vault.kdbx");
        std::fs::write(&target, b"current").unwrap();
        let stale = modified_ms(&target).unwrap() - 1.0;
        let webview = mock_webview(&[&target]);

        let err = raw_invoke(
            &webview,
            "save_database",
            b"new",
            &[
                ("path", &target.to_string_lossy()),
                ("expected-mtime", &stale.to_string()),
                ("backup", "false"),
            ],
        )
        .unwrap_err();

        assert!(err.contains(CONFLICT_PREFIX), "unexpected error: {err}");
        assert_eq!(read_bytes(&target), b"current");
    }

    #[test]
    fn export_file_command_writes_the_raw_body() {
        let dir = TempDir::new();
        let target = dir.path().join("attachment.bin");
        let webview = mock_webview(&[&target]);

        // Byte values that JSON-number-array encoding would have inflated.
        let payload: Vec<u8> = (0..=255u8).collect();
        raw_invoke(
            &webview,
            "export_file",
            &payload,
            &[("path", &target.to_string_lossy())],
        )
        .expect("export_file rejected a raw request");

        assert_eq!(read_bytes(&target), payload);
    }

    #[test]
    fn bulk_commands_reject_a_json_body_instead_of_corrupting_the_file() {
        let dir = TempDir::new();
        let target = dir.path().join("vault.kdbx");
        std::fs::write(&target, b"untouched").unwrap();
        let webview = mock_webview(&[&target]);

        let mut headers = tauri::http::HeaderMap::new();
        headers.insert(
            tauri::http::HeaderName::from_static("x-kivarion-path"),
            arg_header(&target.to_string_lossy()).parse().unwrap(),
        );

        let err = tauri::test::get_ipc_response(
            &webview,
            tauri::webview::InvokeRequest {
                cmd: "save_database".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: crate::mock_ipc_url(),
                body: tauri::ipc::InvokeBody::Json(serde_json::json!([1, 2, 3])),
                headers,
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        )
        .map_err(|e| format!("{e:?}"))
        .unwrap_err();

        assert!(err.contains("raw byte payload"), "unexpected error: {err}");
        assert_eq!(read_bytes(&target), b"untouched");
    }

    #[test]
    fn bulk_commands_refuse_a_path_the_user_never_picked() {
        let dir = TempDir::new();
        let granted = dir.path().join("vault.kdbx");
        let other = dir.path().join("id_ed25519");
        std::fs::write(&other, b"private key").unwrap();
        let webview = mock_webview(&[&granted]);

        for cmd in ["save_database", "export_file"] {
            let err = raw_invoke(
                &webview,
                cmd,
                b"pwned",
                &[("path", &other.to_string_lossy())],
            )
            .unwrap_err();

            assert!(
                err.contains(crate::access::ACCESS_DENIED),
                "{cmd} accepted an ungranted path: {err}"
            );
        }
        assert_eq!(read_bytes(&other), b"private key");
    }
}
