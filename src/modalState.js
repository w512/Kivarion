import { onUnmounted, toValue, watch } from 'vue';

/**
 * How many modal dialogs are currently on screen.
 *
 * Every dialog registers through `useOpenModalCount` below — `BaseModal` for
 * almost all of them, `AttachmentPreviewModal` directly — so the count covers
 * the whole app: DatabasePage's own confirmations as well as the attachment
 * dialogs that `EntryDetail` owns, without each caller having to publish a flag
 * of its own. A page-level computed would only ever know about that page's
 * modals, and the shortcut it fails to block runs behind whichever dialog it
 * did not know about.
 *
 * The count lives at module level rather than in a store because it is read
 * from a `keydown` handler, where a plain function call is all that is wanted.
 */
let openModalCount = 0;

export function registerOpenModal() {
    openModalCount += 1;
}

export function unregisterOpenModal() {
    // Never let a stray unregister push the count below zero: it would take an
    // extra open just to get back to "a modal is showing", and the guard would
    // silently stop working.
    openModalCount = Math.max(0, openModalCount - 1);
}

export function isAnyModalOpen() {
    return openModalCount > 0;
}

/** Test seam: drop any count left behind by a previous test's modal. */
export function resetModalState() {
    openModalCount = 0;
}

/**
 * Keep a dialog counted for exactly as long as it is on screen.
 *
 * `BaseModal` uses this, so almost every dialog is covered by rendering through
 * it. `AttachmentPreviewModal` is the one that is not — its full-bleed preview
 * layout is its own — and it calls this directly rather than growing a second
 * copy of the bookkeeping. Getting that bookkeeping wrong is not a cosmetic
 * matter: while the preview went uncounted, Cmd+C behind it put the entry's
 * password on the clipboard where the user could not see it happen.
 *
 * Counted against `isOpen` rather than the component's lifetime: several
 * dialogs stay mounted for as long as the database is open and only their
 * contents come and go. The `immediate` watcher counts a dialog that renders
 * already-open, and the unmount release covers auto-lock tearing the subtree
 * down without `isOpen` ever going false.
 *
 * @param {import('vue').MaybeRefOrGetter<boolean>} isOpen
 */
export function useOpenModalCount(isOpen) {
    let counted = false;

    watch(
        () => !!toValue(isOpen),
        (showing) => {
            if (showing === counted) return;
            if (showing) registerOpenModal();
            else unregisterOpenModal();
            counted = showing;
        },
        { immediate: true },
    );

    onUnmounted(() => {
        if (!counted) return;
        unregisterOpenModal();
        counted = false;
    });
}
