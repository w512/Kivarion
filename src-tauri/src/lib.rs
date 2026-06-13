// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

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

    let (tx, rx) = mpsc::channel();
    let reason_ns = NSString::from_str(reason);

    unsafe {
        let context = LAContext::new();
        let tx = tx.clone();

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

        context.evaluatePolicy_localizedReason_reply(
            LAPolicy::DeviceOwnerAuthenticationWithBiometrics,
            &reason_ns,
            &reply
        );
    }

    rx.recv().unwrap_or(Err("Internal error".to_string()))
}

#[tauri::command]
async fn save_biometric_password(id: String, pass: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // 1. Confirm the user's identity before storing the secret.
        verify_biometric("Authorize Kivarion to save this database password").await?;

        // 2. Save to the keychain.
        let _ = delete_generic_password_options(PasswordOptions::new_generic_password("Kivarion", &id));

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
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            quick_look_attachment,
            is_biometric_available,
            save_biometric_password,
            load_biometric_password,
            delete_biometric_password
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
