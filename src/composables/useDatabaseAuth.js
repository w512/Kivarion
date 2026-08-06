import { ref, nextTick } from 'vue';
import * as kdbxweb from 'kdbxweb';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store.js';
import { readFileMtime, saveDatabase } from '../dbHelper.js';
import { basename, toExactArrayBuffer } from '../utils.js';
import { biometricPreferenceKey } from '../databasePreferences.js';
import { withSystemInteraction } from './useSystemInteraction.js';

// Per-database key-file association. KeePass remembers which key file unlocks a
// given database; we mirror that by storing the key file's path (not its bytes)
// keyed by the database path. Both the association and the remembered database
// live in the backend, not in localStorage: the backend grants filesystem
// access to exactly those paths, so a webview that could edit the record could
// grant itself a read of any file (see `src-tauri/src/access.rs`).
export async function readKeyFilePreference(dbPath) {
    try {
        return (await invoke('remembered_key_file', { dbPath })) || null;
    } catch (err) {
        console.error('Failed to read the key file association:', err);
        return null;
    }
}

export async function writeKeyFilePreference(dbPath, keyPath) {
    try {
        await invoke('remember_key_file', { dbPath, keyPath: keyPath || null });
    } catch (err) {
        console.error('Failed to store the key file association:', err);
    }
}

// Offer this database on the next launch. The backend only accepts a path it
// has already granted, so this cannot widen access on its own.
async function rememberDatabase(path) {
    try {
        await invoke('remember_database', { path });
    } catch (err) {
        console.error('Failed to remember the database path:', err);
    }
}

// Map a kdbxweb load error to a message a user can act on. Codes are the stable
// string values of `kdbxweb.Consts.ErrorCodes`.
function describeLoadError(code, hasKeyFile) {
    switch (code) {
        case 'InvalidKey':
            return hasKeyFile
                ? 'Incorrect password or key file. Please try again.'
                : 'Incorrect password. Please try again.';
        case 'BadSignature':
            return 'This file is not a valid KDBX database.';
        case 'FileCorrupt':
            return 'The database file appears to be corrupted.';
        case 'InvalidVersion':
            return 'This KDBX format version is not supported.';
        case 'Unsupported':
            return 'This database uses a feature or algorithm that is not supported.';
        default:
            return 'Failed to open database. Check the file and password.';
    }
}

export function useDatabaseAuth(router, passwordInputRef) {
    const store = useStore();
    const fileName = ref('');
    const password = ref('');
    const keyFilePath = ref(null);
    const isLoading = ref(false);
    const errorMessage = ref('');
    // 1 = file selection, 2 = unlock (password / key file), 3 = create database.
    const step = ref(1);
    const isBiometricsSupported = ref(false);
    const useBiometrics = ref(false);
    const isBiometricAuthenticated = ref(false);

    // New-database form state (step 3).
    const newDbName = ref('');
    const newPassword = ref('');
    const newPasswordConfirm = ref('');
    const newKeyFilePath = ref(null);

    // Check if biometrics are supported and available
    async function checkBiometrics() {
        try {
            isBiometricsSupported.value = await invoke(
                'is_biometric_available',
            );
        } catch (e) {
            console.error('Failed to check biometric availability:', e);
            isBiometricsSupported.value = false;
        }
    }
    checkBiometrics();

    function keyFileName() {
        return basename(keyFilePath.value);
    }

    async function restoreKeyFilePreference(path) {
        keyFilePath.value = await readKeyFilePreference(path);
    }

    async function checkLastPath() {
        try {
            // The backend hands back the database it remembered — and grants
            // access to it in the same call, so it can be opened without
            // sending the user through the file dialog again.
            const lastPath = await invoke('remembered_database');
            if (!lastPath) return;

            store.filePath = lastPath;
            fileName.value = basename(lastPath);
            step.value = 2;
            checkBiometricsPreference(lastPath);
            await restoreKeyFilePreference(lastPath);
            nextTick(() => {
                passwordInputRef.value?.focus();
            });
        } catch (err) {
            console.error('Failed to restore the last database:', err);
        }
    }

    async function selectFile() {
        try {
            // The dialog itself lives in the backend: picking a file is what
            // grants access to it (`src-tauri/src/access.rs`).
            const selected = await invoke('pick_database_file');

            if (selected) {
                store.filePath = selected;
                fileName.value = basename(selected);
                errorMessage.value = '';
                step.value = 2;
                checkBiometricsPreference(selected);
                await restoreKeyFilePreference(selected);
                nextTick(() => {
                    passwordInputRef.value?.focus();
                });
            }
        } catch (err) {
            console.error('Failed to open file dialog:', err);
            errorMessage.value = 'Failed to open file dialog: ' + err.message;
        }
    }

    async function selectKeyFile() {
        try {
            const selected = await invoke('pick_key_file');
            if (selected) {
                keyFilePath.value = selected;
                errorMessage.value = '';
                nextTick(() => {
                    passwordInputRef.value?.focus();
                });
            }
        } catch (err) {
            console.error('Failed to open key file dialog:', err);
            errorMessage.value =
                'Failed to open key file dialog: ' + err.message;
        }
    }

    async function selectNewKeyFile() {
        try {
            const selected = await invoke('pick_key_file');
            if (selected) {
                newKeyFilePath.value = selected;
                errorMessage.value = '';
            }
        } catch (err) {
            console.error('Failed to open key file dialog:', err);
            errorMessage.value =
                'Failed to open key file dialog: ' + err.message;
        }
    }

    function clearKeyFile() {
        keyFilePath.value = null;
    }

    function clearNewKeyFile() {
        newKeyFilePath.value = null;
    }

    function resetFile() {
        store.filePath = null;
        fileName.value = '';
        password.value = '';
        keyFilePath.value = null;
        errorMessage.value = '';
        step.value = 1;
        useBiometrics.value = false;
    }

    function checkBiometricsPreference(path) {
        // Only surface the Touch ID button; never trigger the OS prompt without
        // an explicit user action. The user clicks the button to unlock.
        const pref = localStorage.getItem(biometricPreferenceKey(path));
        useBiometrics.value = pref === 'true';
    }

    async function attemptBiometricUnlock(path) {
        // Bind this unlock to the file the user is looking at right now.
        if (!path || path !== store.filePath) return;

        isLoading.value = true;
        try {
            const pass = await invoke('load_biometric_password', { id: path });
            // The user may have switched files while the OS prompt was open;
            // never apply a secret loaded for one file to a different one.
            if (path !== store.filePath) return;
            if (pass) {
                password.value = pass;
                isBiometricAuthenticated.value = true;
                await decrypt(path);
            }
        } catch (err) {
            console.error('Biometric unlock failed or cancelled:', err);
            // Tauri rejects with the plain error string from the Rust command.
            const message = typeof err === 'string' ? err : err?.message || '';
            if (message.includes('BIOMETRIC_NOT_ENROLLED')) {
                // The path-keyed preference can outlive a manually removed
                // Keychain item. Drop the stale toggle immediately so the UI
                // does not keep offering a dead Touch ID button.
                localStorage.removeItem(biometricPreferenceKey(path));
                useBiometrics.value = false;
                errorMessage.value =
                    'No password is saved for Touch ID on this database. Unlock with your master password once to enable it again.';
            } else if (!/cancel/i.test(message)) {
                // An explicit cancel needs no error; everything else must be
                // visible, or a broken unlock looks like a dead button.
                errorMessage.value =
                    'Touch ID unlock failed. Enter your master password.';
            }
        } finally {
            isLoading.value = false;
        }
    }

    // Build credentials from the current password and/or key file. Reading the
    // key file goes through the backend (the webview has no fs access). Throws
    // a tagged error if the key file can't be read so the caller can report it.
    async function buildCredentials(passwordText, keyPath) {
        const passwordValue = passwordText
            ? kdbxweb.ProtectedValue.fromString(passwordText)
            : null;

        let keyFileBuffer = null;
        if (keyPath) {
            try {
                const keyBytes = await invoke('read_database', {
                    path: keyPath,
                });
                keyFileBuffer = toExactArrayBuffer(keyBytes);
            } catch (err) {
                const wrapped = new Error(err?.message || String(err));
                wrapped.code = 'KEYFILE_READ_FAILED';
                throw wrapped;
            }
        }

        const credentials = new kdbxweb.Credentials(
            passwordValue,
            keyFileBuffer,
        );
        // setPassword/setKeyFile are async; wait for the hashes to be ready
        // before handing the credentials to Kdbx.load.
        await credentials.ready;
        return credentials;
    }

    async function decrypt(expectedPath = null) {
        // Snapshot the target file up front and use it for the whole flow, so a
        // file switch mid-decrypt can never cross-apply a password to the wrong
        // database.
        const path = store.filePath;
        const keyPath = keyFilePath.value;
        if (!path || (!password.value && !keyPath)) {
            return;
        }
        // Only enforce the guard when an explicit path was passed (e.g. from a
        // biometric unlock); a stray event arg from a template handler is ignored.
        if (typeof expectedPath === 'string' && expectedPath !== path) {
            return;
        }

        isLoading.value = true;
        errorMessage.value = '';

        try {
            // Read the mtime *before* the bytes. Reading it afterwards pairs a
            // timestamp taken after the KDF (seconds on a large vault) with the
            // copy that was read before it: an external write landing in that
            // window would be recorded as "already known", the next save's
            // concurrency check would pass, and those changes would be
            // overwritten with no conflict modal. Taken first, the worst case is
            // a false conflict the user gets to resolve.
            const mtimeBeforeRead = await readFileMtime(path);

            const fileContents = await invoke('read_database', { path });
            const arrayBuffer = toExactArrayBuffer(fileContents);

            const credentials = await buildCredentials(password.value, keyPath);

            const db = await kdbxweb.Kdbx.load(arrayBuffer, credentials);

            // The selection may have changed during the async read/KDF; discard
            // this result rather than opening a stale database.
            if (store.filePath !== path) {
                return;
            }

            store.db = db;
            store.fileName = fileName.value;
            // The timestamp of the bytes now in memory, so later saves can
            // detect external changes.
            store.knownMtime = mtimeBeforeRead;

            // Remember (or forget) the key file association for this database.
            await writeKeyFilePreference(path, keyPath);

            // Save or delete biometric password based on user preference.
            // Skip saving if we just authenticated via biometrics (avoids a redundant prompt).
            if (useBiometrics.value && !isBiometricAuthenticated.value) {
                try {
                    // `store.db` is already set at this point, so the Touch ID
                    // prompt's window blur would otherwise trip auto-lock and
                    // throw the user back to this screen right after unlocking.
                    await withSystemInteraction(() =>
                        invoke('save_biometric_password', {
                            id: path,
                            pass: password.value,
                        }),
                    );
                    localStorage.setItem(biometricPreferenceKey(path), 'true');
                } catch (e) {
                    console.error('Failed to save biometric password:', e);
                }
            } else if (!useBiometrics.value) {
                try {
                    await invoke('delete_biometric_password', { id: path });
                    localStorage.removeItem(biometricPreferenceKey(path));
                } catch {}
            }

            await rememberDatabase(path);
            password.value = '';
            isBiometricAuthenticated.value = false;
            router.push({ name: 'database' });
        } catch (err) {
            console.error('Decryption failed:', err);
            isBiometricAuthenticated.value = false;
            if (err.code === 'KEYFILE_READ_FAILED') {
                errorMessage.value =
                    'Could not read the key file. Make sure it still exists.';
            } else {
                errorMessage.value = describeLoadError(err.code, !!keyPath);
            }
        } finally {
            isLoading.value = false;
        }
    }

    function startCreate() {
        errorMessage.value = '';
        newDbName.value = '';
        newPassword.value = '';
        newPasswordConfirm.value = '';
        newKeyFilePath.value = null;
        step.value = 3;
    }

    function cancelCreate() {
        errorMessage.value = '';
        // A JS string cannot be wiped, but the reference can go: leaving the
        // abandoned master password reachable for the rest of the session (and
        // in any crash dump or swap taken during it) buys nothing. `startCreate`
        // would overwrite these anyway, so nothing is lost by dropping them now.
        newPassword.value = '';
        newPasswordConfirm.value = '';
        step.value = 1;
    }

    async function createDatabase() {
        errorMessage.value = '';
        const name = newDbName.value.trim();
        if (!name) {
            errorMessage.value = 'Enter a database name.';
            return;
        }
        if (!newPassword.value) {
            errorMessage.value = 'Enter a master password.';
            return;
        }
        if (newPassword.value !== newPasswordConfirm.value) {
            errorMessage.value = 'Passwords do not match.';
            return;
        }

        let targetPath;
        try {
            // The backend runs the dialog, appends `.kdbx` if the user left it
            // off and grants the resulting path — the exact path saved to.
            targetPath = await invoke('pick_new_database_path', {
                defaultName: `${name}.kdbx`,
            });
        } catch (err) {
            console.error('Failed to open save dialog:', err);
            errorMessage.value = 'Failed to open save dialog: ' + err.message;
            return;
        }
        if (!targetPath) return; // user cancelled

        isLoading.value = true;
        try {
            const credentials = await buildCredentials(
                newPassword.value,
                newKeyFilePath.value,
            );
            const db = kdbxweb.Kdbx.create(credentials, name);

            const newName = basename(targetPath);
            // Set the target before saving; saveDatabase reads store.filePath.
            store.filePath = targetPath;
            store.knownMtime = null;
            await saveDatabase(db, newName);

            store.db = db;
            store.fileName = newName;
            fileName.value = newName;
            await rememberDatabase(targetPath);
            await writeKeyFilePreference(targetPath, newKeyFilePath.value);

            password.value = '';
            newPassword.value = '';
            newPasswordConfirm.value = '';
            newKeyFilePath.value = null;
            router.push({ name: 'database' });
        } catch (err) {
            console.error('Failed to create database:', err);
            store.db = null;
            errorMessage.value =
                'Failed to create database: ' + (err?.message || err);
        } finally {
            isLoading.value = false;
        }
    }

    return {
        fileName,
        password,
        keyFilePath,
        keyFileName,
        isLoading,
        errorMessage,
        step,
        useBiometrics,
        isBiometricsSupported,
        newDbName,
        newPassword,
        newPasswordConfirm,
        newKeyFilePath,
        checkLastPath,
        selectFile,
        selectKeyFile,
        selectNewKeyFile,
        clearKeyFile,
        clearNewKeyFile,
        resetFile,
        decrypt,
        attemptBiometricUnlock,
        startCreate,
        cancelCreate,
        createDatabase,
        store,
    };
}
