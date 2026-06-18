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
import * as kdbxweb from 'kdbxweb';

// These tests focus on the concurrency guards in `useDatabaseAuth`: a user can
// switch the selected file (or cancel a Touch ID prompt) while an async
// read/KDF is in flight, and the composable must never cross-apply a password
// or open a stale database. We mock the store, Tauri `invoke` and the file
// dialog, and spy on `Kdbx.load` so the logic can run without a backend or a
// real database. We deliberately do NOT mock the whole `kdbxweb` module —
// `mock.module` is process-global in Bun and would leak a fake `ProtectedValue`
// into other test files; a restorable `spyOn` keeps the real crypto types.

let currentStore;
let invokeHandlers;
let kdbxLoadMock;
let loadSpy;
let consoleErrorSpy;

mock.module('../src/store.js', () => ({
    useStore: () => currentStore,
}));

mock.module('@tauri-apps/plugin-dialog', () => ({
    open: mock(async () => null),
}));

mock.module('@tauri-apps/api/core', () => ({
    invoke: (cmd, args) => {
        const handler = invokeHandlers[cmd];
        return handler ? handler(args) : Promise.resolve();
    },
}));

const { useDatabaseAuth } =
    await import('../src/composables/useDatabaseAuth.js');

function makeAuth() {
    const router = { push: mock(() => {}) };
    const passwordInputRef = { value: { focus: () => {} } };
    const auth = useDatabaseAuth(router, passwordInputRef);
    return { auth, router };
}

function deferred() {
    let resolve;
    const promise = new Promise((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

async function tick() {
    await Promise.resolve();
    await Promise.resolve();
}

beforeEach(() => {
    const memory = {};
    globalThis.localStorage = {
        getItem: (k) => (k in memory ? memory[k] : null),
        setItem: (k, v) => {
            memory[k] = String(v);
        },
        removeItem: (k) => {
            delete memory[k];
        },
    };

    currentStore = reactive({ filePath: null });
    invokeHandlers = {
        is_biometric_available: async () => false,
        file_exists: async () => true,
        read_database: async () => new Uint8Array([1, 2, 3]),
        file_mtime: async () => 1000,
        load_biometric_password: async () => 'secret',
        save_biometric_password: async () => {},
        delete_biometric_password: async () => {},
    };
    kdbxLoadMock = mock(async () => ({ id: 'db' }));
    loadSpy = spyOn(kdbxweb.Kdbx, 'load').mockImplementation((...args) =>
        kdbxLoadMock(...args),
    );
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    loadSpy?.mockRestore();
    consoleErrorSpy?.mockRestore();
});

describe('useDatabaseAuth.decrypt', () => {
    test('opens the database and navigates on success', async () => {
        const { auth, router } = makeAuth();
        currentStore.filePath = '/a.kdbx';
        auth.fileName.value = 'a.kdbx';
        auth.password.value = 'pw';
        const fakeDb = { id: 'opened' };
        kdbxLoadMock = mock(async () => fakeDb);

        await auth.decrypt();

        // `currentStore` is a Vue reactive proxy, so compare by value.
        expect(currentStore.db).toEqual(fakeDb);
        expect(router.push).toHaveBeenCalledTimes(1);
        expect(auth.password.value).toBe('');
        expect(auth.isLoading.value).toBe(false);
        expect(localStorage.getItem('kivarion-last-db-path')).toBe('/a.kdbx');
    });

    test('discards the result if the selected file changes mid-decrypt', async () => {
        const { auth, router } = makeAuth();
        currentStore.filePath = '/a.kdbx';
        auth.password.value = 'pw';
        const load = deferred();
        kdbxLoadMock = mock(async () => {
            await load.promise;
            return { id: 'stale' };
        });

        const pending = auth.decrypt();
        await tick();
        // User switches to a different file while the KDF is still running.
        currentStore.filePath = '/b.kdbx';
        load.resolve();
        await pending;

        expect(currentStore.db).toBeUndefined();
        expect(router.push).not.toHaveBeenCalled();
    });

    test('ignores an explicit path that no longer matches the selection', async () => {
        const { auth, router } = makeAuth();
        currentStore.filePath = '/a.kdbx';
        auth.password.value = 'pw';
        let readCalls = 0;
        invokeHandlers.read_database = async () => {
            readCalls++;
            return new Uint8Array([1]);
        };

        await auth.decrypt('/different.kdbx');

        expect(readCalls).toBe(0);
        expect(router.push).not.toHaveBeenCalled();
        expect(currentStore.db).toBeUndefined();
    });

    test('reports an incorrect password on an InvalidKey error', async () => {
        const { auth } = makeAuth();
        currentStore.filePath = '/a.kdbx';
        auth.password.value = 'wrong';
        kdbxLoadMock = mock(async () => {
            const err = new Error('bad key');
            err.code = 'InvalidKey';
            throw err;
        });

        await auth.decrypt();

        expect(auth.errorMessage.value).toBe(
            'Incorrect password. Please try again.',
        );
        expect(currentStore.db).toBeUndefined();
        expect(auth.isLoading.value).toBe(false);
    });
});

describe('useDatabaseAuth.attemptBiometricUnlock', () => {
    test('ignores a path that is not the current selection', async () => {
        const { auth } = makeAuth();
        currentStore.filePath = '/a.kdbx';
        let loadCalls = 0;
        invokeHandlers.load_biometric_password = async () => {
            loadCalls++;
            return 'secret';
        };

        await auth.attemptBiometricUnlock('/b.kdbx');

        expect(loadCalls).toBe(0);
        expect(auth.isLoading.value).toBe(false);
    });

    test('does not apply a secret after the file switches mid-prompt', async () => {
        const { auth } = makeAuth();
        currentStore.filePath = '/a.kdbx';
        const load = deferred();
        invokeHandlers.load_biometric_password = async () => {
            await load.promise;
            return 'secret';
        };
        let readCalls = 0;
        invokeHandlers.read_database = async () => {
            readCalls++;
            return new Uint8Array([1]);
        };

        const pending = auth.attemptBiometricUnlock('/a.kdbx');
        await tick();
        // The OS prompt was open; the user picked a different file meanwhile.
        currentStore.filePath = '/b.kdbx';
        load.resolve();
        await pending;

        expect(readCalls).toBe(0);
        expect(auth.password.value).toBe('');
        expect(currentStore.db).toBeUndefined();
        expect(auth.isLoading.value).toBe(false);
    });
});
