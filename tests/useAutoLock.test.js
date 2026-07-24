import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createRenderer, nextTick, reactive } from 'vue';

let currentStore;
let router;
let lockDatabaseMock;
let timers;
let nextTimerId;
let clearTimeoutMock;
let originalSetTimeout;
let originalClearTimeout;
let originalWindowDescriptor;
let originalDocumentDescriptor;
let originalDateNow;
let now;
let fakeWindow;
let fakeDocument;
let systemInteractionActive;

mock.module('../src/store.js', () => ({
    SETTING_LIMITS: {
        backupDepth: { min: 1, max: 20, defaultValue: 3 },
    },
    clampNumberSetting: (value, { min, max, defaultValue }) => {
        const number = Number(value);
        if (!Number.isFinite(number)) return defaultValue;
        return Math.min(max, Math.max(min, Math.trunc(number)));
    },
    useStore: () => currentStore,
}));

mock.module('vue-router', () => ({
    useRouter: () => router,
}));

mock.module('../src/composables/useDatabaseLock.js', () => ({
    lockDatabase: (...args) => lockDatabaseMock(...args),
}));

mock.module('../src/composables/useSystemInteraction.js', () => ({
    isSystemInteractionActive: () => systemInteractionActive,
    withSystemInteraction: async (run) => run(),
}));

const { useAutoLock } = await import('../src/composables/useAutoLock.js');

const renderer = createRenderer({
    patchProp() {},
    insert(child, parent) {
        parent.children ||= [];
        parent.children.push(child);
    },
    remove() {},
    createElement(type) {
        return { type };
    },
    createText(text) {
        return { text };
    },
    createComment(text) {
        return { comment: text };
    },
    setText(node, text) {
        node.text = text;
    },
    setElementText(node, text) {
        node.text = text;
    },
    parentNode() {
        return null;
    },
    nextSibling() {
        return null;
    },
});

function makeEventTarget(extra = {}) {
    const listeners = {};
    return {
        listeners,
        addEventListener: mock((event, handler) => {
            listeners[event] = handler;
        }),
        removeEventListener: mock((event, handler) => {
            if (listeners[event] === handler) delete listeners[event];
        }),
        ...extra,
    };
}

function mountAutoLock() {
    const app = renderer.createApp({
        setup() {
            useAutoLock();
            return () => null;
        },
    });
    app.mount({});
    return { unmount: () => app.unmount() };
}

beforeEach(() => {
    currentStore = reactive({
        db: { id: 'db' },
        autoLockTimeout: 1,
        lockOnFocusLoss: false,
    });
    router = { replace: mock(async () => {}) };
    lockDatabaseMock = mock(() => {});
    timers = [];
    nextTimerId = 1;
    now = 10_000;

    originalSetTimeout = globalThis.setTimeout;
    originalClearTimeout = globalThis.clearTimeout;
    originalWindowDescriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        'window',
    );
    originalDocumentDescriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        'document',
    );
    originalDateNow = Date.now;

    globalThis.setTimeout = mock((callback, delay) => {
        const id = nextTimerId++;
        timers.push({ id, callback, delay });
        return id;
    });
    clearTimeoutMock = mock(() => {});
    globalThis.clearTimeout = clearTimeoutMock;
    Date.now = () => now;

    systemInteractionActive = false;
    fakeWindow = makeEventTarget();
    fakeDocument = makeEventTarget({ hidden: false, hasFocus: () => false });
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: fakeWindow,
    });
    Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: fakeDocument,
    });
});

afterEach(() => {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    Date.now = originalDateNow;

    if (originalWindowDescriptor) {
        Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
    } else {
        delete globalThis.window;
    }

    if (originalDocumentDescriptor) {
        Object.defineProperty(
            globalThis,
            'document',
            originalDocumentDescriptor,
        );
    } else {
        delete globalThis.document;
    }
});

describe('useAutoLock', () => {
    test('schedules an app-level lock timer and locks unconditionally when it fires', async () => {
        mountAutoLock();
        await nextTick();

        expect(timers).toHaveLength(1);
        expect(timers[0].delay).toBe(60_000);

        timers[0].callback();

        expect(lockDatabaseMock).toHaveBeenCalledWith(router);
    });

    test('registers touch/scroll/focus activity and resets the timer on activity', async () => {
        mountAutoLock();
        await nextTick();

        expect(fakeWindow.addEventListener).toHaveBeenCalledWith(
            'touchstart',
            expect.any(Function),
            { passive: true },
        );
        expect(fakeWindow.addEventListener).toHaveBeenCalledWith(
            'focus',
            expect.any(Function),
            { passive: true },
        );
        expect(fakeDocument.addEventListener).toHaveBeenCalledWith(
            'scroll',
            expect.any(Function),
            { passive: true, capture: true },
        );

        const firstTimer = timers[0];
        now += 3_000;
        fakeWindow.listeners.touchstart();

        expect(clearTimeoutMock).toHaveBeenCalledWith(firstTimer.id);
        expect(timers).toHaveLength(2);
        expect(timers[1].delay).toBe(60_000);
    });

    test('locks on visibility loss when the setting is enabled', async () => {
        currentStore.lockOnFocusLoss = true;
        fakeDocument.hidden = true;
        mountAutoLock();
        await nextTick();

        fakeDocument.listeners.visibilitychange();

        expect(lockDatabaseMock).toHaveBeenCalledWith(router);
    });

    test('does not lock on focus loss while the OS holds focus (dialog, Touch ID, Quick Look)', async () => {
        currentStore.lockOnFocusLoss = true;
        systemInteractionActive = true;
        mountAutoLock();
        await nextTick();

        fakeWindow.listeners.blur();

        expect(lockDatabaseMock).not.toHaveBeenCalled();
    });

    test('still locks when the re-check finds the window in the background', async () => {
        currentStore.lockOnFocusLoss = true;
        systemInteractionActive = true;
        mountAutoLock();
        await nextTick();

        fakeWindow.listeners.blur();
        const recheck = timers.find((timer) => timer.delay === 1500);
        expect(recheck).toBeTruthy();

        // The dialog closed but the user really did switch to another app.
        systemInteractionActive = false;
        recheck.callback();

        expect(lockDatabaseMock).toHaveBeenCalledWith(router);
    });

    test('cancels the pending re-check when focus comes back', async () => {
        currentStore.lockOnFocusLoss = true;
        systemInteractionActive = true;
        mountAutoLock();
        await nextTick();

        fakeWindow.listeners.blur();
        const recheck = timers.find((timer) => timer.delay === 1500);

        fakeWindow.listeners.focus();

        expect(clearTimeoutMock).toHaveBeenCalledWith(recheck.id);
        expect(lockDatabaseMock).not.toHaveBeenCalled();
    });

    test('removes listeners and clears the timer when the database closes', async () => {
        mountAutoLock();
        await nextTick();

        const firstTimer = timers[0];
        currentStore.db = null;
        await nextTick();

        expect(clearTimeoutMock).toHaveBeenCalledWith(firstTimer.id);
        expect(fakeWindow.removeEventListener).toHaveBeenCalledWith(
            'touchstart',
            expect.any(Function),
        );
        expect(fakeDocument.removeEventListener).toHaveBeenCalledWith(
            'scroll',
            expect.any(Function),
            { capture: true },
        );
    });
});
