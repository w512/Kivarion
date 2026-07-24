import { onMounted, onUnmounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useStore } from '../store.js';
import { lockDatabase } from './useDatabaseLock.js';
import { isSystemInteractionActive } from './useSystemInteraction.js';

const ACTIVITY_EVENTS = [
    'mousemove',
    'mousedown',
    'keydown',
    'touchstart',
    'touchmove',
    'pointerdown',
];
const DOCUMENT_ACTIVITY_EVENTS = ['scroll'];
const ACTIVITY_THROTTLE_MS = 2000;
// How long to wait before re-testing a focus loss that was suppressed because
// the OS held focus (native dialog, Touch ID, Quick Look).
const SYSTEM_INTERACTION_RECHECK_MS = 1500;

/**
 * App-level auto-lock. It stays active on every route while a database is open.
 */
export function useAutoLock() {
    const store = useStore();
    const router = useRouter();

    let lockTimer = null;
    let focusLossRecheckTimer = null;
    let listenersActive = false;
    let lastActivity = 0;

    function clearLockTimer() {
        if (lockTimer) {
            clearTimeout(lockTimer);
            lockTimer = null;
        }
    }

    function clearFocusLossRecheck() {
        if (focusLossRecheckTimer) {
            clearTimeout(focusLossRecheckTimer);
            focusLossRecheckTimer = null;
        }
    }

    function lockNow() {
        clearLockTimer();
        if (store.db) lockDatabase(router);
    }

    function resetLockTimer() {
        clearLockTimer();
        if (!store.db || store.autoLockTimeout <= 0) return;

        lockTimer = setTimeout(lockNow, store.autoLockTimeout * 60 * 1000);
    }

    function onActivity() {
        if (!store.db) return;

        const now = Date.now();
        if (now - lastActivity < ACTIVITY_THROTTLE_MS) return;
        lastActivity = now;
        resetLockTimer();
    }

    // A native dialog, the Touch ID prompt or Quick Look takes focus away from
    // the window and fires exactly the same events as the user switching apps.
    // Locking then would kill the very operation the user started, so those are
    // suppressed — and re-checked afterwards, because a real app switch during
    // a dialog must still end in a locked database.
    function lockOnFocusLoss() {
        if (!store.db || !store.lockOnFocusLoss) return;

        if (!isSystemInteractionActive()) {
            clearFocusLossRecheck();
            lockNow();
            return;
        }

        clearFocusLossRecheck();
        focusLossRecheckTimer = setTimeout(() => {
            focusLossRecheckTimer = null;
            // Focus came back to us: the dialog closed and the user is here.
            if (document.hasFocus?.() ?? true) return;
            lockOnFocusLoss();
        }, SYSTEM_INTERACTION_RECHECK_MS);
    }

    function onVisibilityChange() {
        if (!store.db) return;
        if (document.hidden) {
            lockOnFocusLoss();
        } else {
            clearFocusLossRecheck();
            onActivity();
        }
    }

    function onWindowBlur() {
        lockOnFocusLoss();
    }

    function onWindowFocus() {
        clearFocusLossRecheck();
        onActivity();
    }

    function addListeners() {
        if (listenersActive) return;
        for (const event of ACTIVITY_EVENTS) {
            window.addEventListener(event, onActivity, { passive: true });
        }
        for (const event of DOCUMENT_ACTIVITY_EVENTS) {
            document.addEventListener(event, onActivity, {
                passive: true,
                capture: true,
            });
        }
        // Regaining focus counts as activity and also settles any focus loss
        // that is still pending a re-check, so it gets its own handler.
        window.addEventListener('focus', onWindowFocus, { passive: true });
        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('blur', onWindowBlur);
        listenersActive = true;
    }

    function removeListeners() {
        if (!listenersActive) return;
        for (const event of ACTIVITY_EVENTS) {
            window.removeEventListener(event, onActivity);
        }
        for (const event of DOCUMENT_ACTIVITY_EVENTS) {
            document.removeEventListener(event, onActivity, { capture: true });
        }
        window.removeEventListener('focus', onWindowFocus);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        window.removeEventListener('blur', onWindowBlur);
        listenersActive = false;
    }

    function syncAutoLock() {
        if (store.db) {
            addListeners();
            resetLockTimer();
        } else {
            clearLockTimer();
            clearFocusLossRecheck();
            removeListeners();
        }
    }

    let stopWatch;
    onMounted(() => {
        stopWatch = watch(
            () => [store.db, store.autoLockTimeout, store.lockOnFocusLoss],
            syncAutoLock,
            { immediate: true },
        );
    });

    onUnmounted(() => {
        stopWatch?.();
        clearLockTimer();
        clearFocusLossRecheck();
        removeListeners();
    });
}
