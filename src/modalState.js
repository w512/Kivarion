/**
 * How many modal dialogs are currently on screen.
 *
 * `BaseModal` keeps this in step, so it counts every dialog in the app —
 * DatabasePage's own confirmations as well as the attachment modals that
 * `EntryDetail` owns — without each caller having to publish a flag of its own.
 * A page-level computed would only ever know about that page's modals, and the
 * shortcut it fails to block runs behind whichever dialog it did not know about.
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
