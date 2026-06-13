// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

// --- Filesystem commands -------------------------------------------------
//
// All database/attachment file I/O lives in the backend so the webview never
// holds a broad `fs` scope. The frontend can only invoke these specific
// operations on a path the user picked through a native dialog (or the saved
// last-database path). This keeps an XSS-compromised frontend from reading or
// writing arbitrary files under the user's home directory.

/// Read a file's raw bytes (used to load the selected `.kdbx`).
///
/// Returned as a raw IPC `Response` so the bytes reach the webview as an
/// `ArrayBuffer` instead of an inflated JSON number array.
#[tauri::command]
fn read_database(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Check whether a path exists (used to validate the remembered last DB path).
#[tauri::command]
fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

/// Marker prefix returned when the on-disk file changed since the caller last
/// read it (another app instance or external program wrote to it). The frontend
/// detects this prefix to offer an "overwrite anyway" choice instead of silently
/// clobbering the other writer's changes.
const CONFLICT_PREFIX: &str = "EXTERNAL_CONFLICT";

/// Append a literal suffix to a path's filename (e.g. `vault.kdbx` + `.bak` →
/// `vault.kdbx.bak`). Unlike `Path::with_extension` this never eats an existing
/// extension, so it is correct regardless of how the file is named.
fn with_suffix(path: &std::path::Path, suffix: &str) -> std::path::PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(suffix);
    std::path::PathBuf::from(name)
}

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

struct SaveLockGuard {
    path: std::path::PathBuf,
    file: Option<std::fs::File>,
}

impl SaveLockGuard {
    fn acquire(target: &std::path::Path) -> Result<Self, String> {
        use std::io::Write;

        let path = lock_path(target);
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::AlreadyExists {
                    format!(
                        "SAVE_LOCKED: another Kivarion process is already saving this database ({})",
                        path.to_string_lossy()
                    )
                } else {
                    e.to_string()
                }
            })?;

        let _ = writeln!(
            file,
            "pid={} created_ms={}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0)
        );
        let _ = file.sync_all();

        Ok(Self {
            path,
            file: Some(file),
        })
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

/// Modification time (ms since epoch) of a file, or `None` if it doesn't exist.
/// Used by the frontend to track external changes for conflict detection.
#[tauri::command]
fn file_mtime(path: String) -> Option<f64> {
    modified_ms(std::path::Path::new(&path))
}

/// Rotate `<path>.bak` → `<path>.bak.1` → … keeping at most `depth` backups,
/// then copy the current `target` into the freshly-vacated `<path>.bak` slot.
fn rotate_backups(target: &std::path::Path, depth: u32) -> std::io::Result<()> {
    if depth == 0 {
        return Ok(());
    }
    // Drop the oldest backup that would fall outside the retention window.
    let _ = std::fs::remove_file(backup_path(target, depth - 1));
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
/// temp file (fsync'd), optionally rotates `.bak` backups, renames the temp file
/// over the original and fsyncs the directory. A crash mid-write leaves the
/// original `.kdbx` intact; `std::fs::rename` replaces an existing destination
/// on every platform (including Windows via `MoveFileEx`), so the swap is
/// atomic everywhere.
///
/// `expected_mtime` (ms since epoch) implements optimistic concurrency: when it
/// is `Some` and the target's current mtime differs, the save is refused with an
/// `EXTERNAL_CONFLICT` error rather than overwriting another writer's changes.
/// On success the new file's mtime is returned so the caller can keep tracking.
#[tauri::command]
fn save_database(
    path: String,
    data: Vec<u8>,
    expected_mtime: Option<f64>,
    backup: Option<bool>,
    backup_depth: Option<u32>,
) -> Result<f64, String> {
    let target = std::path::Path::new(&path);
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

    // 1. Write the new contents to the temp file and flush to stable storage.
    {
        use std::io::Write;
        let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        if let Err(e) = file.write_all(&data).and_then(|_| file.sync_all()) {
            let _ = std::fs::remove_file(&tmp);
            return Err(e.to_string());
        }
    }

    // 2. Back up the current good file (with rotation) before replacing it.
    if target.exists() && backup.unwrap_or(true) {
        if let Err(e) = rotate_backups(target, backup_depth.unwrap_or(3)) {
            let _ = std::fs::remove_file(&tmp);
            return Err(e.to_string());
        }
    }

    // 3. Atomically replace the original with the temp file.
    if let Err(e) = std::fs::rename(&tmp, target) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.to_string());
    }

    // 4. fsync the directory so the rename itself is durable.
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
fn list_backups(path: String) -> Vec<BackupInfo> {
    let target = std::path::Path::new(&path);
    let mut out = Vec::new();
    // A generous upper bound; rotation never keeps more than this in practice.
    for index in 0..64u32 {
        let p = backup_path(target, index);
        let Ok(meta) = std::fs::metadata(&p) else {
            // Slots are contiguous from 0; the first gap means we're done.
            if index == 0 {
                continue;
            } else {
                break;
            }
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
#[tauri::command]
fn export_file(path: String, data: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, &data).map_err(|e| e.to_string())
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

/// Preview a decrypted attachment via macOS Quick Look.
///
/// The bytes are written by the Rust side (never exposed through the JS fs
/// scope) into a private, owner-only (0700) temp directory, previewed, and
/// deleted immediately after the preview window closes.
#[tauri::command]
async fn quick_look_attachment(file_name: String, data: Vec<u8>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::os::unix::fs::PermissionsExt;
        use std::process::Command;

        let dir = std::env::temp_dir().join("Kivarion-quicklook");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        // Restrict the directory to the current user only.
        let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));

        let path = dir.join(sanitize_file_name(&file_name));
        std::fs::write(&path, &data).map_err(|e| e.to_string())?;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));

        // qlmanage -p blocks until the preview window is closed.
        let _ = Command::new("qlmanage").arg("-p").arg(&path).status();

        // Remove the decrypted file as soon as the window closes.
        let _ = std::fs::remove_file(&path);
        Ok(())
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

#[tauri::command]
async fn save_biometric_password(id: String, pass: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // 1. Confirm the user's identity before storing the secret.
        verify_biometric("Authorize Kivarion to save this database password").await?;

        // 2. Save to the keychain. `set_generic_password_options` adds the item
        //    or updates it in place (SecItemAdd → SecItemUpdate on duplicate),
        //    so we must NOT delete the existing item first — doing so would
        //    leave the user with no stored secret if the write below failed.
        #[allow(unused_mut)]
        let mut options = PasswordOptions::new_generic_password("Kivarion", &id);

        // In release builds, protect the item with a Secure Enclave access
        // control so the OS itself requires Touch ID / passcode to read it.
        // Debug builds are typically unsigned and would fail with
        // errSecMissingEntitlement (-34018), so they fall back to a keychain
        // item guarded only by the in-app `verify_biometric` check above.
        #[cfg(not(debug_assertions))]
        options.set_access_control_options(
            security_framework::passwords::AccessControlOptions::USER_PRESENCE,
        );

        set_generic_password_options(pass.as_bytes(), options).map_err(|e| e.to_string())
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
        // In debug builds the keychain item has no Secure Enclave ACL, so we
        // verify the user explicitly here. In release the protected item makes
        // the OS show the biometric prompt automatically when it is read.
        #[cfg(debug_assertions)]
        verify_biometric("Unlock Kivarion Database").await?;

        let options = PasswordOptions::new_generic_password("Kivarion", &id);
        let pass_bytes = generic_password(options).map_err(|e| e.to_string())?;
        String::from_utf8(pass_bytes).map_err(|e| e.to_string())
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
        delete_generic_password_options(PasswordOptions::new_generic_password("Kivarion", id))
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Biometric authentication is not supported on this platform".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_database,
            file_exists,
            file_mtime,
            save_database,
            list_backups,
            export_file,
            quick_look_attachment,
            is_biometric_available,
            save_biometric_password,
            load_biometric_password,
            delete_biometric_password
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
