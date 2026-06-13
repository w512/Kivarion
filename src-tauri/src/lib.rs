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

/// Atomically save the database.
///
/// Writes to a sibling temp file, backs up the current file to `<path>.bak`,
/// then renames the temp file over the original. A crash mid-write leaves the
/// original `.kdbx` intact. `std::fs::rename` replaces an existing destination
/// on every platform (including Windows), so the swap is atomic everywhere.
#[tauri::command]
fn save_database(path: String, data: Vec<u8>) -> Result<(), String> {
    let target = std::path::Path::new(&path);
    let tmp = target.with_extension("kdbx.tmp");
    let backup = target.with_extension("kdbx.bak");

    // 1. Write the new contents to the temp file; the original is untouched.
    if let Err(e) = std::fs::write(&tmp, &data) {
        return Err(e.to_string());
    }

    // 2. Back up the current good file before replacing it.
    if target.exists() {
        if let Err(e) = std::fs::copy(target, &backup) {
            let _ = std::fs::remove_file(&tmp);
            return Err(e.to_string());
        }
    }

    // 3. Atomically replace the original with the temp file.
    if let Err(e) = std::fs::rename(&tmp, target) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.to_string());
    }

    Ok(())
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
use security_framework::passwords::{set_generic_password_options, PasswordOptions, generic_password, delete_generic_password_options};
#[cfg(target_os = "macos")]
use objc2_local_authentication::{LAContext, LAPolicy};
#[cfg(target_os = "macos")]
use objc2_foundation::NSString;
#[cfg(target_os = "macos")]
use block2::RcBlock;

#[tauri::command]
fn is_biometric_available() -> bool {
    #[cfg(target_os = "macos")]
    {
        unsafe {
            let context = LAContext::new();
            context.canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthenticationWithBiometrics).is_ok()
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

        let reply = RcBlock::new(move |success: objc2::runtime::Bool, error: *mut objc2_foundation::NSError| {
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
        });

        // `evaluatePolicy` returns immediately and invokes `reply` later on a
        // system queue once the user responds to the Touch ID prompt.
        context.evaluatePolicy_localizedReason_reply(
            LAPolicy::DeviceOwnerAuthenticationWithBiometrics,
            &reason_ns,
            &reply
        );
    }

    // Park the wait on the blocking pool so we never block an async executor
    // thread while the (possibly long) Touch ID prompt is on screen.
    tauri::async_runtime::spawn_blocking(move || {
        rx.recv().unwrap_or_else(|_| Err("Internal error".to_string()))
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
        delete_generic_password_options(PasswordOptions::new_generic_password("Kivarion", id)).map_err(|e| e.to_string())
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
            save_database,
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
