import {
    afterEach,
    beforeEach,
    describe,
    expect,
    mock,
    spyOn,
    test,
} from 'bun:test';
import { reactive } from 'vue';

let currentStore;
// The backend `save_database` command now performs the atomic temp/backup/rename
// write, so the frontend only issues a single invoke per save. We mock that
// invoke to drive the save-queue behaviour under test.
let saveInvokeMock = mock(async () => {});
let consoleErrorSpy;

mock.module('../src/store.js', () => ({
    useStore: () => currentStore,
}));

mock.module('@tauri-apps/api/core', () => ({
    invoke: (cmd, args) => {
        if (cmd === 'save_database') return saveInvokeMock(cmd, args);
        return Promise.resolve();
    },
}));

const { useDatabaseActions } =
    await import('../src/composables/useDatabaseActions.js');

function makeStore() {
    const dbSaveMock = mock(async () => new Uint8Array([1, 2, 3]).buffer);
    currentStore = reactive({
        db: { save: dbSaveMock },
        fileName: 'vault.kdbx',
        filePath: '/Users/test/vault.kdbx',
        dbVersion: 0,
    });
    return { store: currentStore, dbSaveMock };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

async function tick() {
    await Promise.resolve();
    await Promise.resolve();
}

async function waitFor(assertion, attempts = 20) {
    let lastError;
    for (let i = 0; i < attempts; i++) {
        try {
            assertion();
            return;
        } catch (error) {
            lastError = error;
            await tick();
        }
    }
    throw lastError;
}

beforeEach(() => {
    currentStore = null;
    saveInvokeMock = mock(async () => {});
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    consoleErrorSpy?.mockRestore();
});

describe('useDatabaseActions save queue', () => {
    test('serializes concurrent saves and saves the latest queued version', async () => {
        const { store, dbSaveMock } = makeStore();
        const actions = useDatabaseActions(store);
        const firstWrite = deferred();
        const secondWrite = deferred();
        let activeWrites = 0;
        let maxActiveWrites = 0;
        let writeIndex = 0;

        saveInvokeMock = mock(async () => {
            activeWrites++;
            maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
            const current = writeIndex++ === 0 ? firstWrite : secondWrite;
            try {
                await current.promise;
            } finally {
                activeWrites--;
            }
        });

        store.dbVersion = 1;
        const firstResult = actions.saveDatabaseChanges();
        await tick();

        expect(saveInvokeMock.mock.calls.length).toBe(1);
        expect(actions.isSaving.value).toBe(true);

        store.dbVersion = 2;
        const secondResult = actions.saveDatabaseChanges();
        await tick();

        expect(secondResult).toBe(firstResult);
        expect(saveInvokeMock.mock.calls.length).toBe(1);
        expect(maxActiveWrites).toBe(1);

        firstWrite.resolve();
        await waitFor(() => {
            expect(saveInvokeMock.mock.calls.length).toBe(2);
        });

        expect(saveInvokeMock.mock.calls.length).toBe(2);
        expect(maxActiveWrites).toBe(1);

        secondWrite.resolve();

        await expect(firstResult).resolves.toBe(true);
        await expect(secondResult).resolves.toBe(true);
        expect(maxActiveWrites).toBe(1);
        expect(dbSaveMock.mock.calls.length).toBe(2);
        expect(saveInvokeMock.mock.calls.length).toBe(2);
        expect(actions.lastSavedDbVersion.value).toBe(2);
        expect(actions.hasUnsavedChanges.value).toBe(false);
        expect(actions.saveError.value).toBe(null);
    });

    test('deduplicates repeated save requests for an already saved version', async () => {
        const { store, dbSaveMock } = makeStore();
        const actions = useDatabaseActions(store);
        const firstWrite = deferred();

        saveInvokeMock = mock(async () => {
            await firstWrite.promise;
        });

        store.dbVersion = 1;
        const firstResult = actions.saveDatabaseChanges();
        await tick();
        const secondResult = actions.saveDatabaseChanges();
        await tick();

        expect(secondResult).toBe(firstResult);
        expect(saveInvokeMock.mock.calls.length).toBe(1);

        firstWrite.resolve();

        await expect(firstResult).resolves.toBe(true);
        expect(saveInvokeMock.mock.calls.length).toBe(1);
        expect(dbSaveMock.mock.calls.length).toBe(1);
        expect(actions.lastSavedDbVersion.value).toBe(1);
        expect(actions.hasUnsavedChanges.value).toBe(false);
    });

    test('retries an existing save error even when the db version did not change', async () => {
        const { store } = makeStore();
        const actions = useDatabaseActions(store);

        actions.saveError.value = 'previous disk error';

        await expect(actions.saveDatabaseChanges()).resolves.toBe(true);
        expect(saveInvokeMock.mock.calls.length).toBe(1);
        expect(actions.saveError.value).toBe(null);
        expect(actions.hasUnsavedChanges.value).toBe(false);
        expect(actions.lastSavedDbVersion.value).toBe(0);
    });

    test('raises a conflict on external modification and clears it on force overwrite', async () => {
        const { store } = makeStore();
        const actions = useDatabaseActions(store);

        // The backend refuses the save because the file changed on disk.
        saveInvokeMock = mock(async () => {
            throw new Error('EXTERNAL_CONFLICT: the file was modified on disk');
        });
        store.dbVersion = 1;

        await expect(actions.saveDatabaseChanges()).resolves.toBe(false);
        expect(actions.saveConflict.value).toBe(true);
        // A conflict is not a generic error.
        expect(actions.saveError.value).toBe(null);
        expect(actions.hasUnsavedChanges.value).toBe(true);

        // The user chooses to overwrite; the forced save succeeds.
        saveInvokeMock = mock(async () => 1234);
        await expect(
            actions.saveDatabaseChanges({ force: true }),
        ).resolves.toBe(true);
        expect(actions.saveConflict.value).toBe(false);
        expect(actions.hasUnsavedChanges.value).toBe(false);
        expect(actions.lastSavedDbVersion.value).toBe(1);
    });

    test('keeps database dirty after a failed save and allows retry', async () => {
        const { store } = makeStore();
        const actions = useDatabaseActions(store);

        saveInvokeMock = mock(async () => {
            throw new Error('disk full');
        });

        store.dbVersion = 1;

        await expect(actions.saveDatabaseChanges()).resolves.toBe(false);
        expect(saveInvokeMock.mock.calls.length).toBe(1);
        expect(actions.saveError.value).toBe('disk full');
        expect(actions.hasUnsavedChanges.value).toBe(true);
        expect(actions.lastSavedDbVersion.value).toBe(0);

        saveInvokeMock = mock(async () => {});

        await expect(actions.saveDatabaseChanges()).resolves.toBe(true);
        expect(saveInvokeMock.mock.calls.length).toBe(1);
        expect(actions.saveError.value).toBe(null);
        expect(actions.hasUnsavedChanges.value).toBe(false);
        expect(actions.lastSavedDbVersion.value).toBe(1);
    });
});
