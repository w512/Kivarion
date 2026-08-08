import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

let values;
let mediaQuery;
let themeChangeHandler;
let setThemeAttribute;
let useStore;

async function flushWatches() {
    await nextTick();
    await nextTick();
}

beforeEach(async () => {
    values = new Map();
    globalThis.localStorage = {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: (key) => values.delete(key),
    };
    themeChangeHandler = null;
    mediaQuery = {
        matches: false,
        addEventListener: mock((event, handler) => {
            if (event === 'change') themeChangeHandler = handler;
        }),
    };
    globalThis.window = {
        crypto: globalThis.crypto,
        matchMedia: mock(() => mediaQuery),
    };
    setThemeAttribute = mock(() => {});
    globalThis.document = {
        documentElement: { setAttribute: setThemeAttribute },
    };

    // The query keeps this real module separate from the store mocks used by
    // composable tests in the same Bun process.
    ({ useStore } = await import('../src/store.js?store-behaviour-tests'));
    setActivePinia(createPinia());
});

describe('Pinia store settings', () => {
    test('clamps persisted numbers and restores boolean preferences', () => {
        values.set('kivarion-clipboard-timeout', '-20');
        values.set('kivarion-autolock-timeout', '9999');
        values.set('kivarion-backup-depth', 'not a number');
        values.set('kivarion-lock-on-focus-loss', 'true');
        values.set('kivarion-download-site-icons', 'false');
        values.set('kivarion-backup-enabled', 'false');
        values.set('kivarion-theme', 'dark');

        const store = useStore();

        expect(store.clipboardTimeout).toBe(0);
        expect(store.autoLockTimeout).toBe(1440);
        expect(store.backupDepth).toBe(3);
        expect(store.lockOnFocusLoss).toBe(true);
        expect(store.downloadSiteIcons).toBe(false);
        expect(store.backupEnabled).toBe(false);
        expect(setThemeAttribute).toHaveBeenCalledWith('data-theme', 'dark');
    });

    test('clamps changed settings before persisting them', async () => {
        const store = useStore();

        store.clipboardTimeout = 900;
        store.autoLockTimeout = -1;
        store.backupDepth = 100;
        await flushWatches();

        expect(store.clipboardTimeout).toBe(600);
        expect(store.autoLockTimeout).toBe(0);
        expect(store.backupDepth).toBe(20);
        expect(values.get('kivarion-clipboard-timeout')).toBe('600');
        expect(values.get('kivarion-autolock-timeout')).toBe('0');
        expect(values.get('kivarion-backup-depth')).toBe('20');
    });

    test('tracks system theme changes only while system mode is selected', async () => {
        mediaQuery.matches = true;
        const store = useStore();
        expect(setThemeAttribute).toHaveBeenLastCalledWith(
            'data-theme',
            'dark',
        );

        mediaQuery.matches = false;
        themeChangeHandler();
        expect(setThemeAttribute).toHaveBeenLastCalledWith(
            'data-theme',
            'light',
        );

        store.theme = 'dark';
        await flushWatches();
        const callsAfterDarkSelection = setThemeAttribute.mock.calls.length;
        mediaQuery.matches = true;
        themeChangeHandler();

        expect(setThemeAttribute).toHaveBeenCalledTimes(
            callsAfterDarkSelection,
        );
        expect(values.get('kivarion-theme')).toBe('dark');
    });

    test('increments the manual database reactivity version', () => {
        const store = useStore();

        expect(store.dbVersion).toBe(0);
        store.touchDb();
        store.touchDb();

        expect(store.dbVersion).toBe(2);
    });
});
