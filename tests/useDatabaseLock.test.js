import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

let currentStore;
let clearManagedClipboardMock;
let originalWindowDescriptor;
let originalCustomEvent;
let dispatchedEvents;
let localStorageMemory;

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

mock.module('../src/composables/useClipboard.js', () => ({
    clearManagedClipboard: () => clearManagedClipboardMock(),
}));

const { lockDatabase } = await import('../src/composables/useDatabaseLock.js');

beforeEach(() => {
    currentStore = {
        db: { id: 'db' },
        fileName: 'vault.kdbx',
        selectedGroupUuid: 'group-1',
        filePath: '/Users/test/vault.kdbx',
        knownMtime: 123,
    };
    clearManagedClipboardMock = mock(async () => {});
    dispatchedEvents = [];
    localStorageMemory = { 'kivarion-last-db-path': '/Users/test/vault.kdbx' };
    globalThis.localStorage = {
        removeItem: mock((key) => {
            delete localStorageMemory[key];
        }),
    };

    originalWindowDescriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        'window',
    );
    originalCustomEvent = globalThis.CustomEvent;

    globalThis.CustomEvent = class CustomEvent {
        constructor(type) {
            this.type = type;
        }
    };
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {
            dispatchEvent: mock((event) => {
                dispatchedEvents.push(event.type);
            }),
        },
    });
});

afterEach(() => {
    if (originalWindowDescriptor) {
        Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
    } else {
        delete globalThis.window;
    }
    globalThis.CustomEvent = originalCustomEvent;
});

describe('lockDatabase', () => {
    test('broadcasts before-lock, clears sensitive clipboard state and resets the open database', async () => {
        const router = { replace: mock(async () => {}) };

        await lockDatabase(router);

        expect(dispatchedEvents).toEqual(['kivarion:before-lock']);
        expect(clearManagedClipboardMock).toHaveBeenCalled();
        expect(currentStore.db).toBeNull();
        expect(currentStore.fileName).toBe('');
        expect(currentStore.selectedGroupUuid).toBeNull();
        expect(currentStore.filePath).toBe('/Users/test/vault.kdbx');
        expect(router.replace).toHaveBeenCalledWith({ name: 'home' });
    });

    test('can forget the selected file when closing the database', async () => {
        await lockDatabase(null, { forgetFile: true });

        expect(currentStore.filePath).toBeNull();
        expect(currentStore.knownMtime).toBeNull();
        expect(localStorageMemory['kivarion-last-db-path']).toBeUndefined();
    });
});
