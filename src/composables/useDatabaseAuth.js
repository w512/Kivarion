import { ref, nextTick } from 'vue';
import * as kdbxweb from 'kdbxweb';
import { open, save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store.js';
import { saveDatabase } from '../dbHelper.js';
import { toExactArrayBuffer } from '../utils.js';

// Per-database key-file association. KeePass remembers which key file unlocks a
// given database; we mirror that by storing the key file's path (not its bytes)
// keyed by the database path.
function keyFileStorageKey(dbPath) {
    return `kivarion-keyfile-${dbPath}`;
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
        return keyFilePath.value ? keyFilePath.value.split(/[\\/]/).pop() : '';
    }

    function restoreKeyFilePreference(path) {
        keyFilePath.value = localStorage.getItem(keyFileStorageKey(path));
    }

    async function checkLastPath() {
        const lastPath = localStorage.getItem('kivarion-last-db-path');
        if (lastPath) {
            try {
                if (await invoke('file_exists', { path: lastPath })) {
                    store.filePath = lastPath;
                    fileName.value = lastPath.split(/[\\/]/).pop();
                    step.value = 2;
                    checkBiometricsPreference(lastPath);
                    restoreKeyFilePreference(lastPath);
                    nextTick(() => {
                        passwordInputRef.value?.focus();
                    });
                }
            } catch (err) {
                console.error('Failed to check if last file exists:', err);
            }
        }
    }

    async function selectFile() {
        try {
            const selected = await open({
                multiple: false,
                filters: [{ name: 'KDBX Database', extensions: ['kdbx'] }],
            });

            if (selected) {
                store.filePath = selected;
                fileName.value = selected.split(/[\\/]/).pop();
                errorMessage.value = '';
                step.value = 2;
                checkBiometricsPreference(selected);
                restoreKeyFilePreference(selected);
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
            const selected = await open({ multiple: false });
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

    function clearKeyFile() {
        keyFilePath.value = null;
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
        const pref = localStorage.getItem(`kivarion-biometrics-${path}`);
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
            // It's okay, user can fallback to password
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
            // Track the file's mtime so later saves can detect external changes.
            try {
                store.knownMtime = await invoke('file_mtime', { path });
            } catch {
                store.knownMtime = null;
            }

            // Remember (or forget) the key file association for this database.
            if (keyPath) {
                localStorage.setItem(keyFileStorageKey(path), keyPath);
            } else {
                localStorage.removeItem(keyFileStorageKey(path));
            }

            // Save or delete biometric password based on user preference.
            // Skip saving if we just authenticated via biometrics (avoids a redundant prompt).
            if (useBiometrics.value && !isBiometricAuthenticated.value) {
                try {
                    await invoke('save_biometric_password', {
                        id: path,
                        pass: password.value,
                    });
                    localStorage.setItem(`kivarion-biometrics-${path}`, 'true');
                } catch (e) {
                    console.error('Failed to save biometric password:', e);
                }
            } else if (!useBiometrics.value) {
                try {
                    await invoke('delete_biometric_password', { id: path });
                    localStorage.removeItem(`kivarion-biometrics-${path}`);
                } catch {}
            }

            localStorage.setItem('kivarion-last-db-path', path);
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
        step.value = 3;
    }

    function cancelCreate() {
        errorMessage.value = '';
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
            targetPath = await save({
                defaultPath: `${name}.kdbx`,
                filters: [{ name: 'KDBX Database', extensions: ['kdbx'] }],
            });
        } catch (err) {
            console.error('Failed to open save dialog:', err);
            errorMessage.value = 'Failed to open save dialog: ' + err.message;
            return;
        }
        if (!targetPath) return; // user cancelled
        if (!targetPath.toLowerCase().endsWith('.kdbx')) {
            targetPath += '.kdbx';
        }

        isLoading.value = true;
        try {
            const credentials = await buildCredentials(newPassword.value, null);
            const db = kdbxweb.Kdbx.create(credentials, name);

            const newName = targetPath.split(/[\\/]/).pop();
            // Set the target before saving; saveDatabase reads store.filePath.
            store.filePath = targetPath;
            store.knownMtime = null;
            await saveDatabase(db, newName);

            store.db = db;
            store.fileName = newName;
            fileName.value = newName;
            localStorage.setItem('kivarion-last-db-path', targetPath);
            localStorage.removeItem(keyFileStorageKey(targetPath));

            password.value = '';
            newPassword.value = '';
            newPasswordConfirm.value = '';
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
        checkLastPath,
        selectFile,
        selectKeyFile,
        clearKeyFile,
        resetFile,
        decrypt,
        attemptBiometricUnlock,
        startCreate,
        cancelCreate,
        createDatabase,
        store,
    };
}
