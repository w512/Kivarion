import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createRenderer } from 'vue';

let currentStore;
let timers;
let nextTimerId;
let clearTimeoutMock;
let originalSetTimeout;
let originalClearTimeout;
let originalNavigatorDescriptor;
let clipboardText;
let clipboardWrites;

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

const { useClipboard, clearManagedClipboard } =
    await import('../src/composables/useClipboard.js');

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

function mountClipboard() {
    let api;
    const app = renderer.createApp({
        setup() {
            api = useClipboard();
            return () => null;
        },
    });
    app.mount({});
    return { api, unmount: () => app.unmount() };
}

beforeEach(async () => {
    currentStore = { clipboardTimeout: 30 };
    timers = [];
    nextTimerId = 1;
    clipboardText = '';
    clipboardWrites = [];

    originalSetTimeout = globalThis.setTimeout;
    originalClearTimeout = globalThis.clearTimeout;
    originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        'navigator',
    );

    globalThis.setTimeout = mock((callback, delay) => {
        const id = nextTimerId++;
        timers.push({ id, callback, delay });
        return id;
    });
    clearTimeoutMock = mock(() => {});
    globalThis.clearTimeout = clearTimeoutMock;

    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: {
            clipboard: {
                readText: mock(async () => clipboardText),
                writeText: mock(async (text) => {
                    clipboardText = text;
                    clipboardWrites.push(text);
                }),
            },
        },
    });

    await clearManagedClipboard();
});

afterEach(async () => {
    await clearManagedClipboard();

    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;

    if (originalNavigatorDescriptor) {
        Object.defineProperty(
            globalThis,
            'navigator',
            originalNavigatorDescriptor,
        );
    } else {
        delete globalThis.navigator;
    }
});

describe('useClipboard', () => {
    test('keeps the auto-clear timer alive after the component unmounts', async () => {
        const { api, unmount } = mountClipboard();

        await api.copy('secret-password', 'password', { autoClear: true });

        const toastTimer = timers.find((timer) => timer.delay === 1500);
        const clearTimer = timers.find((timer) => timer.delay === 30_000);
        expect(toastTimer).toBeTruthy();
        expect(clearTimer).toBeTruthy();
        expect(clipboardText).toBe('secret-password');

        unmount();

        expect(clearTimeoutMock).toHaveBeenCalledWith(toastTimer.id);
        expect(clearTimeoutMock).not.toHaveBeenCalledWith(clearTimer.id);

        await clearTimer.callback();

        expect(clipboardText).toBe('');
        expect(clipboardWrites).toContain('');
    });

    test('clears the clipboard even when it cannot be read back', async () => {
        const { api, unmount } = mountClipboard();
        await api.copy('secret-password', null, { autoClear: true });

        // WKWebView rejects readText when the window is not focused — which is
        // exactly when the auto-clear timer fires. The secret must still go.
        navigator.clipboard.readText = mock(async () => {
            throw new Error('Document is not focused');
        });

        const clearTimer = timers.find((timer) => timer.delay === 30_000);
        await clearTimer.callback();

        expect(clipboardWrites).toContain('');
        unmount();
    });

    test('keeps tracking the secret when clearing fails so a later lock retries', async () => {
        const { api, unmount } = mountClipboard();
        await api.copy('secret-password', null, { autoClear: true });

        navigator.clipboard.writeText = mock(async () => {
            throw new Error('Clipboard write blocked');
        });

        const clearTimer = timers.find((timer) => timer.delay === 30_000);
        await clearTimer.callback();
        expect(clipboardText).toBe('secret-password');

        // Writing works again (e.g. the window regained focus) — locking the
        // database must still be able to wipe the value.
        navigator.clipboard.writeText = mock(async (text) => {
            clipboardText = text;
            clipboardWrites.push(text);
        });
        await clearManagedClipboard();

        expect(clipboardText).toBe('');
        unmount();
    });

    test('tracks protected copies even when timed auto-clear is disabled so lock can clear them', async () => {
        currentStore.clipboardTimeout = 0;
        const { api, unmount } = mountClipboard();

        await api.copy('secret-password', null, { autoClear: true });

        expect(timers).toHaveLength(0);
        expect(clipboardText).toBe('secret-password');

        unmount();
        await clearManagedClipboard();

        expect(clipboardText).toBe('');
    });
});
