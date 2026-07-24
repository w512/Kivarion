import { ref, onUnmounted } from 'vue';
import { useStore } from '../store';

let clearTimer = null;
let managedClipboardText = null;

async function clearClipboardIfStillManaged() {
    if (managedClipboardText === null) return;

    // Read first so a value the user copied afterwards survives. `readText`
    // rejects in a webview that does not have focus — which is exactly when
    // this tends to run — and a failed read must not be taken as "leave it
    // alone": wiping an unrelated clipboard entry is far better than leaving a
    // password sitting in the clipboard forever. So clear blind on error.
    let holdsOurSecret = true;
    try {
        holdsOurSecret =
            (await navigator.clipboard.readText()) === managedClipboardText;
    } catch (err) {
        console.error('Could not read the clipboard; clearing it anyway', err);
    }

    if (!holdsOurSecret) {
        managedClipboardText = null;
        return;
    }

    try {
        await navigator.clipboard.writeText('');
        managedClipboardText = null;
    } catch (err) {
        // Keep tracking the value so a later attempt (the next lock, or app
        // close) can retry, instead of silently giving up on the secret.
        console.error('Failed to clear clipboard', err);
    }
}

function cancelClearTimer() {
    if (clearTimer) {
        clearTimeout(clearTimer);
        clearTimer = null;
    }
}

export async function clearManagedClipboard() {
    cancelClearTimer();
    await clearClipboardIfStillManaged();
}

// Shared clipboard helper: copies text, drives the "Copied!" mini-toast, and
// optionally auto-clears the clipboard after `store.clipboardTimeout` seconds.
// The clear timer is module-level so it survives component unmounts (switching
// entries or locking the database must not leave copied passwords forever).
export function useClipboard() {
    const store = useStore();
    const activeCopyField = ref(null);
    let toastTimer = null;

    // copy(text, fieldId?, { autoClear }) — fieldId drives the toast; pass
    // autoClear: true to wipe the clipboard after the configured timeout
    // (used for passwords and protected fields). Returns true on success.
    async function copy(text, fieldId = null, { autoClear = false } = {}) {
        if (!text) return false;
        try {
            await navigator.clipboard.writeText(text);

            if (fieldId !== null) {
                activeCopyField.value = fieldId;
                if (toastTimer) clearTimeout(toastTimer);
                toastTimer = setTimeout(() => {
                    activeCopyField.value = null;
                    toastTimer = null;
                }, 1500);
            }

            const timeout = autoClear ? store.clipboardTimeout : 0;
            if (autoClear) {
                managedClipboardText = text;
                cancelClearTimer();
                if (timeout > 0) {
                    clearTimer = setTimeout(async () => {
                        clearTimer = null;
                        await clearClipboardIfStillManaged();
                    }, timeout * 1000);
                }
            }
            return true;
        } catch (err) {
            console.error('Failed to copy', err);
            return false;
        }
    }

    function cancelToastTimer() {
        if (toastTimer) {
            clearTimeout(toastTimer);
            toastTimer = null;
        }
    }

    onUnmounted(cancelToastTimer);

    return { activeCopyField, copy };
}
