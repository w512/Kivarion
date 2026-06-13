import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { reactive } from 'vue';

let currentStore;
let writeFileMock = mock(async () => {});
let renameMock = mock(async () => {});
let copyFileMock = mock(async () => {});
let existsMock = mock(async () => true);
let removeMock = mock(async () => {});
let consoleErrorSpy;

mock.module('../src/store.js', () => ({
    useStore: () => currentStore,
}));

mock.module('@tauri-apps/plugin-fs', () => ({
    writeFile: (...args) => writeFileMock(...args),
    rename: (...args) => renameMock(...args),
    copyFile: (...args) => copyFileMock(...args),
    exists: (...args) => existsMock(...args),
    remove: (...args) => removeMock(...args),
}));

const { useDatabaseActions } = await import('../src/composables/useDatabaseActions.js');

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
    writeFileMock = mock(async () => {});
    renameMock = mock(async () => {});
    copyFileMock = mock(async () => {});
    existsMock = mock(async () => true);
    removeMock = mock(async () => {});
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

        writeFileMock = mock(async () => {
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

        expect(writeFileMock.mock.calls.length).toBe(1);
        expect(actions.isSaving.value).toBe(true);

        store.dbVersion = 2;
        const secondResult = actions.saveDatabaseChanges();
        await tick();

        expect(secondResult).toBe(firstResult);
        expect(writeFileMock.mock.calls.length).toBe(1);
        expect(maxActiveWrites).toBe(1);

        firstWrite.resolve();
        await waitFor(() => {
            expect(writeFileMock.mock.calls.length).toBe(2);
        });

        expect(writeFileMock.mock.calls.length).toBe(2);
        expect(maxActiveWrites).toBe(1);
        expect(writeFileMock.mock.calls[0][0]).not.toBe(writeFileMock.mock.calls[1][0]);

        secondWrite.resolve();

        await expect(firstResult).resolves.toBe(true);
        await expect(secondResult).resolves.toBe(true);
        expect(maxActiveWrites).toBe(1);
        expect(dbSaveMock.mock.calls.length).toBe(2);
        expect(renameMock.mock.calls.length).toBe(2);
        expect(actions.lastSavedDbVersion.value).toBe(2);
        expect(actions.hasUnsavedChanges.value).toBe(false);
        expect(actions.saveError.value).toBe(null);
    });

    test('deduplicates repeated save requests for an already saved version', async () => {
        const { store, dbSaveMock } = makeStore();
        const actions = useDatabaseActions(store);
        const firstWrite = deferred();

        writeFileMock = mock(async () => {
            await firstWrite.promise;
        });

        store.dbVersion = 1;
        const firstResult = actions.saveDatabaseChanges();
        await tick();
        const secondResult = actions.saveDatabaseChanges();
        await tick();

        expect(secondResult).toBe(firstResult);
        expect(writeFileMock.mock.calls.length).toBe(1);

        firstWrite.resolve();

        await expect(firstResult).resolves.toBe(true);
        expect(writeFileMock.mock.calls.length).toBe(1);
        expect(dbSaveMock.mock.calls.length).toBe(1);
        expect(renameMock.mock.calls.length).toBe(1);
        expect(actions.lastSavedDbVersion.value).toBe(1);
        expect(actions.hasUnsavedChanges.value).toBe(false);
    });

    test('retries an existing save error even when the db version did not change', async () => {
        const { store } = makeStore();
        const actions = useDatabaseActions(store);

        actions.saveError.value = 'previous disk error';

        await expect(actions.saveDatabaseChanges()).resolves.toBe(true);
        expect(writeFileMock.mock.calls.length).toBe(1);
        expect(actions.saveError.value).toBe(null);
        expect(actions.hasUnsavedChanges.value).toBe(false);
        expect(actions.lastSavedDbVersion.value).toBe(0);
    });

    test('keeps database dirty after a failed fs write and allows retry', async () => {
        const { store } = makeStore();
        const actions = useDatabaseActions(store);

        writeFileMock = mock(async () => {
            throw new Error('disk full');
        });

        store.dbVersion = 1;

        await expect(actions.saveDatabaseChanges()).resolves.toBe(false);
        expect(writeFileMock.mock.calls.length).toBe(1);
        expect(removeMock.mock.calls.length).toBe(1);
        expect(actions.saveError.value).toBe('disk full');
        expect(actions.hasUnsavedChanges.value).toBe(true);
        expect(actions.lastSavedDbVersion.value).toBe(0);

        writeFileMock = mock(async () => {});

        await expect(actions.saveDatabaseChanges()).resolves.toBe(true);
        expect(writeFileMock.mock.calls.length).toBe(1);
        expect(actions.saveError.value).toBe(null);
        expect(actions.hasUnsavedChanges.value).toBe(false);
        expect(actions.lastSavedDbVersion.value).toBe(1);
    });
});
