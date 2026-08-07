//! The macOS application menu.
//!
//! Kivarion gets Tauri's default menu for free, but the "About Kivarion" panel
//! it opens shows nothing beyond the name and the version — and that panel is
//! where a user looks for what the app is built from. The icon set in
//! particular is someone else's ISC-licensed artwork, so the attribution has to
//! be somewhere the user can actually see it.
//!
//! Only the About item's metadata differs from `Menu::default`; everything else
//! is mirrored item for item. The Edit submenu especially is not decoration —
//! a webview whose menu has no Cut/Copy/Paste items loses those shortcuts.
//!
//! macOS only, because that is the only platform Tauri gives a default menu to.
//! Elsewhere the same credits are in Settings → "About Kivarion".

use tauri::menu::{AboutMetadata, Menu, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Runtime};

/// The body of the About panel. Deliberately without URLs: macOS renders this
/// as plain text (muda hands the string to `NSAttributedString` unstyled), so a
/// link here would be something to squint at and retype. The clickable ones are
/// in `AboutModal`, and none of these licenses asks for a link anyway — ISC and
/// MIT ask for the notice, which is a separate job from this list.
pub const CREDITS: &str = concat!(
    "Built with open-source work:\n\n",
    "Lucide — the icon set (ISC)\n",
    "kdbxweb — KDBX reading and writing (MIT)\n",
    "Tauri — the desktop shell (MIT / Apache-2.0)\n",
    "Vue — the interface (MIT)",
);

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let package = app.package_info();
    let about = AboutMetadata {
        name: Some(package.name.clone()),
        version: Some(package.version.to_string()),
        copyright: app.config().bundle.copyright.clone(),
        credits: Some(CREDITS.to_string()),
        ..Default::default()
    };

    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                package.name.clone(),
                true,
                &[
                    &PredefinedMenuItem::about(app, None, Some(about))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::services(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    // Cmd+Q still goes through the `ExitRequested` guard in
                    // `run()`, so an unsaved change is not lost here.
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "File",
                true,
                &[&PredefinedMenuItem::close_window(app, None)?],
            )?,
            &Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "View",
                true,
                &[&PredefinedMenuItem::fullscreen(app, None)?],
            )?,
            &Submenu::with_items(
                app,
                "Window",
                true,
                &[
                    &PredefinedMenuItem::minimize(app, None)?,
                    &PredefinedMenuItem::maximize(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::close_window(app, None)?,
                ],
            )?,
        ],
    )
}

#[cfg(test)]
mod tests {
    use super::CREDITS;

    #[test]
    fn credits_attribute_the_bundled_icon_set() {
        // The whole reason this menu exists rather than Tauri's default one.
        assert!(CREDITS.contains("Lucide"));
        assert!(CREDITS.contains("ISC"));
    }

    #[test]
    fn credits_carry_no_links() {
        // The panel is plain text, so a URL here can only be retyped by hand.
        assert!(!CREDITS.contains("http"));
    }
}
