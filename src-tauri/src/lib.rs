// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
//
// This file is the wiring: `run()`, the navigation guard, the raw-byte IPC
// helpers every bulk command shares, and the handful of platform helpers that
// more than one module needs. The work itself lives in the modules declared
// below: `files` (the filesystem commands), `quicklook`, `biometrics`, `crypto`
// (Argon2) and `access` (the path allowlist).

mod access;
mod biometrics;
mod crypto;
mod files;
mod quicklook;
#[cfg(test)]
mod test_support;

use access::PathAccess;

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

// --- Threading -----------------------------------------------------------
//
// Tauri runs a command that is not `async` on the **main thread**, so every
// filesystem command in `files` used to block the UI for as long as it took: a save
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

/// Append a literal suffix to a path's filename (e.g. `vault.kdbx` + `.bak` →
/// `vault.kdbx.bak`). Unlike `Path::with_extension` this never eats an existing
/// extension, so it is correct regardless of how the file is named.
pub(crate) fn with_suffix(path: &std::path::Path, suffix: &str) -> std::path::PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(suffix);
    std::path::PathBuf::from(name)
}

// --- Process liveness ----------------------------------------------------
//
// Asked by two very different places: whether the writer named in a save lock
// file is still alive (`files`), and whether a leftover Quick Look preview
// directory belongs to a Kivarion window that is still showing it
// (`quicklook`).

#[cfg(unix)]
fn process_exists_from_kill(result: i32, errno: Option<i32>) -> bool {
    result == 0 || !matches!(errno, Some(libc::ESRCH))
}

#[cfg(unix)]
pub(crate) fn process_is_running(pid: u32) -> bool {
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
pub(crate) fn process_is_running(pid: u32) -> bool {
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
pub(crate) fn process_is_running(pid: u32) -> bool {
    pid == std::process::id()
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
            if let Err(error) =
                quicklook::clear_quick_look_temp_dir_at(&quicklook::quick_look_temp_root())
            {
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
            files::read_database,
            files::file_mtime,
            files::save_database,
            files::list_backups,
            files::export_file,
            quicklook::quick_look_attachment,
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
            biometrics::is_biometric_available,
            biometrics::save_biometric_password,
            biometrics::load_biometric_password,
            biometrics::delete_biometric_password,
            biometrics::forget_saved_database_data,
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
