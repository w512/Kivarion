import { onMounted, onUnmounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useStore } from '../store.js';
import { lockDatabase } from './useDatabaseLock.js';

const ACTIVITY_EVENTS = [
    'mousemove',
    'mousedown',
    'keydown',
    'touchstart',
    'touchmove',
    'pointerdown',
    'focus',
];
const DOCUMENT_ACTIVITY_EVENTS = ['scroll'];
const ACTIVITY_THROTTLE_MS = 2000;

/**
 * App-level auto-lock. It stays active on every route while a database is open.
 */
export function useAutoLock() {
    const store = useStore();
    const router = useRouter();

    let lockTimer = null;
    let listenersActive = false;
    let lastActivity = 0;

    function clearLockTimer() {
        if (lockTimer) {
            clearTimeout(lockTimer);
            lockTimer = null;
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

    function onVisibilityChange() {
        if (!store.db) return;
        if (document.hidden && store.lockOnFocusLoss) {
            lockNow();
        } else if (!document.hidden) {
            onActivity();
        }
    }

    function onWindowBlur() {
        if (store.db && store.lockOnFocusLoss) lockNow();
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
        removeListeners();
    });
}
