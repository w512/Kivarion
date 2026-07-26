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
// or open a stale database. We mock the store and Tauri `invoke` — which now
// also covers the native dialogs and the remembered paths, since both moved
// into the backend — and spy on `Kdbx.load` so the logic can run without a
// backend or a real database. We deliberately do NOT mock the whole `kdbxweb` module —
// `mock.module` is process-global in Bun and would leak a fake `ProtectedValue`
// into other test files; a restorable `spyOn` keeps the real crypto types.

let currentStore;
let invokeHandlers;
let kdbxLoadMock;
let loadSpy;
let consoleErrorSpy;
let saveSpy;
let remembered;
let pickedPath;
let pickCalls;
let pickArgs;

// The "save as" dialog now lives in the backend: it returns the final path
// (extension included) and grants access to it.
function pickNewPath(path) {
    pickedPath = path;
}

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
    // Stands in for what the backend persists (and grants access to).
    remembered = { database: null, keyFiles: {} };
    pickedPath = null;
    pickCalls = 0;
    pickArgs = null;
    invokeHandlers = {
        is_biometric_available: async () => false,
        read_database: async () => new Uint8Array([1, 2, 3]),
        file_mtime: async () => 1000,
        save_database: async () => 2000,
        load_biometric_password: async () => 'secret',
        save_biometric_password: async () => {},
        delete_biometric_password: async () => {},
        pick_database_file: async () => null,
        pick_new_database_path: async (args) => {
            pickCalls++;
            pickArgs = args;
            return pickedPath;
        },
        pick_key_file: async () => null,
        remembered_database: async () => remembered.database,
        remember_database: async ({ path }) => {
            remembered.database = path;
        },
        remembered_key_file: async ({ dbPath }) =>
            remembered.keyFiles[dbPath] ?? null,
        remember_key_file: async ({ dbPath, keyPath }) => {
            if (keyPath) remembered.keyFiles[dbPath] = keyPath;
            else delete remembered.keyFiles[dbPath];
        },
    };
    kdbxLoadMock = mock(async () => ({ id: 'db' }));
    loadSpy = spyOn(kdbxweb.Kdbx, 'load').mockImplementation((...args) =>
        kdbxLoadMock(...args),
    );
    // Avoid running the real Argon2 KDF when saving a freshly created database.
    saveSpy = spyOn(kdbxweb.Kdbx.prototype, 'save').mockImplementation(
        async () => new Uint8Array([1, 2, 3]).buffer,
    );
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    loadSpy?.mockRestore();
    saveSpy?.mockRestore();
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
        expect(remembered.database).toBe('/a.kdbx');
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

    test('explains a missing stored password instead of failing silently', async () => {
        const { auth } = makeAuth();
        currentStore.filePath = '/a.kdbx';
        auth.useBiometrics.value = true;
        localStorage.setItem('kivarion-biometrics-/a.kdbx', 'true');
        invokeHandlers.load_biometric_password = async () => {
            throw 'BIOMETRIC_NOT_ENROLLED';
        };

        await auth.attemptBiometricUnlock('/a.kdbx');

        expect(auth.errorMessage.value).toContain('master password');
        expect(auth.useBiometrics.value).toBe(false);
        expect(localStorage.getItem('kivarion-biometrics-/a.kdbx')).toBe(null);
        expect(auth.isLoading.value).toBe(false);
    });

    test('stays silent when the user cancels the Touch ID prompt', async () => {
        const { auth } = makeAuth();
        currentStore.filePath = '/a.kdbx';
        invokeHandlers.load_biometric_password = async () => {
            throw 'Auth failed: "Canceled by user."';
        };

        await auth.attemptBiometricUnlock('/a.kdbx');

        expect(auth.errorMessage.value).toBe('');
    });

    test('surfaces unexpected biometric failures', async () => {
        const { auth } = makeAuth();
        currentStore.filePath = '/a.kdbx';
        invokeHandlers.load_biometric_password = async () => {
            throw 'The specified item could not be found in the keychain.';
        };

        await auth.attemptBiometricUnlock('/a.kdbx');

        expect(auth.errorMessage.value).toBe(
            'Touch ID unlock failed. Enter your master password.',
        );
    });
});

describe('useDatabaseAuth.decrypt error messages', () => {
    const cases = [
        ['BadSignature', 'This file is not a valid KDBX database.'],
        ['FileCorrupt', 'The database file appears to be corrupted.'],
        ['InvalidVersion', 'This KDBX format version is not supported.'],
        [
            'Unsupported',
            'This database uses a feature or algorithm that is not supported.',
        ],
    ];

    for (const [code, message] of cases) {
        test(`maps ${code} to a clear message`, async () => {
            const { auth } = makeAuth();
            currentStore.filePath = '/a.kdbx';
            auth.password.value = 'pw';
            kdbxLoadMock = mock(async () => {
                const err = new Error(code);
                err.code = code;
                throw err;
            });

            await auth.decrypt();

            expect(auth.errorMessage.value).toBe(message);
            expect(currentStore.db).toBeUndefined();
        });
    }
});

// Picking a file and remembering one are backend calls now, because that is
// where filesystem access is granted (`src-tauri/src/access.rs`). The frontend
// must never invent a path of its own: everything it hands to `read_database` /
// `save_database` has to come back from one of these commands.
describe('useDatabaseAuth file selection', () => {
    test('selects the file the backend dialog returned', async () => {
        const { auth } = makeAuth();
        invokeHandlers.pick_database_file = async () => '/Users/me/Vault.kdbx';
        remembered.keyFiles['/Users/me/Vault.kdbx'] = '/Users/me/key.key';

        await auth.selectFile();

        expect(currentStore.filePath).toBe('/Users/me/Vault.kdbx');
        expect(auth.fileName.value).toBe('Vault.kdbx');
        expect(auth.step.value).toBe(2);
        // The association is restored from the backend, not from localStorage.
        expect(auth.keyFilePath.value).toBe('/Users/me/key.key');
    });

    test('keeps the file selection step when the dialog is cancelled', async () => {
        const { auth } = makeAuth();
        invokeHandlers.pick_database_file = async () => null;

        await auth.selectFile();

        expect(currentStore.filePath).toBeNull();
        expect(auth.step.value).toBe(1);
    });

    test('offers the database the backend remembered', async () => {
        const { auth } = makeAuth();
        remembered.database = '/Users/me/Vault.kdbx';
        remembered.keyFiles['/Users/me/Vault.kdbx'] = '/Users/me/key.key';

        await auth.checkLastPath();

        expect(currentStore.filePath).toBe('/Users/me/Vault.kdbx');
        expect(auth.step.value).toBe(2);
        expect(auth.keyFilePath.value).toBe('/Users/me/key.key');
    });

    test('stays on file selection when nothing is remembered', async () => {
        const { auth } = makeAuth();
        remembered.database = null;

        await auth.checkLastPath();

        expect(currentStore.filePath).toBeNull();
        expect(auth.step.value).toBe(1);
    });
});

describe('useDatabaseAuth key file', () => {
    test('reads the key file and builds credentials with a key-file hash', async () => {
        const { auth, router } = makeAuth();
        currentStore.filePath = '/a.kdbx';
        auth.keyFilePath.value = '/keys/secret.key';
        const readPaths = [];
        invokeHandlers.read_database = async ({ path }) => {
            readPaths.push(path);
            return new Uint8Array([9, 8, 7, 6, 5]);
        };
        let capturedCreds;
        kdbxLoadMock = mock(async (_buf, creds) => {
            capturedCreds = creds;
            return { id: 'db' };
        });

        await auth.decrypt();

        expect(readPaths).toContain('/keys/secret.key');
        expect(capturedCreds.keyFileHash).toBeDefined();
        expect(router.push).toHaveBeenCalledTimes(1);
        expect(remembered.keyFiles['/a.kdbx']).toBe('/keys/secret.key');
    });

    test('allows unlocking with a key file and no password', async () => {
        const { auth, router } = makeAuth();
        currentStore.filePath = '/a.kdbx';
        auth.password.value = '';
        auth.keyFilePath.value = '/keys/k.key';
        let capturedCreds;
        kdbxLoadMock = mock(async (_buf, creds) => {
            capturedCreds = creds;
            return { id: 'db' };
        });

        await auth.decrypt();

        expect(router.push).toHaveBeenCalledTimes(1);
        expect(capturedCreds.passwordHash).toBeUndefined();
        expect(capturedCreds.keyFileHash).toBeDefined();
    });

    test('surfaces a friendly error when the key file cannot be read', async () => {
        const { auth, router } = makeAuth();
        currentStore.filePath = '/a.kdbx';
        auth.keyFilePath.value = '/keys/missing.key';
        auth.password.value = 'pw';
        invokeHandlers.read_database = async ({ path }) => {
            if (path === '/keys/missing.key') throw new Error('ENOENT');
            return new Uint8Array([1, 2, 3]);
        };

        await auth.decrypt();

        expect(auth.errorMessage.value).toBe(
            'Could not read the key file. Make sure it still exists.',
        );
        expect(router.push).not.toHaveBeenCalled();
    });
});

describe('useDatabaseAuth.createDatabase', () => {
    function fillForm(auth, name = 'Vault', pw = 'pw', confirm = 'pw') {
        auth.startCreate();
        auth.newDbName.value = name;
        auth.newPassword.value = pw;
        auth.newPasswordConfirm.value = confirm;
    }

    test('rejects an empty name without opening the save dialog', async () => {
        const { auth, router } = makeAuth();
        fillForm(auth, '   ');

        await auth.createDatabase();

        expect(auth.errorMessage.value).toBe('Enter a database name.');
        expect(pickCalls).toBe(0);
        expect(saveSpy).not.toHaveBeenCalled();
        expect(router.push).not.toHaveBeenCalled();
    });

    test('rejects mismatched passwords', async () => {
        const { auth } = makeAuth();
        fillForm(auth, 'Vault', 'a', 'b');

        await auth.createDatabase();

        expect(auth.errorMessage.value).toBe('Passwords do not match.');
        expect(pickCalls).toBe(0);
    });

    test('creates, saves and opens the new database', async () => {
        const { auth, router } = makeAuth();
        fillForm(auth);
        pickNewPath('/Users/me/Vault.kdbx');

        await auth.createDatabase();

        expect(saveSpy).toHaveBeenCalledTimes(1);
        expect(currentStore.filePath).toBe('/Users/me/Vault.kdbx');
        expect(currentStore.db).toBeDefined();
        expect(router.push).toHaveBeenCalledTimes(1);
        expect(remembered.database).toBe('/Users/me/Vault.kdbx');
    });

    test('creates a database with a key file and remembers the association', async () => {
        const { auth } = makeAuth();
        fillForm(auth);
        auth.newKeyFilePath.value = '/Users/me/keyfile.key';
        pickNewPath('/Users/me/Vault.kdbx');
        const readMock = mock(async () => new Uint8Array([9, 8, 7]));
        invokeHandlers.read_database = ({ path }) => readMock(path);

        await auth.createDatabase();

        expect(readMock).toHaveBeenCalledWith('/Users/me/keyfile.key');
        expect(remembered.keyFiles['/Users/me/Vault.kdbx']).toBe(
            '/Users/me/keyfile.key',
        );
    });

    test('saves to exactly the path the backend returned', async () => {
        const { auth } = makeAuth();
        fillForm(auth);
        // The backend appends the missing `.kdbx` itself, because the path it
        // grants access to has to be the one that is written to.
        pickNewPath('/Users/me/Chosen.kdbx');

        await auth.createDatabase();

        expect(pickArgs).toEqual({ defaultName: 'Vault.kdbx' });
        expect(currentStore.filePath).toBe('/Users/me/Chosen.kdbx');
        expect(auth.fileName.value).toBe('Chosen.kdbx');
    });

    test('does nothing when the save dialog is cancelled', async () => {
        const { auth, router } = makeAuth();
        fillForm(auth);
        pickNewPath(null);

        await auth.createDatabase();

        expect(saveSpy).not.toHaveBeenCalled();
        expect(router.push).not.toHaveBeenCalled();
    });
});
