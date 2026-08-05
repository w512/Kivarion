// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

mod access;
mod crypto;

use access::{Access, PathAccess};

/// The page origin a mock-runtime `InvokeRequest` has to carry.
///
/// Tauri resolves a command against the ACL by the calling window's origin, so
/// a request built with the wrong one is rejected before the command runs —
/// with `"<cmd> not allowed. Plugin not found"`, which reads like a missing
/// command rather than a mismatched origin. It is `tauri://localhost`
/// everywhere except Windows and Android, which serve the app over a custom
/// `http` protocol instead. Kept in one place because the tests in three
/// modules push raw requests through the invoke handler.
#[cfg(test)]
pub(crate) fn mock_ipc_url() -> tauri::Url {
    if cfg!(any(windows, target_os = "android")) {
        "http://tauri.localhost"
    } else {
        "tauri://localhost"
    }
    .parse()
    .expect("mock ipc url is a valid url")
}

// --- Filesystem commands -------------------------------------------------
//
// All database/attachment file I/O lives in the backend so the webview never
// holds a broad `fs` scope. The frontend can only invoke these specific
// operations on a path the user picked through a native dialog (or the saved
// last-database path). This keeps an XSS-compromised frontend from reading or
// writing arbitrary files under the user's home directory.
//
// The absence of an `fs` capability is not what enforces that: `invoke` reaches
// these commands regardless, so each one that takes a path runs it past the
// allowlist in `access.rs` first. A path enters the allowlist only by being
// picked in a (backend-owned) native dialog or by being the remembered database
// or its key file.

// --- Threading -----------------------------------------------------------
//
// Tauri runs a command that is not `async` on the **main thread**, so every
// filesystem command below used to block the UI for as long as it took: a save
// of a large vault is a multi-megabyte write plus two fsyncs, and `qlmanage`
// does not return until the user closes the preview window. Declaring the
// commands `async` moves them off the main thread, and `run_blocking` then
// hands the actual blocking work to the runtime's blocking pool so it does not
// occupy an async worker either. Even a bare `stat` is routed through it —
// on an unresponsive network or removable volume it can hang just as long.

/// Run blocking filesystem work on the async runtime's blocking pool.
pub(crate) async fn run_blocking<T, F>(work: F) -> Result<T, String>
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| format!("Background filesystem task failed: {e}"))
}

/// Read a file's raw bytes (used to load the selected `.kdbx`, a rotated backup,
/// a key file, or a user-picked attachment source).
///
/// Returned as a raw IPC `Response` so the bytes reach the webview as an
/// `ArrayBuffer` instead of an inflated JSON number array.
#[tauri::command]
async fn read_database(
    path: String,
    access: tauri::State<'_, PathAccess>,
) -> Result<tauri::ipc::Response, String> {
    let path = access.check(&path, Access::Read)?;

    let bytes = run_blocking(move || std::fs::read(&path))
        .await?
        .map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

// --- Raw-byte IPC --------------------------------------------------------
//
// Tauri serializes a `Uint8Array` nested inside a JSON argument object by
// turning every byte into a decimal number (`Array.from`), so a payload costs
// roughly four bytes of JSON text per byte of data and has to be re-parsed by
// serde on this side. For a database that is tens of megabytes — rewritten on
// every auto-save — that dominates the write. Commands that carry bulk bytes
// therefore take the payload as the whole IPC body (`application/octet-stream`,
// no transformation) and receive their scalar arguments as headers instead.
//
// Header values must be ISO-8859-1, so the frontend percent-encodes each one
// (see `src/ipc.js`) and they are decoded back here — database paths regularly
// contain non-ASCII characters.

/// Prefix shared by every scalar argument passed alongside a raw byte body.
const ARG_HEADER_PREFIX: &str = "x-kivarion-";

/// Read one percent-encoded scalar argument from the request headers.
pub(crate) fn arg(request: &tauri::ipc::Request<'_>, name: &str) -> Option<String> {
    let raw = request
        .headers()
        .get(format!("{ARG_HEADER_PREFIX}{name}"))?
        .to_str()
        .ok()?;
    percent_encoding::percent_decode_str(raw)
        .decode_utf8()
        .ok()
        .map(std::borrow::Cow::into_owned)
}

/// Borrow the raw byte payload of a request.
///
/// A `Json` body means the webview fell back to the postMessage IPC interface
/// (the custom protocol was blocked). Bulk commands cannot work in that mode,
/// and neither can reading a database, so this is reported rather than silently
/// handled with a slow path.
pub(crate) fn raw_body<'a>(request: &'a tauri::ipc::Request<'_>) -> Result<&'a [u8], String> {
    match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => Ok(bytes),
        tauri::ipc::InvokeBody::Json(_) => {
            Err("Expected a raw byte payload; the custom protocol IPC is unavailable".to_string())
        }
    }
}

/// Marker prefix returned when the on-disk file changed since the caller last
/// read it (another app instance or external program wrote to it). The frontend
/// detects this prefix to offer an "overwrite anyway" choice instead of silently
/// clobbering the other writer's changes.
const CONFLICT_PREFIX: &str = "EXTERNAL_CONFLICT";

/// Append a literal suffix to a path's filename (e.g. `vault.kdbx` + `.bak` →
/// `vault.kdbx.bak`). Unlike `Path::with_extension` this never eats an existing
/// extension, so it is correct regardless of how the file is named.
pub(crate) fn with_suffix(path: &std::path::Path, suffix: &str) -> std::path::PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(suffix);
    std::path::PathBuf::from(name)
}

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

#[cfg(unix)]
fn process_exists_from_kill(result: i32, errno: Option<i32>) -> bool {
    result == 0 || !matches!(errno, Some(libc::ESRCH))
}

#[cfg(unix)]
fn process_is_running(pid: u32) -> bool {
    if pid == std::process::id() {
        return true;
    }

    let Ok(pid) = libc::pid_t::try_from(pid) else {
        return false;
    };
    // Signal 0 performs only the existence/permission check and does not fork.
    // EPERM means the process exists but belongs to another user; only ESRCH
    // proves it is gone. Unknown errors are treated conservatively as live.
    let result = unsafe { libc::kill(pid, 0) };
    process_exists_from_kill(
        result,
        (result != 0)
            .then(|| std::io::Error::last_os_error().raw_os_error())
            .flatten(),
    )
}

#[cfg(windows)]
fn process_is_running(pid: u32) -> bool {
    if pid == std::process::id() {
        return true;
    }

    let Ok(output) = std::process::Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/NH"])
        .output()
    else {
        return true;
    };

    String::from_utf8_lossy(&output.stdout).contains(&pid.to_string())
}

#[cfg(not(any(unix, windows)))]
fn process_is_running(pid: u32) -> bool {
    pid == std::process::id()
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
async fn file_mtime(
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
/// headers (see *Raw-byte IPC* above).
#[tauri::command]
async fn save_database(
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
struct BackupInfo {
    path: String,
    mtime: Option<f64>,
    size: u64,
}

/// List the rotated backups (`<path>.bak`, `<path>.bak.N`) for a database,
/// most-recent first, so the UI can offer a restore.
#[tauri::command]
async fn list_backups(
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
async fn export_file(
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

/// Strip any directory components from an attachment name so it can never
/// escape the temp directory (path-traversal protection).
#[cfg(target_os = "macos")]
fn sanitize_file_name(name: &str) -> String {
    let base = std::path::Path::new(name)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("attachment");
    let cleaned: String = base
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | '\0'))
        .collect();
    if cleaned.is_empty() {
        "attachment".to_string()
    } else {
        cleaned
    }
}

#[cfg(target_os = "macos")]
const QUICK_LOOK_TEMP_DIR: &str = "Kivarion-quicklook";

#[cfg(target_os = "macos")]
static NEXT_QUICK_LOOK_DIR_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

#[cfg(target_os = "macos")]
fn quick_look_temp_root() -> std::path::PathBuf {
    std::env::temp_dir().join(QUICK_LOOK_TEMP_DIR)
}

/// Extract the owner PID from the directory format created below:
/// `preview-<pid>-<per-process id>`. Invalid/legacy names have no owner and are
/// safe to treat as stale.
#[cfg(target_os = "macos")]
fn quick_look_preview_pid(name: &std::ffi::OsStr) -> Option<u32> {
    let name = name.to_str()?.strip_prefix("preview-")?;
    let (pid, id) = name.split_once('-')?;
    let pid = pid.parse::<u32>().ok()?;
    let _ = id.parse::<u64>().ok()?;
    (pid != 0).then_some(pid)
}

/// Remove decrypted previews left behind if an earlier process crashed or was
/// killed before `qlmanage` returned, while preserving preview directories
/// owned by another live Kivarion process.
#[cfg(target_os = "macos")]
fn clear_quick_look_temp_dir_at(root: &std::path::Path) -> Result<(), String> {
    clear_quick_look_temp_dir_at_with(root, process_is_running)
}

/// Predicate-injected implementation keeps startup cleanup deterministic in
/// tests without spawning or killing real processes.
#[cfg(target_os = "macos")]
fn clear_quick_look_temp_dir_at_with(
    root: &std::path::Path,
    is_process_running: impl Fn(u32) -> bool,
) -> Result<(), String> {
    let metadata = match std::fs::symlink_metadata(root) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };

    // Never follow an unexpected root symlink. The normal root is a directory;
    // a file or symlink at that path cannot contain a valid active preview.
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return std::fs::remove_file(root).map_err(|error| error.to_string());
    }

    let mut first_error = None;
    let entries = std::fs::read_dir(root).map_err(|error| error.to_string())?;
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                first_error.get_or_insert_with(|| error.to_string());
                continue;
            }
        };
        let path = entry.path();
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(error) => {
                first_error.get_or_insert_with(|| error.to_string());
                continue;
            }
        };

        let belongs_to_live_process = file_type.is_dir()
            && quick_look_preview_pid(&entry.file_name()).is_some_and(&is_process_running);
        if belongs_to_live_process {
            continue;
        }

        // Invalid/legacy names, regular files and symlinks are never active
        // preview directories. Remove symlinks themselves rather than following
        // them outside the private temp root.
        let result = if file_type.is_dir() && !file_type.is_symlink() {
            std::fs::remove_dir_all(&path)
        } else {
            std::fs::remove_file(&path)
        };
        if let Err(error) = result {
            first_error.get_or_insert_with(|| format!("{}: {error}", path.display()));
        }
    }

    // Remove the root only when cleanup left it empty. DirectoryNotEmpty is
    // expected when another process still owns a preview (or created one while
    // this scan was running).
    if let Err(error) = std::fs::remove_dir(root) {
        if !matches!(
            error.kind(),
            std::io::ErrorKind::NotFound | std::io::ErrorKind::DirectoryNotEmpty
        ) {
            first_error.get_or_insert_with(|| error.to_string());
        }
    }

    first_error.map_or(Ok(()), Err)
}

/// RAII cleanup ensures every preview's private directory is removed on all
/// normal and error return paths after it has been created.
#[cfg(target_os = "macos")]
struct QuickLookTempDir {
    path: std::path::PathBuf,
}

#[cfg(target_os = "macos")]
impl QuickLookTempDir {
    fn path(&self) -> &std::path::Path {
        &self.path
    }
}

#[cfg(target_os = "macos")]
impl Drop for QuickLookTempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// Create a separate owner-only directory for each preview so equal attachment
/// names and concurrent Quick Look windows can never share a decrypted file.
#[cfg(target_os = "macos")]
fn create_quick_look_temp_dir_at(root: &std::path::Path) -> Result<QuickLookTempDir, String> {
    use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
    use std::sync::atomic::Ordering;

    let mut root_builder = std::fs::DirBuilder::new();
    root_builder.recursive(true).mode(0o700);
    root_builder
        .create(root)
        .map_err(|error| error.to_string())?;
    let root_metadata = std::fs::symlink_metadata(root).map_err(|error| error.to_string())?;
    if !root_metadata.is_dir() || root_metadata.file_type().is_symlink() {
        return Err("Quick Look temporary path is not a directory".to_string());
    }
    std::fs::set_permissions(root, std::fs::Permissions::from_mode(0o700))
        .map_err(|error| error.to_string())?;

    for _ in 0..100 {
        let id = NEXT_QUICK_LOOK_DIR_ID.fetch_add(1, Ordering::Relaxed);
        let path = root.join(format!("preview-{}-{id}", std::process::id()));
        let mut builder = std::fs::DirBuilder::new();
        builder.mode(0o700);
        match builder.create(&path) {
            Ok(()) => return Ok(QuickLookTempDir { path }),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        }
    }

    Err("Could not create a unique Quick Look temporary directory".to_string())
}

#[cfg(target_os = "macos")]
fn write_quick_look_attachment(
    dir: &std::path::Path,
    file_name: &str,
    data: &[u8],
) -> Result<std::path::PathBuf, String> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;

    let path = dir.join(sanitize_file_name(file_name));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&path)
        .map_err(|error| error.to_string())?;
    file.write_all(data).map_err(|error| error.to_string())?;
    Ok(path)
}

/// Write the decrypted bytes into a unique private, owner-only (0700) temp
/// directory, preview them, and delete the whole directory as soon as the
/// preview window closes. Blocking from start to finish — always call it off
/// the main thread.
#[cfg(target_os = "macos")]
fn preview_with_quick_look(file_name: &str, data: &[u8]) -> Result<(), String> {
    use std::process::Command;

    let dir = create_quick_look_temp_dir_at(&quick_look_temp_root())?;
    let path = write_quick_look_attachment(dir.path(), file_name, data)?;

    // qlmanage -p blocks until the preview window is closed. `dir` stays alive
    // for that whole call and removes the decrypted file when it is dropped.
    let _ = Command::new("qlmanage").arg("-p").arg(&path).status();
    Ok(())
}

/// Preview a decrypted attachment via macOS Quick Look.
///
/// The bytes are written by the Rust side (never exposed through the JS fs
/// scope) into a unique private, owner-only temp directory, previewed, and
/// deleted immediately after the preview window closes. The attachment bytes
/// are the raw IPC body; its name comes in a header.
#[tauri::command]
async fn quick_look_attachment(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let file_name = arg(&request, "file-name").ok_or("Missing attachment name")?;
    let data = raw_body(&request)?.to_vec();

    #[cfg(target_os = "macos")]
    {
        // `qlmanage` does not return until the user closes the preview, which
        // can be minutes — by far the longest block in this file, and the one
        // that must never sit on the main thread or an async worker.
        run_blocking(move || preview_with_quick_look(&file_name, &data)).await?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (file_name, data);
        Err("Quick Look is only available on macOS".to_string())
    }
}

#[cfg(target_os = "macos")]
use block2::RcBlock;
#[cfg(target_os = "macos")]
use objc2_foundation::NSString;
#[cfg(target_os = "macos")]
use objc2_local_authentication::{LAContext, LAPolicy};
#[cfg(target_os = "macos")]
use security_framework::passwords::{
    delete_generic_password_options, generic_password, set_generic_password_options,
    PasswordOptions,
};

#[tauri::command]
fn is_biometric_available() -> bool {
    #[cfg(target_os = "macos")]
    {
        unsafe {
            let context = LAContext::new();
            context
                .canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthenticationWithBiometrics)
                .is_ok()
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

#[cfg(target_os = "macos")]
async fn verify_biometric(reason: &str) -> Result<(), String> {
    use std::sync::mpsc;

    let (tx, rx) = mpsc::channel::<Result<(), String>>();

    // Confine every (non-Send) Objective-C object to this block so they are
    // dropped before the `.await` below — otherwise the resulting future would
    // not be `Send` and Tauri couldn't run it.
    unsafe {
        let context = LAContext::new();
        let reason_ns = NSString::from_str(reason);

        let reply = RcBlock::new(
            move |success: objc2::runtime::Bool, error: *mut objc2_foundation::NSError| {
                if success.as_bool() {
                    let _ = tx.send(Ok(()));
                } else {
                    let err_msg = if !error.is_null() {
                        format!("Auth failed: {:?}", (*error).localizedDescription())
                    } else {
                        "Auth cancelled or failed".to_string()
                    };
                    let _ = tx.send(Err(err_msg));
                }
            },
        );

        // `evaluatePolicy` returns immediately and invokes `reply` later on a
        // system queue once the user responds to the Touch ID prompt.
        context.evaluatePolicy_localizedReason_reply(
            LAPolicy::DeviceOwnerAuthenticationWithBiometrics,
            &reason_ns,
            &reply,
        );
    }

    // Park the wait on the blocking pool so we never block an async executor
    // thread while the (possibly long) Touch ID prompt is on screen.
    tauri::async_runtime::spawn_blocking(move || {
        rx.recv()
            .unwrap_or_else(|_| Err("Internal error".to_string()))
    })
    .await
    .map_err(|e| e.to_string())?
}

// Query targeting the Data Protection keychain — the only store where the OS
// enforces a USER_PRESENCE access control on read. The `passwords` helpers
// never set `kSecUseDataProtectionKeychain`, so without it the item lands in
// the file-based login keychain, where SecItemUpdate on a pre-existing item
// silently drops the ACL and reads need no Touch ID at all.
#[cfg(target_os = "macos")]
fn data_protection_options(id: &str) -> PasswordOptions {
    use core_foundation::base::TCFType;
    use core_foundation::boolean::CFBoolean;
    use core_foundation::string::CFString;

    let mut options = PasswordOptions::new_generic_password("Kivarion", id);
    #[allow(deprecated)]
    options.query.push((
        unsafe {
            CFString::wrap_under_get_rule(
                security_framework_sys::item::kSecUseDataProtectionKeychain,
            )
        },
        CFBoolean::true_value().into_CFType(),
    ));
    options
}

// Legacy query: the file-based login keychain, where debug builds store the
// item (unsigned builds can't use the Data Protection keychain, -34018) and
// where releases before the Data Protection fix used to put it.
#[cfg(target_os = "macos")]
fn legacy_options(id: &str) -> PasswordOptions {
    PasswordOptions::new_generic_password("Kivarion", id)
}

// Stable marker matched by the frontend: no biometric password is stored for
// this database, so the user must unlock manually once to (re)save it.
#[cfg(target_os = "macos")]
const BIOMETRIC_NOT_ENROLLED: &str = "BIOMETRIC_NOT_ENROLLED";

#[cfg(all(target_os = "macos", not(debug_assertions)))]
fn save_protected_password(id: &str, pass: &[u8]) -> Result<(), String> {
    // Clear existing copies from both stores before adding. The order is
    // load-bearing: a SecItem call without `kSecUseDataProtectionKeychain`
    // operates on the file keychain AND the Data Protection keychain (macOS
    // unified SecItem behavior), and the access control permits deletes
    // without authentication — running this legacy cleanup after the add
    // would silently destroy the item that was just stored.
    let _ = delete_generic_password_options(legacy_options(id));
    // Delete-then-add: on a duplicate the crate falls back to SecItemUpdate,
    // which updates the value but cannot attach the access control — the item
    // would stay readable without Touch ID. Losing the item if the add below
    // fails is acceptable: the next manual unlock stores it again.
    let _ = delete_generic_password_options(data_protection_options(id));

    let mut options = data_protection_options(id);
    options.set_access_control_options(
        security_framework::passwords::AccessControlOptions::USER_PRESENCE,
    );
    set_generic_password_options(pass, options).map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_biometric_password(id: String, pass: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // Confirm the user's identity before storing the secret.
        verify_biometric("Authorize Kivarion to save this database password").await?;

        // In release builds the item goes to the Data Protection keychain with
        // a USER_PRESENCE access control, so the OS itself requires Touch ID /
        // passcode on every read. Debug builds are typically unsigned and
        // would fail with errSecMissingEntitlement (-34018), so they store a
        // plain item guarded only by the in-app `verify_biometric` check.
        #[cfg(not(debug_assertions))]
        {
            save_protected_password(&id, pass.as_bytes())
        }
        #[cfg(debug_assertions)]
        {
            set_generic_password_options(pass.as_bytes(), legacy_options(&id))
                .map_err(|e| e.to_string())
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (id, pass);
        Err("Biometric authentication is not supported on this platform".to_string())
    }
}

#[tauri::command]
async fn load_biometric_password(id: String) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        #[cfg(not(debug_assertions))]
        {
            // Reading the USER_PRESENCE item makes the OS show the Touch ID
            // prompt itself; no in-app check needed.
            match generic_password(data_protection_options(&id)) {
                Ok(pass_bytes) => String::from_utf8(pass_bytes).map_err(|e| e.to_string()),
                Err(e) if e.code() == security_framework_sys::base::errSecItemNotFound => {
                    // Legacy item (saved by a debug build or by a release
                    // before the Data Protection fix): it has no ACL, so gate
                    // it with an explicit check, then migrate it to the
                    // protected form so this path never runs again. Probe for
                    // the item first so a missing one fails fast instead of
                    // prompting for Touch ID and then erroring out.
                    let pass_bytes = match generic_password(legacy_options(&id)) {
                        Ok(bytes) => bytes,
                        Err(e) if e.code() == security_framework_sys::base::errSecItemNotFound => {
                            return Err(BIOMETRIC_NOT_ENROLLED.to_string());
                        }
                        Err(e) => return Err(e.to_string()),
                    };
                    verify_biometric("Unlock Kivarion Database").await?;
                    let _ = save_protected_password(&id, &pass_bytes);
                    String::from_utf8(pass_bytes).map_err(|e| e.to_string())
                }
                Err(e) => Err(e.to_string()),
            }
        }
        #[cfg(debug_assertions)]
        {
            // Debug: the item has no ACL, verify the user explicitly.
            let pass_bytes = match generic_password(legacy_options(&id)) {
                Ok(bytes) => bytes,
                Err(e) if e.code() == security_framework_sys::base::errSecItemNotFound => {
                    return Err(BIOMETRIC_NOT_ENROLLED.to_string());
                }
                Err(e) => return Err(e.to_string()),
            };
            verify_biometric("Unlock Kivarion Database").await?;
            String::from_utf8(pass_bytes).map_err(|e| e.to_string())
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = id;
        Err("Biometric authentication is not supported on this platform".to_string())
    }
}

#[tauri::command]
fn delete_biometric_password(id: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // The secret may live in either store (see save/load); remove both.
        // Data Protection errors are ignored: debug builds can't touch that
        // keychain at all, and "not found" is the common case.
        let _ = delete_generic_password_options(data_protection_options(id));
        match delete_generic_password_options(legacy_options(id)) {
            Ok(()) => Ok(()),
            Err(e) if e.code() == security_framework_sys::base::errSecItemNotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = id;
        Err("Biometric authentication is not supported on this platform".to_string())
    }
}

/// A service-only query matches every Kivarion account, including passwords
/// whose absolute database path is no longer known to the application.
#[cfg(target_os = "macos")]
fn all_biometric_password_options(data_protection: bool) -> PasswordOptions {
    use core_foundation::base::TCFType;
    use core_foundation::string::CFString;

    let mut options = if data_protection {
        data_protection_options("")
    } else {
        legacy_options("")
    };
    let account_key =
        unsafe { CFString::wrap_under_get_rule(security_framework_sys::item::kSecAttrAccount) };
    #[allow(deprecated)]
    options.query.retain(|(key, _)| key != &account_key);
    options
}

/// Remove every biometric secret owned by Kivarion, not merely the IDs still
/// present in localStorage. This is what makes cleanup effective for databases
/// that were moved or renamed before the cleanup feature existed.
fn delete_all_biometric_passwords() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // Debug builds cannot access the Data Protection keychain, and an empty
        // store is normal, so this result is deliberately ignored just like in
        // delete_biometric_password. The legacy/unified query below removes all
        // remaining Kivarion items from both keychain stores.
        let _ = delete_generic_password_options(all_biometric_password_options(true));
        match delete_generic_password_options(all_biometric_password_options(false)) {
            Ok(()) => Ok(()),
            Err(e) if e.code() == security_framework_sys::base::errSecItemNotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ForgottenDatabaseData {
    key_file_associations: usize,
}

/// Clear persisted unlock data while leaving the currently open database and
/// its in-memory filesystem grants intact. No vault or key file is deleted.
#[tauri::command]
fn forget_saved_database_data(
    access: tauri::State<'_, PathAccess>,
) -> Result<ForgottenDatabaseData, String> {
    delete_all_biometric_passwords()?;
    Ok(ForgottenDatabaseData {
        key_file_associations: access.clear_key_file_associations(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TEMP_ID: AtomicU64 = AtomicU64::new(0);

    struct TempDir {
        path: std::path::PathBuf,
    }

    impl TempDir {
        fn new() -> Self {
            let id = NEXT_TEMP_ID.fetch_add(1, Ordering::Relaxed);
            let path =
                std::env::temp_dir().join(format!("kivarion-lib-test-{}-{id}", std::process::id()));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }

        fn path(&self) -> &std::path::Path {
            &self.path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn read_bytes(path: &std::path::Path) -> Vec<u8> {
        std::fs::read(path).unwrap()
    }

    #[cfg(unix)]
    fn mode_of(path: &std::path::Path) -> u32 {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    #[test]
    fn run_blocking_leaves_the_calling_thread() {
        let caller = std::thread::current().id();

        let worker =
            tauri::async_runtime::block_on(run_blocking(|| std::thread::current().id())).unwrap();

        // The whole point: a command's filesystem work must not run where the
        // caller is. In the app the caller is the main thread, and a save of a
        // large vault froze the UI for as long as the write and fsyncs took.
        assert_ne!(worker, caller);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn all_biometric_password_query_does_not_filter_by_database_path() {
        use core_foundation::base::TCFType;
        use core_foundation::string::CFString;

        let options = all_biometric_password_options(false);
        let account_key =
            unsafe { CFString::wrap_under_get_rule(security_framework_sys::item::kSecAttrAccount) };
        #[allow(deprecated)]
        let has_account = options.query.iter().any(|(key, _)| key == &account_key);

        assert!(!has_account);
    }

    #[cfg(unix)]
    #[test]
    fn unix_pid_check_treats_eperm_as_live_and_esrch_as_dead() {
        assert!(process_exists_from_kill(0, None));
        assert!(process_exists_from_kill(-1, Some(libc::EPERM)));
        assert!(!process_exists_from_kill(-1, Some(libc::ESRCH)));
    }

    #[test]
    fn with_suffix_appends_without_replacing_extension() {
        let path = std::path::Path::new("/tmp/vault.kdbx");

        assert_eq!(
            with_suffix(path, ".bak"),
            std::path::PathBuf::from("/tmp/vault.kdbx.bak")
        );
        assert_eq!(
            with_suffix(path, ".tmp"),
            std::path::PathBuf::from("/tmp/vault.kdbx.tmp")
        );
    }

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

    fn navigable(url: &str) -> bool {
        is_internal_navigation(&url.parse().expect("test url parses"))
    }

    #[test]
    fn navigation_guard_allows_the_apps_own_pages() {
        // How the bundle is served on macOS and Linux, including the routes of
        // the hash router — which is why the decision is scheme-and-host and
        // not a full-URL match.
        assert!(navigable("tauri://localhost"));
        assert!(navigable("tauri://localhost/index.html"));
        assert!(navigable("tauri://localhost/#/database"));
        assert!(navigable("tauri://localhost/#/settings"));

        // Windows and Android, with and without `useHttpsScheme`.
        assert!(navigable("http://tauri.localhost/"));
        assert!(navigable("https://tauri.localhost/#/database"));
    }

    #[test]
    fn navigation_guard_blocks_the_open_web() {
        // The case this exists for: an unlocked database in memory and the
        // window on a page someone else controls.
        assert!(!navigable("https://example.com/"));
        assert!(!navigable("http://example.com/"));

        // A host that merely ends in the trusted one, which a naive suffix
        // check would wave through.
        assert!(!navigable("https://evil-tauri.localhost/"));
        assert!(!navigable("https://tauri.localhost.example.com/"));

        // Non-http schemes that can reach the local machine or run script.
        assert!(!navigable("file:///etc/passwd"));
        assert!(!navigable("data:text/html,<script>alert(1)</script>"));
        assert!(!navigable("about:blank"));
    }

    #[test]
    fn navigation_guard_trusts_the_dev_server_only_in_a_dev_build() {
        // `tauri dev` serves the frontend over http://localhost:1420, so a dev
        // build has to accept it. A release build never loads over plain http
        // and must not, or the guard would have a hole on any machine running
        // something on that port.
        assert_eq!(navigable("http://localhost:1420/"), cfg!(dev));
        assert_eq!(navigable("http://127.0.0.1:1420/"), cfg!(dev));
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

    #[cfg(target_os = "macos")]
    #[test]
    fn sanitize_file_name_strips_directories_and_dangerous_characters() {
        assert_eq!(sanitize_file_name("../secret.txt"), "secret.txt");
        assert_eq!(sanitize_file_name("dir\\evil\0name.txt"), "direvilname.txt");
        assert_eq!(sanitize_file_name(""), "attachment");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn quick_look_startup_cleanup_removes_stale_and_legacy_previews() {
        let temp = TempDir::new();
        let root = temp.path().join("Kivarion-quicklook");
        let stale_dir = root.join("preview-4343-0");
        let legacy_dir = root.join("preview-from-crashed-process");
        std::fs::create_dir_all(&stale_dir).unwrap();
        std::fs::create_dir_all(&legacy_dir).unwrap();
        std::fs::write(stale_dir.join("secret.txt"), b"decrypted").unwrap();
        std::fs::write(legacy_dir.join("old.txt"), b"decrypted").unwrap();

        clear_quick_look_temp_dir_at_with(&root, |_| false).unwrap();

        assert!(!root.exists());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn quick_look_startup_cleanup_preserves_live_process_previews() {
        let temp = TempDir::new();
        let root = temp.path().join("Kivarion-quicklook");
        let live_dir = root.join("preview-4242-7");
        let stale_dir = root.join("preview-4343-8");
        let malformed_dir = root.join("preview-4242-invalid");
        std::fs::create_dir_all(&live_dir).unwrap();
        std::fs::create_dir_all(&stale_dir).unwrap();
        std::fs::create_dir_all(&malformed_dir).unwrap();
        std::fs::write(live_dir.join("active.txt"), b"active preview").unwrap();
        std::fs::write(stale_dir.join("stale.txt"), b"stale preview").unwrap();

        clear_quick_look_temp_dir_at_with(&root, |pid| pid == 4242).unwrap();

        assert!(live_dir.exists());
        assert_eq!(read_bytes(&live_dir.join("active.txt")), b"active preview");
        assert!(!stale_dir.exists());
        assert!(!malformed_dir.exists());
        assert!(root.exists());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn quick_look_uses_unique_private_directories_and_files() {
        use std::os::unix::fs::PermissionsExt;

        let temp = TempDir::new();
        let root = temp.path().join("Kivarion-quicklook");
        let first = create_quick_look_temp_dir_at(&root).unwrap();
        let second = create_quick_look_temp_dir_at(&root).unwrap();
        let first_path = first.path().to_path_buf();

        assert_ne!(first.path(), second.path());
        assert_eq!(
            std::fs::metadata(first.path())
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );

        let attachment =
            write_quick_look_attachment(first.path(), "../secret.txt", b"decrypted").unwrap();
        assert_eq!(attachment.parent(), Some(first.path()));
        assert_eq!(read_bytes(&attachment), b"decrypted");
        assert_eq!(
            std::fs::metadata(&attachment).unwrap().permissions().mode() & 0o777,
            0o600
        );

        drop(first);
        assert!(!first_path.exists());
        assert!(second.path().exists());
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
                    format!("{ARG_HEADER_PREFIX}{name}").as_bytes(),
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
                err.contains(access::ACCESS_DENIED),
                "{cmd} accepted an ungranted path: {err}"
            );
        }
        assert_eq!(read_bytes(&other), b"private key");
    }
}

// Lets the frontend finish a guarded quit (Cmd+Q / app menu): the exit was
// prevented in the `ExitRequested` handler below so pending saves could be
// flushed first; this command performs the actual exit.
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

// --- Navigation guard ----------------------------------------------------
//
// Nothing in the app navigates the webview anywhere: an entry's URL is handed
// to the OS through the opener plugin and the anchor's own navigation is always
// prevented (`EntryViewFields`). This is the backstop for that. If some future
// code — or script that has found its way into the webview — ever does
// navigate, the window would leave `tauri://` for a page a remote origin
// controls, while an unlocked database sits in memory behind the IPC bridge.
//
// The CSP does not cover this. `default-src` and `form-action` do not restrict
// a top-level navigation driven by `window.location`, and the header that would
// have (`navigate-to`) was never shipped by any engine.
//
// This is a plugin hook rather than `WebviewWindowBuilder::on_navigation`
// because the window is declared in `tauri.conf.json`. The plugin hook is
// installed on the navigation handler of *every* webview whatever created it,
// so the window does not have to be built in Rust to be covered — which keeps
// the window's declarative config, and the window-state plugin's restore, alone.

/// Whether a navigation is to the app's own content.
///
/// Deliberately decided on scheme and host rather than a full-URL match: the
/// frontend is a hash-router single-page app, so its own routes differ only in
/// the fragment, and a path or query would be compared against a moving target.
fn is_internal_navigation(url: &tauri::Url) -> bool {
    match url.scheme() {
        // How the bundled assets are served on macOS and Linux.
        "tauri" => true,
        // Windows and Android serve the same assets over `tauri.localhost`
        // (https when `useHttpsScheme` is on, http otherwise). `localhost` is
        // the Vite dev server, and only a dev build has any business trusting
        // it — in a release build nothing should be loading over plain http.
        "http" | "https" => {
            let host = url.host_str();
            host == Some("tauri.localhost")
                || (cfg!(dev) && matches!(host, Some("localhost") | Some("127.0.0.1")))
        }
        _ => false,
    }
}

fn navigation_guard<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("kivarion-navigation-guard")
        .on_navigation(|_webview, url| {
            let allowed = is_internal_navigation(url);
            if !allowed {
                // Worth a line on stderr: reaching here means something tried
                // to take the window off the app, which is not a thing that
                // happens in normal use.
                eprintln!("Blocked navigation away from the app: {url}");
            }
            allowed
        })
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(navigation_guard())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            use tauri::Manager;

            #[cfg(target_os = "macos")]
            if let Err(error) = clear_quick_look_temp_dir_at(&quick_look_temp_root()) {
                eprintln!("Could not clear stale Quick Look previews: {error}");
            }

            // Where the remembered database / key files live. Deliberately not
            // in the webview's localStorage: a grant is derived from it.
            let store = app
                .path()
                .app_config_dir()
                .ok()
                .map(|dir| dir.join("remembered-paths.json"));
            let access = PathAccess::new(store);

            // Debug builds only: let the E2E smoke test hand the app a
            // database, since WebDriver cannot answer a native file dialog.
            #[cfg(debug_assertions)]
            if let Some(path) = std::env::var_os("KIVARION_E2E_DATABASE") {
                access.preset_database(std::path::Path::new(&path));
            }

            app.manage(access);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            crypto::argon2_hash,
            read_database,
            file_mtime,
            save_database,
            list_backups,
            export_file,
            quick_look_attachment,
            access::pick_database_file,
            access::pick_new_database_path,
            access::pick_key_file,
            access::pick_attachment_file,
            access::pick_export_path,
            access::remembered_database,
            access::remember_database,
            access::forget_database,
            access::remembered_key_file,
            access::remember_key_file,
            is_biometric_available,
            save_biometric_password,
            load_biometric_password,
            delete_biometric_password,
            forget_saved_database_data,
            quit_app
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
            // A user quit (Cmd+Q / app menu) arrives with no exit code and
            // does NOT go through the window close-requested guard, so it
            // would kill the process while an auto-save is still in flight.
            // Hold the exit and let the frontend flush its state, mirroring
            // the close guard; it calls `quit_app` (which sets a code) when
            // done. An exit because the last window closed (empty window
            // list) was already guarded at the window level — let it pass.
            use tauri::{Emitter, Manager};
            if code.is_none() && !app_handle.webview_windows().is_empty() {
                api.prevent_exit();
                let _ = app_handle.emit("kivarion:quit-requested", ());
            }
        }
    });
}
