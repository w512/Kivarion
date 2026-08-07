//! Path access control for the filesystem commands.
//!
//! The webview holds no `fs` capability, but that alone does not stop a
//! compromised frontend from calling the commands in `files.rs` with a path of
//! its choosing (`read_database` on `~/.ssh/id_ed25519`, `export_file` over a
//! shell profile). The commands therefore accept a path only if it is in this
//! allowlist, and a path gets in exactly two ways:
//!
//! 1. **The user picked it in a native dialog.** The dialogs live here, in the
//!    backend, so the picked path is granted at the source and the frontend
//!    only ever learns a path it is already allowed to use.
//! 2. **It is the remembered database (or its key file).** Those are persisted
//!    by this module — not in `localStorage`, which the webview controls — so
//!    a restart can re-grant exactly what it granted last time.
//!
//! Grants are per-path and per-kind (read / write). Rotated backups of a
//! granted database are readable as well, since the restore flow reads them
//! and their names are derived from a path the user did pick.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::State;
use tauri_plugin_dialog::{DialogExt, FilePath};

/// Marker prefix for a refused path. Matched by the frontend the way the other
/// tagged errors are.
pub const ACCESS_DENIED: &str = "ACCESS_DENIED";

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Access {
    Read,
    Write,
}

#[derive(Clone, Copy, Default)]
struct Grant {
    read: bool,
    write: bool,
}

impl Grant {
    fn allows(self, access: Access) -> bool {
        match access {
            Access::Read => self.read,
            Access::Write => self.write,
        }
    }

    fn merged(self, other: Grant) -> Self {
        Self {
            read: self.read || other.read,
            write: self.write || other.write,
        }
    }
}

/// What survives a restart: the database to offer on the unlock screen and the
/// key file associated with each database. Kept here rather than in the
/// webview's `localStorage` precisely because a grant is derived from it.
#[derive(Default, Serialize, Deserialize)]
struct Remembered {
    #[serde(default)]
    database: Option<String>,
    #[serde(default)]
    key_files: HashMap<String, String>,
}

pub struct PathAccess {
    grants: Mutex<HashMap<PathBuf, Grant>>,
    remembered: Mutex<Remembered>,
    /// Where `Remembered` is persisted; `None` disables persistence (tests).
    store: Option<PathBuf>,
}

/// Bring a path to the form grants are keyed by: absolute, without `.` or `..`.
///
/// A caller-supplied `..` is rejected outright rather than resolved — the point
/// of the allowlist is that the frontend can only name paths it was handed, and
/// `<granted vault>/../../.ssh/id_ed25519` is not one of them.
fn normalize(path: &Path) -> Option<PathBuf> {
    if !path.is_absolute() {
        return None;
    }

    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => return None,
            Component::CurDir => {}
            other => out.push(other),
        }
    }
    Some(out)
}

/// `<db>.bak` / `<db>.bak.N` → `<db>`, or `None` if the name is not a backup
/// slot. Lets a restore read the rotated backups of a granted database without
/// widening access to anything else beside it.
fn backup_base(path: &Path) -> Option<PathBuf> {
    let name = path.file_name()?.to_str()?;
    let (base, rest) = name.rsplit_once(".bak")?;
    if base.is_empty() {
        return None;
    }

    let is_slot = rest.is_empty()
        || rest
            .strip_prefix('.')
            .is_some_and(|index| !index.is_empty() && index.chars().all(|c| c.is_ascii_digit()));

    is_slot.then(|| path.with_file_name(base))
}

fn denied(path: &str) -> String {
    format!("{ACCESS_DENIED}: this path was not chosen by the user ({path})")
}

impl PathAccess {
    /// Load the remembered paths from `store` (missing or unreadable file =
    /// nothing remembered). No grant is handed out here; the frontend has to
    /// ask for the remembered database, which is where the grant is made.
    pub fn new(store: Option<PathBuf>) -> Self {
        let remembered = store
            .as_ref()
            .and_then(|path| std::fs::read_to_string(path).ok())
            .and_then(|text| serde_json::from_str::<Remembered>(&text).ok())
            .unwrap_or_default();

        Self {
            grants: Mutex::new(HashMap::new()),
            remembered: Mutex::new(remembered),
            store,
        }
    }

    fn add(&self, path: &Path, grant: Grant) {
        let Some(path) = normalize(path) else {
            return;
        };
        let mut grants = self.grants.lock().unwrap_or_else(|e| e.into_inner());
        let entry = grants.entry(path).or_default();
        *entry = entry.merged(grant);
    }

    /// A database the user opened or created: read (open, reload, backups) and
    /// write (auto-save).
    pub fn grant_database(&self, path: &Path) {
        self.add(
            path,
            Grant {
                read: true,
                write: true,
            },
        );
    }

    /// A key file: only ever read.
    pub fn grant_read(&self, path: &Path) {
        self.add(
            path,
            Grant {
                read: true,
                write: false,
            },
        );
    }

    /// An export target: only ever written.
    pub fn grant_write(&self, path: &Path) {
        self.add(
            path,
            Grant {
                read: false,
                write: true,
            },
        );
    }

    fn revoke(&self, path: &Path) {
        let Some(path) = normalize(path) else {
            return;
        };
        let mut grants = self.grants.lock().unwrap_or_else(|e| e.into_inner());
        grants.remove(&path);
    }

    fn allows(&self, path: &Path, access: Access) -> bool {
        let grants = self.grants.lock().unwrap_or_else(|e| e.into_inner());
        if grants.get(path).is_some_and(|grant| grant.allows(access)) {
            return true;
        }

        if access == Access::Read {
            if let Some(base) = backup_base(path) {
                return grants.get(&base).is_some_and(|grant| grant.read);
            }
        }

        false
    }

    /// Gate a path that arrived from the webview, returning the normalized form
    /// the command should actually operate on.
    pub fn check(&self, path: &str, access: Access) -> Result<PathBuf, String> {
        let normalized = normalize(Path::new(path)).ok_or_else(|| denied(path))?;
        if self.allows(&normalized, access) {
            Ok(normalized)
        } else {
            Err(denied(path))
        }
    }

    /// Debug-build hook for the E2E smoke test, which drives the app through
    /// WebDriver and so cannot answer a native file dialog: pre-grant a
    /// database and offer it on the unlock screen. Not persisted — it only
    /// applies to the run that was started with `KIVARION_E2E_DATABASE` set —
    /// and compiled out of release builds entirely.
    #[cfg(debug_assertions)]
    pub fn preset_database(&self, path: &Path) {
        self.grant_database(path);
        let mut remembered = self.remembered.lock().unwrap_or_else(|e| e.into_inner());
        remembered.database = Some(path.to_string_lossy().into_owned());
    }

    fn remembered_database(&self) -> Option<String> {
        self.remembered
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .database
            .clone()
    }

    fn remembered_key_file(&self, db_path: &str) -> Option<String> {
        self.remembered
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .key_files
            .get(db_path)
            .cloned()
    }

    /// Drop every persisted database → key-file association without revoking
    /// the in-memory grants of the current session. The latter matters when the
    /// command is run from Settings while a database is still open; its next
    /// save must continue to work, while a restart restores no key-file grants.
    pub(crate) fn clear_key_file_associations(&self) -> usize {
        let mut removed = 0;
        self.update(|remembered| {
            removed = remembered.key_files.len();
            remembered.key_files.clear();
        });
        removed
    }

    fn update<F: FnOnce(&mut Remembered)>(&self, edit: F) {
        {
            let mut remembered = self.remembered.lock().unwrap_or_else(|e| e.into_inner());
            edit(&mut remembered);
        }
        self.persist();
    }

    fn persist(&self) {
        let Some(store) = self.store.as_ref() else {
            return;
        };

        let text = {
            let remembered = self.remembered.lock().unwrap_or_else(|e| e.into_inner());
            match serde_json::to_string_pretty(&*remembered) {
                Ok(text) => text,
                Err(e) => {
                    eprintln!("Could not serialize the remembered paths: {e}");
                    return;
                }
            }
        };

        if let Some(dir) = store.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Err(e) = std::fs::write(store, text) {
            eprintln!("Could not persist the remembered paths: {e}");
        }
    }
}

// --- Native dialogs ------------------------------------------------------
//
// These are commands rather than frontend calls to `@tauri-apps/plugin-dialog`
// so that picking a file is the same act as granting access to it. The dialog
// plugin's callback API is used (not the blocking one): the callback fires on
// the main thread once the user answers, and the wait is parked on the blocking
// pool so no runtime worker is held for as long as the dialog is on screen.

async fn await_choice(rx: std::sync::mpsc::Receiver<Option<FilePath>>) -> Option<PathBuf> {
    tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten())
        .await
        .ok()
        .flatten()
        .and_then(|file| file.into_path().ok())
}

/// Let the user pick an existing `.kdbx` file to open.
#[tauri::command]
pub async fn pick_database_file(
    app: tauri::AppHandle,
    access: State<'_, PathAccess>,
) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .add_filter("KDBX Database", &["kdbx"])
        .pick_file(move |file| {
            let _ = tx.send(file);
        });

    Ok(await_choice(rx).await.map(|path| {
        access.grant_database(&path);
        path.to_string_lossy().into_owned()
    }))
}

/// Let the user choose where a newly created database should be written.
///
/// The `.kdbx` extension is appended here, not in the frontend: the granted
/// path has to be the exact path the frontend will later save to.
#[tauri::command]
pub async fn pick_new_database_path(
    app: tauri::AppHandle,
    access: State<'_, PathAccess>,
    default_name: String,
) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .add_filter("KDBX Database", &["kdbx"])
        .set_file_name(default_name)
        .save_file(move |file| {
            let _ = tx.send(file);
        });

    Ok(await_choice(rx).await.map(|path| {
        let path = if path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("kdbx"))
        {
            path
        } else {
            crate::with_suffix(&path, ".kdbx")
        };

        access.grant_database(&path);
        path.to_string_lossy().into_owned()
    }))
}

/// Let the user pick a key file. Granted for reading only.
#[tauri::command]
pub async fn pick_key_file(
    app: tauri::AppHandle,
    access: State<'_, PathAccess>,
) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_file(move |file| {
        let _ = tx.send(file);
    });

    Ok(await_choice(rx).await.map(|path| {
        access.grant_read(&path);
        path.to_string_lossy().into_owned()
    }))
}

/// One attachment source selected by the user. The backend returns the display
/// name separately so the webview never has to guess platform path separators,
/// and the size so the frontend can warn about a large file *before* reading it
/// into memory and embedding it in the vault.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedAttachment {
    path: String,
    file_name: String,
    size: u64,
}

/// Let the user pick a file to attach to an entry. Granted for reading only;
/// `read_database` performs the actual allowlisted byte read.
#[tauri::command]
pub async fn pick_attachment_file(
    app: tauri::AppHandle,
    access: State<'_, PathAccess>,
) -> Result<Option<PickedAttachment>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_file(move |file| {
        let _ = tx.send(file);
    });

    let Some(path) = await_choice(rx).await else {
        return Ok(None);
    };
    access.grant_read(&path);

    // An unreadable file reports 0 rather than failing the pick: the read that
    // follows surfaces the real error, and no size means no size warning.
    let probe = path.clone();
    let size = crate::run_blocking(move || {
        std::fs::metadata(&probe)
            .map(|meta| meta.len())
            .unwrap_or(0)
    })
    .await?;

    Ok(Some(PickedAttachment {
        file_name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "attachment".to_string()),
        path: path.to_string_lossy().into_owned(),
        size,
    }))
}

/// Let the user choose where to export an attachment. Granted for writing only.
#[tauri::command]
pub async fn pick_export_path(
    app: tauri::AppHandle,
    access: State<'_, PathAccess>,
    default_name: String,
) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_file_name(default_name)
        .save_file(move |file| {
            let _ = tx.send(file);
        });

    Ok(await_choice(rx).await.map(|path| {
        access.grant_write(&path);
        path.to_string_lossy().into_owned()
    }))
}

// --- Remembered paths ----------------------------------------------------

/// The database to offer on the unlock screen, if it still exists. Granted, so
/// the frontend can open it without sending the user through a dialog again.
#[tauri::command]
pub async fn remembered_database(access: State<'_, PathAccess>) -> Result<Option<String>, String> {
    let Some(path) = access.remembered_database() else {
        return Ok(None);
    };

    let probe = path.clone();
    if !crate::run_blocking(move || Path::new(&probe).exists()).await? {
        // A moved/deleted database must not leave its remembered key-file
        // association in remembered-paths.json forever.
        access.update(|remembered| {
            if remembered.database.as_deref() == Some(path.as_str()) {
                remembered.database = None;
            }
            remembered.key_files.remove(&path);
        });
        return Ok(None);
    }

    access.grant_database(Path::new(&path));
    Ok(Some(path))
}

/// Remember a database as the one to offer next launch. Only a path that is
/// already granted can be remembered — otherwise this would be a way to grant
/// an arbitrary path to the next run.
#[tauri::command]
pub fn remember_database(access: State<'_, PathAccess>, path: String) -> Result<(), String> {
    let target = access.check(&path, Access::Write)?;
    let target = target.to_string_lossy().into_owned();

    access.update(|remembered| {
        remembered.database = Some(target);
    });
    Ok(())
}

/// Forget the remembered database and drop its grant (the in-app "Close"
/// button, which sends the user back to the file picker).
#[tauri::command]
pub fn forget_database(access: State<'_, PathAccess>, path: Option<String>) {
    if let Some(path) = path.as_deref() {
        access.revoke(Path::new(path));
    }
    access.update(|remembered| {
        remembered.database = None;
        if let Some(path) = path.as_deref() {
            remembered.key_files.remove(path);
        }
    });
}

/// The key file associated with a database, granted for reading so the unlock
/// can use it without a dialog. Requires the database itself to be granted.
#[tauri::command]
pub fn remembered_key_file(access: State<'_, PathAccess>, db_path: String) -> Option<String> {
    let db_path = access.check(&db_path, Access::Read).ok()?;
    let key_path = access.remembered_key_file(&db_path.to_string_lossy())?;

    access.grant_read(Path::new(&key_path));
    Some(key_path)
}

/// Associate a key file with a database (or drop the association when
/// `key_path` is `None`). Both paths must already be granted.
#[tauri::command]
pub fn remember_key_file(
    access: State<'_, PathAccess>,
    db_path: String,
    key_path: Option<String>,
) -> Result<(), String> {
    let db_path = access
        .check(&db_path, Access::Write)?
        .to_string_lossy()
        .into_owned();

    let key_path = match key_path {
        Some(path) => Some(
            access
                .check(&path, Access::Read)?
                .to_string_lossy()
                .into_owned(),
        ),
        None => None,
    };

    access.update(|remembered| match key_path {
        Some(path) => {
            remembered.key_files.insert(db_path, path);
        }
        None => {
            remembered.key_files.remove(&db_path);
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn access() -> PathAccess {
        PathAccess::new(None)
    }

    #[test]
    fn picked_attachment_serializes_the_frontend_contract() {
        let picked = PickedAttachment {
            path: "/tmp/report.pdf".to_string(),
            file_name: "report.pdf".to_string(),
            size: 42_000_000,
        };

        assert_eq!(
            serde_json::to_value(picked).unwrap(),
            serde_json::json!({
                "path": "/tmp/report.pdf",
                "fileName": "report.pdf",
                "size": 42_000_000
            })
        );
    }

    #[test]
    fn refuses_a_path_that_was_never_picked() {
        let access = access();
        access.grant_database(Path::new("/Users/me/vault.kdbx"));

        let err = access
            .check("/Users/me/.ssh/id_ed25519", Access::Read)
            .unwrap_err();

        assert!(err.starts_with(ACCESS_DENIED), "unexpected error: {err}");
    }

    #[test]
    fn allows_reads_and_writes_of_a_picked_database() {
        let access = access();
        access.grant_database(Path::new("/Users/me/vault.kdbx"));

        assert!(access.check("/Users/me/vault.kdbx", Access::Read).is_ok());
        assert!(access.check("/Users/me/vault.kdbx", Access::Write).is_ok());
    }

    #[test]
    fn a_key_file_is_readable_but_not_writable() {
        let access = access();
        access.grant_read(Path::new("/Users/me/secret.key"));

        assert!(access.check("/Users/me/secret.key", Access::Read).is_ok());
        assert!(access.check("/Users/me/secret.key", Access::Write).is_err());
    }

    #[test]
    fn an_export_target_is_writable_but_not_readable() {
        let access = access();
        access.grant_write(Path::new("/Users/me/photo.png"));

        assert!(access.check("/Users/me/photo.png", Access::Write).is_ok());
        assert!(access.check("/Users/me/photo.png", Access::Read).is_err());
    }

    #[test]
    fn backups_of_a_granted_database_are_readable() {
        let access = access();
        access.grant_database(Path::new("/Users/me/vault.kdbx"));

        assert!(access
            .check("/Users/me/vault.kdbx.bak", Access::Read)
            .is_ok());
        assert!(access
            .check("/Users/me/vault.kdbx.bak.7", Access::Read)
            .is_ok());
        // Reading is enough to restore; nothing writes a backup from outside.
        assert!(access
            .check("/Users/me/vault.kdbx.bak", Access::Write)
            .is_err());
        // A sibling that merely looks related is still off limits.
        assert!(access
            .check("/Users/me/vault.kdbx.bak.old", Access::Read)
            .is_err());
        assert!(access.check("/Users/me/other.bak", Access::Read).is_err());
    }

    #[test]
    fn traversal_out_of_a_granted_path_is_refused() {
        let access = access();
        access.grant_database(Path::new("/Users/me/vault.kdbx"));

        for path in [
            "/Users/me/vault.kdbx/../../../etc/passwd",
            "/Users/me/../me/vault.kdbx",
            "relative/vault.kdbx",
        ] {
            assert!(
                access.check(path, Access::Read).is_err(),
                "{path} should not have been allowed"
            );
        }
    }

    #[test]
    fn redundant_path_components_still_match_the_grant() {
        let access = access();
        access.grant_database(Path::new("/Users/me/vault.kdbx"));

        assert!(access.check("/Users/me/./vault.kdbx", Access::Read).is_ok());
    }

    #[test]
    fn clearing_key_file_associations_keeps_the_remembered_database() {
        let access = access();
        access.update(|remembered| {
            remembered.database = Some("/Users/me/vault.kdbx".to_string());
            remembered.key_files.insert(
                "/Users/me/vault.kdbx".to_string(),
                "/Users/me/vault.key".to_string(),
            );
            remembered.key_files.insert(
                "/Users/me/old.kdbx".to_string(),
                "/Users/me/old.key".to_string(),
            );
        });

        assert_eq!(access.clear_key_file_associations(), 2);
        assert_eq!(
            access.remembered_database(),
            Some("/Users/me/vault.kdbx".to_string())
        );
        assert!(access.remembered.lock().unwrap().key_files.is_empty());
    }

    #[test]
    fn remembered_paths_survive_a_restart() {
        let dir = std::env::temp_dir().join(format!("kivarion-access-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let store = dir.join("remembered.json");

        {
            let access = PathAccess::new(Some(store.clone()));
            access.grant_database(Path::new("/Users/me/vault.kdbx"));
            access.update(|remembered| {
                remembered.database = Some("/Users/me/vault.kdbx".to_string())
            });
        }

        let restarted = PathAccess::new(Some(store.clone()));
        assert_eq!(
            restarted.remembered_database(),
            Some("/Users/me/vault.kdbx".to_string())
        );
        // Restoring the record must not by itself restore access: the frontend
        // has to ask for it, which is where the grant is made.
        assert!(restarted
            .check("/Users/me/vault.kdbx", Access::Read)
            .is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }

    // --- Commands over real IPC -------------------------------------------
    //
    // Driven through the invoke handler on Tauri's mock runtime, because the
    // parts that only break at runtime live exactly there: the argument names
    // the frontend sends (`dbPath`, `keyPath` → `db_path`, `key_path`) and the
    // injection of the `PathAccess` state. A mismatch would leave every unit
    // test green while the app forgets its database on each launch.

    struct MockApp {
        webview: tauri::WebviewWindow<tauri::test::MockRuntime>,
    }

    impl MockApp {
        fn new(access: PathAccess) -> Self {
            use tauri::Manager;

            let app = tauri::test::mock_builder()
                .invoke_handler(tauri::generate_handler![
                    remembered_database,
                    remember_database,
                    forget_database,
                    remembered_key_file,
                    remember_key_file
                ])
                .build(tauri::test::mock_context(tauri::test::noop_assets()))
                .expect("failed to build mock app");
            app.manage(access);

            Self {
                webview: tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
                    .build()
                    .expect("failed to build mock webview"),
            }
        }

        fn call(&self, cmd: &str, args: serde_json::Value) -> Result<serde_json::Value, String> {
            tauri::test::get_ipc_response(
                &self.webview,
                tauri::webview::InvokeRequest {
                    cmd: cmd.into(),
                    callback: tauri::ipc::CallbackFn(0),
                    error: tauri::ipc::CallbackFn(1),
                    url: crate::mock_ipc_url(),
                    body: tauri::ipc::InvokeBody::Json(args),
                    headers: Default::default(),
                    invoke_key: tauri::test::INVOKE_KEY.to_string(),
                },
            )
            .map(|body| body.deserialize().unwrap_or(serde_json::Value::Null))
            .map_err(|e| format!("{e:?}"))
        }
    }

    /// A real (empty) file, since `remembered_database` drops a path that no
    /// longer exists.
    fn temp_file(name: &str) -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("kivarion-access-{}-{name}", std::process::id()));
        std::fs::write(&path, b"").unwrap();
        path
    }

    #[test]
    fn remember_database_refuses_a_path_that_was_never_picked() {
        let app = MockApp::new(access());

        let err = app
            .call(
                "remember_database",
                serde_json::json!({ "path": "/Users/me/.ssh/id_ed25519" }),
            )
            .unwrap_err();

        assert!(err.contains(ACCESS_DENIED), "unexpected error: {err}");
        assert_eq!(
            app.call("remembered_database", serde_json::json!({}))
                .unwrap(),
            serde_json::Value::Null
        );
    }

    #[test]
    fn a_missing_remembered_database_drops_its_key_file_association() {
        use tauri::Manager;

        let path = std::env::temp_dir()
            .join(format!(
                "kivarion-access-{}-moved-away.kdbx",
                std::process::id()
            ))
            .to_string_lossy()
            .into_owned();
        let _ = std::fs::remove_file(&path);
        let access = access();
        access.update(|remembered| {
            remembered.database = Some(path.clone());
            remembered
                .key_files
                .insert(path.clone(), "/tmp/old.key".to_string());
        });
        let app = MockApp::new(access);

        assert_eq!(
            app.call("remembered_database", serde_json::json!({}))
                .unwrap(),
            serde_json::Value::Null
        );
        let state = app.webview.state::<PathAccess>();
        let remembered = state.remembered.lock().unwrap_or_else(|e| e.into_inner());
        assert!(remembered.database.is_none());
        assert!(!remembered.key_files.contains_key(&path));
    }

    #[test]
    fn a_remembered_database_is_offered_again_and_granted() {
        let vault = temp_file("vault.kdbx");
        let path = vault.to_string_lossy().into_owned();

        let access = access();
        access.grant_database(&vault);
        let app = MockApp::new(access);
        app.call("remember_database", serde_json::json!({ "path": path }))
            .unwrap();

        // A fresh run: the record is on disk but nothing is granted yet.
        let restarted = PathAccess::new(None);
        restarted.update(|remembered| remembered.database = Some(path.clone()));
        let app = MockApp::new(restarted);

        assert_eq!(
            app.call("remembered_database", serde_json::json!({}))
                .unwrap(),
            serde_json::Value::String(path.clone())
        );
        // Asking for it is what grants it — the database opens without a dialog.
        app.call("remember_database", serde_json::json!({ "path": path }))
            .expect("the remembered database was not granted");

        // Closing forgets the path and drops the grant with it.
        app.call("forget_database", serde_json::json!({ "path": path }))
            .unwrap();
        assert_eq!(
            app.call("remembered_database", serde_json::json!({}))
                .unwrap(),
            serde_json::Value::Null
        );
        let err = app
            .call("remember_database", serde_json::json!({ "path": path }))
            .unwrap_err();
        assert!(err.contains(ACCESS_DENIED), "unexpected error: {err}");

        let _ = std::fs::remove_file(&vault);
    }

    #[test]
    fn a_key_file_association_round_trips_and_grants_a_read() {
        let vault = temp_file("keyed.kdbx");
        let db_path = vault.to_string_lossy().into_owned();
        let key_path = "/Users/me/secret.key".to_string();

        let access = access();
        access.grant_database(&vault);
        access.grant_read(Path::new(&key_path));
        let app = MockApp::new(access);

        app.call(
            "remember_key_file",
            serde_json::json!({ "dbPath": db_path, "keyPath": key_path }),
        )
        .unwrap();

        assert_eq!(
            app.call(
                "remembered_key_file",
                serde_json::json!({ "dbPath": db_path })
            )
            .unwrap(),
            serde_json::Value::String(key_path.clone())
        );

        // Dropping the association is the same call with no key file.
        app.call(
            "remember_key_file",
            serde_json::json!({ "dbPath": db_path, "keyPath": null }),
        )
        .unwrap();
        assert_eq!(
            app.call(
                "remembered_key_file",
                serde_json::json!({ "dbPath": db_path })
            )
            .unwrap(),
            serde_json::Value::Null
        );

        let _ = std::fs::remove_file(&vault);
    }

    #[test]
    fn a_key_file_cannot_be_associated_unless_it_was_picked() {
        let vault = temp_file("unkeyed.kdbx");
        let db_path = vault.to_string_lossy().into_owned();

        let access = access();
        access.grant_database(&vault);
        let app = MockApp::new(access);

        let err = app
            .call(
                "remember_key_file",
                serde_json::json!({ "dbPath": db_path, "keyPath": "/Users/me/.ssh/id_ed25519" }),
            )
            .unwrap_err();

        assert!(err.contains(ACCESS_DENIED), "unexpected error: {err}");

        let _ = std::fs::remove_file(&vault);
    }
}
