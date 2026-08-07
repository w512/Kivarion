//! Touch ID unlock, backed by the macOS Keychain.
//!
//! macOS only: every command returns a "not supported" error elsewhere.
//! `LocalAuthentication` (`LAContext`) verifies the user, and the master
//! password is stored under the service `"Kivarion"`, keyed by the database
//! file path.
//!
//! The access control differs by build. **Release** builds attach a
//! `USER_PRESENCE` ACL in the Data Protection keychain, so the OS itself demands
//! Touch ID or the passcode on every read. **Debug** builds are typically
//! unsigned and would be rejected there (-34018), so they store a plain item in
//! the file keychain and run an explicit `verify_biometric` prompt instead.
//!
//! Gotcha worth keeping in mind: a SecItem call *without*
//! `kSecUseDataProtectionKeychain` operates on both keychains, and the ACL
//! permits unauthenticated deletes — which is why the legacy cleanup in
//! `save_protected_password` has to run *before* the add, not after.

use crate::access::PathAccess;

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
pub fn is_biometric_available() -> bool {
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
pub async fn save_biometric_password(id: String, pass: String) -> Result<(), String> {
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
pub async fn load_biometric_password(id: String) -> Result<String, String> {
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
pub fn delete_biometric_password(id: &str) -> Result<(), String> {
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
pub struct ForgottenDatabaseData {
    key_file_associations: usize,
}

/// Clear persisted unlock data while leaving the currently open database and
/// its in-memory filesystem grants intact. No vault or key file is deleted.
#[tauri::command]
pub fn forget_saved_database_data(
    access: tauri::State<'_, PathAccess>,
) -> Result<ForgottenDatabaseData, String> {
    delete_all_biometric_passwords()?;
    Ok(ForgottenDatabaseData {
        key_file_associations: access.clear_key_file_associations(),
    })
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

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
}
