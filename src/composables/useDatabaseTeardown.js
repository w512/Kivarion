import { computed, onMounted, onUnmounted, ref } from 'vue';
import { formatDate } from '../utils';
import {
    clearTeardownPageHandler,
    setTeardownPageHandler,
} from '../teardownGuard.js';
import { lockDatabase } from './useDatabaseLock.js';

/**
 * Leaving the open database safely: the in-app Lock/Close buttons, a native
 * window close or Cmd+Q, and the save conflict that can block either.
 *
 * The native teardown itself is registered once in `App.vue`, because a
 * listener that lives on this page disappears with it — and Settings is
 * reachable with the database still open. What *this page* owns is the
 * decision, so it registers `guardTeardown` in `src/teardownGuard.js` while
 * mounted and `App.vue` consults it.
 *
 * The conflict outcomes live here too: each of them is a decision a close/quit
 * can be parked on, so each has to either resume that teardown or cancel it.
 *
 * @param {object} deps
 * @param {object} deps.store - the Pinia store.
 * @param {object} deps.router - vue-router instance.
 * @param {object} deps.actions - `useDatabaseActions`.
 * @param {object} deps.selection - `useEntrySelection`.
 */
export function useDatabaseTeardown({ store, router, actions, selection }) {
    const showClosingSaveModal = ref(false);
    const showCloseAfterSaveErrorConfirm = ref(false);

    // What to run once nothing is pending: closing the window, or exiting the
    // app. Null when the teardown came from inside the app.
    let pendingTeardownFinish = null;

    onMounted(() => {
        // Not when the page mounts without a database — it redirects home in
        // that same tick, and `App.vue` returns *this* handler's answer instead
        // of running its own checks, so an unmounting page must not claim the
        // decision.
        if (store.db) setTeardownPageHandler(guardTeardown);
    });
    onUnmounted(() => clearTeardownPageHandler(guardTeardown));

    // Flush pending work, then run `finish` (close the window or exit the app).
    // Returns false when nothing needed guarding and `finish` was not called.
    function guardTeardown(finish) {
        if (
            !selection.hasDraft() &&
            !actions.isSaving.value &&
            !actions.hasUnsavedChanges.value
        ) {
            return false;
        }
        selection.requestNavigation(() => finishAfterFlush(finish));
        return true;
    }

    // Wait for the save queue to drain behind a visible "Saving changes…" modal —
    // a silent wait looks like a frozen app (saving a large vault takes seconds).
    // Runs `finish` when the flush succeeds (or immediately if nothing is
    // pending); a failed flush falls through to the save-error confirmation.
    function finishAfterFlush(finish) {
        if (!actions.isSaving.value && !actions.hasUnsavedChanges.value) {
            finish();
            return;
        }
        pendingTeardownFinish = finish;
        showClosingSaveModal.value = true;
        void actions.saveDatabaseChanges().then((saved) => {
            // The user may have clicked "Close anyway" / "Keep open" meanwhile.
            if (
                pendingTeardownFinish !== finish ||
                !showClosingSaveModal.value
            ) {
                return;
            }
            showClosingSaveModal.value = false;
            if (saved) {
                pendingTeardownFinish = null;
                finish();
            } else if (!actions.saveConflict.value) {
                // On a conflict the dedicated modal is already up and offers the
                // real choices; stacking "Close without saving?" on top of it would
                // hide the cause behind a message that never names it. That modal
                // resumes the teardown through `resumePendingTeardown`.
                showCloseAfterSaveErrorConfirm.value = true;
            }
        });
    }

    // Continue a close/quit that was parked while the user resolved a conflict.
    // Routed back through `finishAfterFlush` so a still-unsaved database gets the
    // same treatment it would have had, instead of closing with changes pending.
    function resumePendingTeardown() {
        const finish = pendingTeardownFinish;
        if (!finish) return;
        pendingTeardownFinish = null;
        finishAfterFlush(finish);
    }

    function confirmCloseWithoutWaiting() {
        const finish = pendingTeardownFinish;
        pendingTeardownFinish = null;
        showClosingSaveModal.value = false;
        finish?.();
    }

    function cancelClosingSave() {
        pendingTeardownFinish = null;
        showClosingSaveModal.value = false;
    }

    function closeDatabase({ forgetFile = false } = {}) {
        selection.requestNavigation(() =>
            finishAfterFlush(() => forceCloseDatabase({ forgetFile })),
        );
    }

    function lockDatabaseFromHeader() {
        closeDatabase();
    }

    function closeAndForgetDatabase() {
        closeDatabase({ forgetFile: true });
    }

    function forceCloseDatabase(options = null) {
        // Set when the confirmation was triggered by a native window close or an
        // app quit: confirming must finish that teardown, not lock to HomePage.
        // It is also what carries "forget this file" across the confirmation —
        // the closure `closeDatabase` parked here calls back into this function
        // with the flag, and by then this one is null.
        const finishTeardown = pendingTeardownFinish;
        pendingTeardownFinish = null;
        showCloseAfterSaveErrorConfirm.value = false;
        if (finishTeardown) {
            finishTeardown();
            return;
        }
        void lockDatabase(router, { forgetFile: options?.forgetFile ?? false });
    }

    function cancelCloseAfterSaveError() {
        pendingTeardownFinish = null;
        showCloseAfterSaveErrorConfirm.value = false;
    }

    const conflictDiskTime = computed(() =>
        actions.conflictDiskMtime.value
            ? formatDate(new Date(actions.conflictDiskMtime.value))
            : '',
    );

    async function overwriteOnConflict() {
        actions.saveConflict.value = false;
        await actions.saveDatabaseChanges({ force: true });
        resumePendingTeardown();
    }

    async function reloadFromConflict() {
        // The reload swaps the entire object graph; a half-typed entry draft
        // would otherwise be written back onto the freshly loaded entry.
        selection.discardDraft();

        if (!(await actions.reloadDatabaseFromDisk())) {
            // The reason is on the error banner — leave the choice on screen.
            return;
        }

        selection.restoreSelectionAfterReload();
        resumePendingTeardown();
    }

    function dismissConflict() {
        actions.saveConflict.value = false;
        // A close/quit that was waiting on this decision is cancelled with it.
        pendingTeardownFinish = null;
    }

    /** Drop every parked teardown and take its modals down, for a forced lock. */
    function reset() {
        pendingTeardownFinish = null;
        showClosingSaveModal.value = false;
        showCloseAfterSaveErrorConfirm.value = false;
    }

    return {
        showClosingSaveModal,
        showCloseAfterSaveErrorConfirm,
        conflictDiskTime,
        confirmCloseWithoutWaiting,
        cancelClosingSave,
        lockDatabaseFromHeader,
        closeAndForgetDatabase,
        forceCloseDatabase,
        cancelCloseAfterSaveError,
        overwriteOnConflict,
        reloadFromConflict,
        dismissConflict,
        reset,
    };
}
