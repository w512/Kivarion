//! macOS Quick Look preview of a decrypted attachment.
//!
//! The bytes are written here, in Rust — never through a JS `fs` scope — into a
//! fresh owner-only directory under `$TMPDIR/Kivarion-quicklook/`, previewed
//! with `qlmanage -p`, and removed by an RAII guard so every error path cleans
//! up too. One directory per preview keeps identically named attachments and
//! concurrent previews apart.
//!
//! A crash can still leave decrypted bytes behind, so `run()` sweeps the root at
//! startup. The sweep keeps directories whose PID belongs to a live process — a
//! second Kivarion window starting up must not delete the bytes `qlmanage` is
//! displaying right now.
//!
//! Quick Look's own OS-managed thumbnail caches are outside the app's reach; say
//! so in user-facing docs rather than implying the bytes are fully gone.

use crate::{arg, raw_body};

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
pub(crate) fn quick_look_temp_root() -> std::path::PathBuf {
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
pub(crate) fn clear_quick_look_temp_dir_at(root: &std::path::Path) -> Result<(), String> {
    clear_quick_look_temp_dir_at_with(root, crate::process_is_running)
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
pub async fn quick_look_attachment(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let file_name = arg(&request, "file-name").ok_or("Missing attachment name")?;
    let data = raw_body(&request)?.to_vec();

    #[cfg(target_os = "macos")]
    {
        // `qlmanage` does not return until the user closes the preview, which
        // can be minutes — by far the longest block in the app, and the one
        // that must never sit on the main thread or an async worker.
        crate::run_blocking(move || preview_with_quick_look(&file_name, &data)).await?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (file_name, data);
        Err("Quick Look is only available on macOS".to_string())
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use crate::test_support::*;

    #[test]
    fn sanitize_file_name_strips_directories_and_dangerous_characters() {
        assert_eq!(sanitize_file_name("../secret.txt"), "secret.txt");
        assert_eq!(sanitize_file_name("dir\\evil\0name.txt"), "direvilname.txt");
        assert_eq!(sanitize_file_name(""), "attachment");
    }

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
}
