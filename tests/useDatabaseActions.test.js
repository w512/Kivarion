import {
    afterEach,
    beforeEach,
    describe,
    expect,
    mock,
    spyOn,
    test,
} from 'bun:test';
import { reactive, shallowReactive, watch } from 'vue';
import * as kdbxweb from 'kdbxweb';

let currentStore;
// The backend `save_database` command now performs the atomic temp/backup/rename
// write, so the frontend only issues a single invoke per save. We mock that
// invoke to drive the save-queue behaviour under test.
let saveInvokeMock = mock(async () => {});
let readInvokeMock = mock(async () => new Uint8Array());
let mtimeInvokeMock = mock(async () => null);
let consoleErrorSpy;

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

mock.module('@tauri-apps/api/core', () => ({
    // `invokeWithBytes` calls `invoke(cmd, bytes, { headers })`, so the third
    // argument is where the scalar arguments (target path, expected mtime)
    // actually travel — pass it through, or a test cannot see them.
    invoke: (cmd, args, options) => {
        if (cmd === 'save_database') return saveInvokeMock(cmd, args, options);
        if (cmd === 'read_database') return readInvokeMock(cmd, args);
        if (cmd === 'file_mtime') return mtimeInvokeMock(cmd, args);
        return Promise.resolve();
    },
}));

/** The scalar arguments of the n-th `save_database` invoke, header names undone. */
function saveArgs(index = 0) {
    const headers = saveInvokeMock.mock.calls[index]?.[2]?.headers ?? {};
    return Object.fromEntries(
        Object.entries(headers).map(([name, value]) => [
            name.replace(/^x-kivarion-/, ''),
            decodeURIComponent(value),
        ]),
    );
}

const { resetDatabaseActions, useDatabaseActions } =
    await import('../src/composables/useDatabaseActions.js');
const { buildUpdatedCredentials, saveDatabase } =
    await import('../src/dbHelper.js');

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
    // The composable is a singleton now (its state has to outlive
    // DatabasePage), so a test must not inherit the instance — nor the
    // `store.db` watcher — that the previous one left behind.
    resetDatabaseActions();
    saveInvokeMock = mock(async () => {});
    readInvokeMock = mock(async () => new Uint8Array());
    mtimeInvokeMock = mock(async () => null);
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

    test('debounces ordinary auto-saves but an explicit flush remains immediate', async () => {
        const { store } = makeStore();
        const actions = useDatabaseActions(store);

        store.dbVersion = 1;
        actions.saveDatabaseChanges({ debounce: true });
        await tick();
        expect(saveInvokeMock.mock.calls.length).toBe(0);

        await expect(actions.saveDatabaseChanges()).resolves.toBe(true);
        expect(saveInvokeMock.mock.calls.length).toBe(1);

        // The explicit flush cancels the delayed callback, so it cannot write
        // the same database version again after the debounce window.
        await new Promise((resolve) => setTimeout(resolve, 350));
        expect(saveInvokeMock.mock.calls.length).toBe(1);
    });

    test('flushes a pending debounced save so a lock cannot drop it', async () => {
        const { store } = makeStore();
        const actions = useDatabaseActions(store);

        // Nothing waiting: the flush must not start a write of its own.
        expect(await actions.flushPendingSave()).toBe(false);
        expect(saveInvokeMock.mock.calls.length).toBe(0);

        store.dbVersion = 1;
        actions.saveDatabaseChanges({ debounce: true });
        const flushed = actions.flushPendingSave();

        // Auto-lock nulls the database right after dispatching before-lock; the
        // save is already under way with the database it captured.
        store.db = null;

        await expect(flushed).resolves.toBe(true);
        expect(saveInvokeMock.mock.calls.length).toBe(1);
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
        // Kept alongside the flag, or the next conflict would flash this
        // timestamp before its own is read.
        expect(actions.conflictDiskMtime.value).toBe(null);
    });

    test('has the on-disk time ready before it raises the conflict', async () => {
        const { store } = makeStore();
        const actions = useDatabaseActions(store);
        saveInvokeMock = mock(async () => {
            throw new Error('EXTERNAL_CONFLICT: the file was modified on disk');
        });
        mtimeInvokeMock = mock(async () => 777);
        store.dbVersion = 1;

        // The modal renders the moment `saveConflict` turns true, so it must
        // not turn true while the timestamp still belongs to a previous one.
        let mtimeWhenRaised;
        const stop = watch(
            () => actions.saveConflict.value,
            (raised) => {
                if (raised) mtimeWhenRaised = actions.conflictDiskMtime.value;
            },
            { flush: 'sync' },
        );

        await actions.saveDatabaseChanges();
        stop();

        expect(mtimeWhenRaised).toBe(777);
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

describe('useDatabaseActions across a page remount', () => {
    // `DatabaseHeader` links to Settings without closing the database, which
    // unmounts DatabasePage. While this composable was built per page, that
    // threw away the dirty marker, the save error and the conflict along with
    // it: a failed save came back from Settings looking like a clean database,
    // and the next Lock or Close dropped the changes without asking.
    test('keeps a failed save outstanding while the page is away', async () => {
        const { store } = makeStore();
        const actions = useDatabaseActions(store);
        saveInvokeMock = mock(async () => {
            throw new Error('disk on fire');
        });

        store.dbVersion = 1;
        await expect(actions.saveDatabaseChanges()).resolves.toBe(false);
        expect(actions.hasUnsavedChanges.value).toBe(true);

        // Off to Settings and back: the page is rebuilt, the state is not.
        const remounted = useDatabaseActions(store);

        expect(remounted).toBe(actions);
        expect(remounted.hasUnsavedChanges.value).toBe(true);
        expect(remounted.saveError.value).toContain('disk on fire');
    });

    test('starts clean when a different database is opened', async () => {
        const { store } = makeStore();
        const actions = useDatabaseActions(store);
        saveInvokeMock = mock(async () => {
            throw new Error('disk on fire');
        });

        store.dbVersion = 1;
        await actions.saveDatabaseChanges();
        expect(actions.hasUnsavedChanges.value).toBe(true);

        // Locked, then another vault unlocked. Whatever was outstanding
        // belonged to a database that is now unreachable.
        store.db = null;
        await tick();
        store.db = { save: mock(async () => new Uint8Array([9]).buffer) };
        store.dbVersion = 7;
        await tick();

        expect(actions.hasUnsavedChanges.value).toBe(false);
        expect(actions.saveError.value).toBe(null);
        expect(actions.saveConflict.value).toBe(false);
    });

    test('a write that outlives its database does not mark the next one dirty', async () => {
        const { store } = makeStore();
        const actions = useDatabaseActions(store);
        const write = deferred();
        saveInvokeMock = mock(() => write.promise);

        store.dbVersion = 1;
        const saving = actions.saveDatabaseChanges();
        await tick();

        // The database is replaced while the write is still in flight.
        store.db = { save: mock(async () => new Uint8Array([9]).buffer) };
        store.dbVersion = 9;
        await tick();
        expect(actions.hasUnsavedChanges.value).toBe(false);

        write.resolve(4242);
        await saving;

        // The old write must not report itself as "version 1 is saved" against
        // a database whose current version is 9 — nor raise its errors here.
        expect(actions.hasUnsavedChanges.value).toBe(false);
        expect(actions.saveError.value).toBe(null);
    });
});

describe('useDatabaseActions post-save work', () => {
    // A rekey brings two records with it that describe the file rather than the
    // open database: which key file unlocks it, and the master password kept
    // for Touch ID. They used to be written only when the save issued alongside
    // them succeeded, so a save that failed and was then retried from the
    // banner left the file rekeyed while both still described the old
    // credentials — the wrong key file offered next launch, Touch ID handing
    // over a password the database no longer had.
    test('runs queued work on the save that finally succeeds, not the one that failed', async () => {
        const { store } = makeStore();
        const actions = useDatabaseActions(store);
        const done = [];
        saveInvokeMock = mock(async () => {
            throw new Error('SAVE_LOCKED: another window');
        });

        store.dbVersion = 1;
        actions.runAfterSuccessfulSave(async () => done.push('key file'));
        actions.runAfterSuccessfulSave(async () => done.push('touch id'));

        await expect(actions.saveDatabaseChanges()).resolves.toBe(false);
        expect(done).toEqual([]);

        // The user hits Retry on the error banner.
        saveInvokeMock = mock(async () => 4242);
        await expect(actions.saveDatabaseChanges()).resolves.toBe(true);

        expect(done).toEqual(['key file', 'touch id']);
    });

    test('runs each queued action once', async () => {
        const { store } = makeStore();
        const actions = useDatabaseActions(store);
        const done = [];
        saveInvokeMock = mock(async () => 4242);

        store.dbVersion = 1;
        actions.runAfterSuccessfulSave(() => done.push('once'));
        await actions.saveDatabaseChanges();

        store.dbVersion = 2;
        await actions.saveDatabaseChanges();

        expect(done).toEqual(['once']);
    });

    test('a failing action does not report the save as failed', async () => {
        const { store } = makeStore();
        const actions = useDatabaseActions(store);
        saveInvokeMock = mock(async () => 4242);

        store.dbVersion = 1;
        actions.runAfterSuccessfulSave(() => {
            throw new Error('Keychain refused');
        });

        // The vault is on disk; this is bookkeeping beside it.
        await expect(actions.saveDatabaseChanges()).resolves.toBe(true);
    });

    test('drops queued work when the database is closed', async () => {
        const { store } = makeStore();
        const actions = useDatabaseActions(store);
        const done = [];
        saveInvokeMock = mock(async () => {
            throw new Error('disk on fire');
        });

        store.dbVersion = 1;
        actions.runAfterSuccessfulSave(() => done.push('stale'));
        await actions.saveDatabaseChanges();

        // Locked, then another vault opened and saved. The queued work is about
        // a rekey of the first one — and closes over its master password.
        store.db = null;
        await tick();
        store.db = { save: mock(async () => new Uint8Array([9]).buffer) };
        await tick();
        saveInvokeMock = mock(async () => 5555);
        store.dbVersion = 9;
        await actions.saveDatabaseChanges();

        expect(done).toEqual([]);
    });
});

describe('useDatabaseActions reload from disk', () => {
    // A real kdbx round-trip rather than a stub: reload has to survive an
    // actual `Kdbx.load` with the credentials of the open database, which is
    // the whole point of resolving a conflict without re-prompting.
    async function makeRealDatabase(name) {
        const credentials = new kdbxweb.Credentials(
            kdbxweb.ProtectedValue.fromString('123'),
        );
        await credentials.ready;
        const db = kdbxweb.Kdbx.create(credentials, name);
        // AES-KDF keeps this independent of the Argon2 engine that `main.js`
        // wires into kdbxweb at app start.
        db.setKdf(kdbxweb.Consts.KdfId.Aes);
        return db;
    }

    async function makeReloadStore() {
        // shallowReactive: `store.db` must stay the raw Kdbx, exactly like the
        // `shallowRef` the real store uses. A deep proxy over the object graph
        // would not survive being handed back to kdbxweb.
        currentStore = shallowReactive({
            db: await makeRealDatabase('In memory'),
            fileName: 'vault.kdbx',
            filePath: '/Users/test/vault.kdbx',
            dbVersion: 0,
            knownMtime: 1000,
            touchDb: () => {
                currentStore.dbVersion++;
            },
        });
        return currentStore;
    }

    test('replaces the open database with the version on disk and clears the conflict', async () => {
        const store = await makeReloadStore();
        const openDb = store.db;
        const onDisk = await makeRealDatabase('From disk');
        const diskBytes = new Uint8Array(await onDisk.save());

        readInvokeMock = mock(async () => diskBytes);
        mtimeInvokeMock = mock(async () => 4242);

        const actions = useDatabaseActions(store);
        // Local edits that the user agreed to discard.
        store.dbVersion = 5;
        actions.saveConflict.value = true;

        await expect(actions.reloadDatabaseFromDisk()).resolves.toBe(true);

        expect(store.db).not.toBe(openDb);
        expect(store.db.meta.name).toBe('From disk');
        expect(store.knownMtime).toBe(4242);
        expect(actions.saveConflict.value).toBe(false);
        expect(actions.conflictDiskMtime.value).toBe(null);
        expect(actions.saveError.value).toBe(null);
        // Memory now matches the file, so nothing is outstanding.
        expect(actions.hasUnsavedChanges.value).toBe(false);
    });

    test('records the mtime of the bytes it read, not of the file afterwards', async () => {
        const store = await makeReloadStore();
        const onDisk = await makeRealDatabase('From disk');
        const diskBytes = new Uint8Array(await onDisk.save());
        const order = [];
        let diskMtime = 4242;

        mtimeInvokeMock = mock(async () => {
            order.push('mtime');
            return diskMtime;
        });
        readInvokeMock = mock(async () => {
            order.push('read');
            // Another writer lands while this read (and the KDF that follows it)
            // is in flight; the version now on disk is not the one in memory.
            diskMtime = 9999;
            return diskBytes;
        });

        const actions = useDatabaseActions(store);
        store.dbVersion = 5;
        actions.saveConflict.value = true;

        await expect(actions.reloadDatabaseFromDisk()).resolves.toBe(true);

        expect(order).toEqual(['mtime', 'read']);
        // The next save must conflict on this rather than silently overwrite.
        expect(store.knownMtime).toBe(4242);
    });

    test('a failed reload keeps the conflict open and leaves the database untouched', async () => {
        const store = await makeReloadStore();
        const openDb = store.db;
        // Not a kdbx file — e.g. the disk version uses a different password.
        readInvokeMock = mock(async () => new Uint8Array([1, 2, 3, 4]));

        const actions = useDatabaseActions(store);
        store.dbVersion = 3;
        actions.saveConflict.value = true;

        await expect(actions.reloadDatabaseFromDisk()).resolves.toBe(false);

        expect(store.db).toBe(openDb);
        // The choice stays on screen; the banner explains why this half of it
        // did not work.
        expect(actions.saveConflict.value).toBe(true);
        expect(actions.saveError.value).toContain('Could not reload');
        expect(actions.hasUnsavedChanges.value).toBe(true);
    });

    test('records the on-disk mtime when a conflict is raised', async () => {
        const { store } = makeStore();
        mtimeInvokeMock = mock(async () => 987654);
        saveInvokeMock = mock(async () => {
            throw new Error('EXTERNAL_CONFLICT: the file was modified on disk');
        });

        const actions = useDatabaseActions(store);
        store.dbVersion = 1;

        await expect(actions.saveDatabaseChanges()).resolves.toBe(false);

        expect(actions.saveConflict.value).toBe(true);
        expect(actions.conflictDiskMtime.value).toBe(987654);
    });

    test('refuses to reload while a save is in flight', async () => {
        const store = await makeReloadStore();
        const openDb = store.db;
        const write = deferred();
        saveInvokeMock = mock(async () => {
            await write.promise;
        });

        const actions = useDatabaseActions(store);
        store.dbVersion = 1;
        const saving = actions.saveDatabaseChanges();
        await tick();

        await expect(actions.reloadDatabaseFromDisk()).resolves.toBe(false);
        expect(store.db).toBe(openDb);

        write.resolve();
        await saving;
    });

    // A master password / key file change is applied to the open database before
    // anything can be written with it, so a failed save leaves memory keyed
    // differently from the file. Taking the disk version then hit `InvalidKey`
    // under a generic message, and only retrying the save got out of it.
    describe('with a rekey that has not been saved', () => {
        async function rekeyInMemory(store, password) {
            const credentialsOnDisk = store.db.credentials;
            const updated = new kdbxweb.Credentials(
                kdbxweb.ProtectedValue.fromString(password),
            );
            await updated.ready;
            store.db.credentials = updated;
            return credentialsOnDisk;
        }

        test('reloads the file with the credentials it still has', async () => {
            const store = await makeReloadStore();
            const onDisk = await makeRealDatabase('From disk');
            const diskBytes = new Uint8Array(await onDisk.save());
            readInvokeMock = mock(async () => diskBytes);
            mtimeInvokeMock = mock(async () => 4242);

            const actions = useDatabaseActions(store);
            const credentialsOnDisk = await rekeyInMemory(store, 'brand new');
            actions.rememberCredentialsOnDisk(credentialsOnDisk);
            actions.saveConflict.value = true;

            await expect(actions.reloadDatabaseFromDisk()).resolves.toBe(true);

            expect(store.db.meta.name).toBe('From disk');
            // Discarding local changes discards the unsaved rekey with them, so
            // the reloaded database is keyed like the file.
            expect(store.db.credentials).toBe(credentialsOnDisk);
            expect(actions.saveConflict.value).toBe(false);
            expect(actions.saveError.value).toBe(null);
        });

        test('keeps only the credentials the file actually has', async () => {
            const store = await makeReloadStore();
            const onDisk = await makeRealDatabase('From disk');
            const diskBytes = new Uint8Array(await onDisk.save());
            readInvokeMock = mock(async () => diskBytes);

            const actions = useDatabaseActions(store);
            const credentialsOnDisk = await rekeyInMemory(store, 'first try');
            actions.rememberCredentialsOnDisk(credentialsOnDisk);
            // A second change while the first one is still unsaved must not
            // replace the record: the file is keyed with neither of them.
            const afterFirstRekey = await rekeyInMemory(store, 'second try');
            actions.rememberCredentialsOnDisk(afterFirstRekey);

            await expect(actions.reloadDatabaseFromDisk()).resolves.toBe(true);
            expect(store.db.credentials).toBe(credentialsOnDisk);
        });

        test('forgets them once a save has made the rekey real', async () => {
            const store = await makeReloadStore();
            const onDisk = await makeRealDatabase('From disk');
            const diskBytes = new Uint8Array(await onDisk.save());
            readInvokeMock = mock(async () => diskBytes);
            saveInvokeMock = mock(async () => 5000);

            const actions = useDatabaseActions(store);
            const credentialsOnDisk = await rekeyInMemory(store, 'brand new');
            actions.rememberCredentialsOnDisk(credentialsOnDisk);

            store.dbVersion = 1;
            await expect(actions.saveDatabaseChanges()).resolves.toBe(true);

            // The file is keyed with the new credentials now; the old ones must
            // not be able to resurrect a version that no longer exists.
            await expect(actions.reloadDatabaseFromDisk()).resolves.toBe(false);
            expect(actions.saveError.value).toContain('does not open with');
        });

        test('explains an InvalidKey reload instead of reporting a raw error', async () => {
            const store = await makeReloadStore();
            const onDisk = await makeRealDatabase('From disk');
            const diskBytes = new Uint8Array(await onDisk.save());
            readInvokeMock = mock(async () => diskBytes);

            const actions = useDatabaseActions(store);
            // Nothing remembered: the file was rekeyed by another program.
            await rekeyInMemory(store, 'brand new');

            await expect(actions.reloadDatabaseFromDisk()).resolves.toBe(false);

            expect(actions.saveError.value).toContain(
                'does not open with this database',
            );
            expect(actions.saveError.value).not.toContain('InvalidKey');
        });
    });
});

describe('buildUpdatedCredentials', () => {
    async function makeCredentials(password, keyFile = null) {
        const credentials = new kdbxweb.Credentials(
            kdbxweb.ProtectedValue.fromString(password),
            keyFile,
        );
        await credentials.ready;
        return credentials;
    }

    // A 32-byte key file is taken as raw key material, so no XML parsing here.
    const keyFile = new Uint8Array(32).fill(7);

    test('carries over the key file when only the password changes', async () => {
        const current = await makeCredentials('old', keyFile);

        const updated = await buildUpdatedCredentials(current, {
            password: 'new',
        });

        expect(updated.passwordHash.getText()).not.toBe(
            current.passwordHash.getText(),
        );
        expect(updated.keyFileHash).toBe(current.keyFileHash);
    });

    test('carries over the password when only the key file changes', async () => {
        const current = await makeCredentials('old');

        const updated = await buildUpdatedCredentials(current, {
            keyFileBuffer: keyFile,
            keyFileChanged: true,
        });

        expect(updated.passwordHash).toBe(current.passwordHash);
        expect(updated.keyFileHash).toBeDefined();
    });

    test('drops the key file when it is removed', async () => {
        const current = await makeCredentials('old', keyFile);

        const updated = await buildUpdatedCredentials(current, {
            keyFileBuffer: null,
            keyFileChanged: true,
        });

        expect(updated.passwordHash).toBe(current.passwordHash);
        expect(updated.keyFileHash).toBeUndefined();
    });

    test('leaves the current credentials untouched when the key file is rejected', async () => {
        const current = await makeCredentials('old', keyFile);
        const previousPasswordHash = current.passwordHash;
        const previousKeyFileHash = current.keyFileHash;
        // A key file of an unsupported version: `setKeyFile` rejects on this,
        // and applying the password first would have rekeyed the database
        // halfway — to a password the user never got to confirm.
        const badKeyFile = new TextEncoder().encode(
            '<?xml version="1.0" encoding="utf-8"?><KeyFile><Meta><Version>9.0</Version></Meta><Key><Data>AAAA</Data></Key></KeyFile>',
        );

        await expect(
            buildUpdatedCredentials(current, {
                password: 'new',
                keyFileBuffer: badKeyFile,
                keyFileChanged: true,
            }),
        ).rejects.toThrow();

        expect(current.passwordHash).toBe(previousPasswordHash);
        expect(current.keyFileHash).toBe(previousKeyFileHash);
    });
});

describe('saveDatabase without a file path', () => {
    beforeEach(() => {
        saveInvokeMock = mock(async () => 1000);
    });

    test('refuses instead of reporting a save that never happened', async () => {
        // There used to be a browser-download fallback here. In a desktop
        // webview it writes nothing, and it returned normally, so the caller
        // cleared its unsaved-changes state over a file that was never written.
        const { dbSaveMock } = makeStore();
        currentStore.filePath = null;

        await expect(
            saveDatabase(currentStore.db, 'vault.kdbx'),
        ).rejects.toThrow(/no file path/i);

        expect(saveInvokeMock).not.toHaveBeenCalled();
        // Nothing was serialized either: there is no point encrypting a vault
        // that has nowhere to go.
        expect(dbSaveMock).not.toHaveBeenCalled();
    });

    test('still saves normally once a path is present', async () => {
        const { dbSaveMock } = makeStore();

        await saveDatabase(currentStore.db, 'vault.kdbx');

        expect(dbSaveMock).toHaveBeenCalled();
        expect(saveInvokeMock).toHaveBeenCalledTimes(1);
    });
});

describe('saveDatabase when another database is opened mid-write', () => {
    // Serializing a large vault is a full KDF plus the encryption of every
    // byte — seconds. Auto-lock drops `store.db` without cancelling a save
    // already under way, and the user is then free to open a different file. If
    // the target were read after `db.save()`, those bytes would land on the
    // wrong vault, and with the new file's `knownMtime` already in the store
    // even the concurrency check would let it through.
    beforeEach(() => {
        saveInvokeMock = mock(async () => 5555);
    });

    function serializingStore() {
        const serialized = deferred();
        const { store } = makeStore();
        store.db = { save: mock(() => serialized.promise) };
        store.knownMtime = 1000;
        return { store, serialized };
    }

    test('writes to the file it started from, not the one opened meanwhile', async () => {
        const { store, serialized } = serializingStore();

        const saving = saveDatabase(store.db, 'vault.kdbx');
        await tick();

        // Auto-lock, then a different database picked and unlocked.
        store.db = null;
        store.filePath = '/Users/test/other.kdbx';
        store.knownMtime = 2000;

        serialized.resolve(new Uint8Array([1, 2, 3]).buffer);
        await saving;

        expect(saveArgs()).toMatchObject({
            path: '/Users/test/vault.kdbx',
            'expected-mtime': '1000',
        });
    });

    test('leaves the timestamp of the database now open alone', async () => {
        const { store, serialized } = serializingStore();

        const saving = saveDatabase(store.db, 'vault.kdbx');
        await tick();
        store.filePath = '/Users/test/other.kdbx';
        store.knownMtime = 2000;

        serialized.resolve(new Uint8Array([1, 2, 3]).buffer);
        await saving;

        // 5555 is the mtime of the file that was just written — recording it
        // against the other database would make its next save skip the
        // external-change check.
        expect(store.knownMtime).toBe(2000);
    });

    test('records the new timestamp when the same file is still open', async () => {
        const { store, serialized } = serializingStore();

        const saving = saveDatabase(store.db, 'vault.kdbx');
        serialized.resolve(new Uint8Array([1, 2, 3]).buffer);
        await saving;

        expect(store.knownMtime).toBe(5555);
    });
});
