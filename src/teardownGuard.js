/**
 * Who decides what happens when the window is closed or the app is quit.
 *
 * The guard itself is registered once, for the application's lifetime, in
 * `App.vue`: there can only be one `onCloseRequested` listener, because Tauri's
 * wrapper finalizes every unprevented close by calling `destroy()` — a second
 * listener would destroy the window the first one had just prevented.
 *
 * The interesting part of the decision, though, belongs to `DatabasePage`: the
 * entry-edit draft, the "Saving changes…" modal, the save-error banner and the
 * conflict modal all live there. So that page registers its handler here while
 * it is on screen, and `App.vue` consults it. When it is not on screen —
 * Settings is reachable with a database still open — `App.vue` brings the user
 * back to it rather than growing a second copy of the same dialogs.
 *
 * The handler takes the function that finishes the teardown (destroy the
 * window / exit the app) and returns `true` when it has taken the teardown
 * over, i.e. the caller must not finish it itself.
 */
let pageHandler = null;

/** @param {(finish: () => void) => boolean} handler */
export function setTeardownPageHandler(handler) {
    pageHandler = handler ?? null;
}

/**
 * Deregister, but only if the page doing it is still the one registered — a
 * remount can run the new page's `onMounted` before the old one's `onUnmounted`.
 */
export function clearTeardownPageHandler(handler) {
    if (pageHandler === handler) pageHandler = null;
}

export function teardownPageHandler() {
    return pageHandler;
}
