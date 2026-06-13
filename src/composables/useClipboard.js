import { ref, onUnmounted } from 'vue';
import { useStore } from '../store';

// Shared clipboard helper: copies text, drives the "Copied!" mini-toast, and
// optionally auto-clears the clipboard after `store.clipboardTimeout` seconds.
// Each component gets its own instance so the toast state and timers are scoped
// to that component and cancelled on unmount.
export function useClipboard() {
    const store = useStore();
    const activeCopyField = ref(null);
    let toastTimer = null;
    let clearTimer = null;

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
            if (timeout > 0) {
                if (clearTimer) clearTimeout(clearTimer);
                clearTimer = setTimeout(async () => {
                    clearTimer = null;
                    try {
                        const currentText = await navigator.clipboard.readText();
                        if (currentText === text) {
                            await navigator.clipboard.writeText('');
                        }
                    } catch (err) {
                        console.error('Failed to clear clipboard', err);
                    }
                }, timeout * 1000);
            }
            return true;
        } catch (err) {
            console.error('Failed to copy', err);
            return false;
        }
    }

    function cancelTimers() {
        if (toastTimer) {
            clearTimeout(toastTimer);
            toastTimer = null;
        }
        if (clearTimer) {
            clearTimeout(clearTimer);
            clearTimer = null;
        }
    }

    onUnmounted(cancelTimers);

    return { activeCopyField, copy };
}
