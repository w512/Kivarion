import { ref, nextTick } from 'vue';
import * as kdbxweb from 'kdbxweb';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store.js';
import { toExactArrayBuffer } from '../utils.js';

export function useDatabaseAuth(router, passwordInputRef) {
    const store = useStore();
    const fileName = ref('');
    const password = ref('');
    const isLoading = ref(false);
    const errorMessage = ref('');
    const step = ref(1); // 1 = file selection, 2 = password input
    const isBiometricsSupported = ref(false);
    const useBiometrics = ref(false);
    const isBiometricAuthenticated = ref(false);

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

    async function checkLastPath() {
        const lastPath = localStorage.getItem('kivarion-last-db-path');
        if (lastPath) {
            try {
                if (await invoke('file_exists', { path: lastPath })) {
                    store.filePath = lastPath;
                    fileName.value = lastPath.split(/[\\/]/).pop();
                    step.value = 2;
                    checkBiometricsPreference(lastPath);
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
                nextTick(() => {
                    passwordInputRef.value?.focus();
                });
            }
        } catch (err) {
            console.error('Failed to open file dialog:', err);
            errorMessage.value = 'Failed to open file dialog: ' + err.message;
        }
    }

    function resetFile() {
        store.filePath = null;
        fileName.value = '';
        password.value = '';
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

    async function decrypt(expectedPath = null) {
        // Snapshot the target file up front and use it for the whole flow, so a
        // file switch mid-decrypt can never cross-apply a password to the wrong
        // database.
        const path = store.filePath;
        if (!path || !password.value) {
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

            const credentials = new kdbxweb.Credentials(
                kdbxweb.ProtectedValue.fromString(password.value),
            );

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
            if (err.code === 'InvalidKey') {
                errorMessage.value = 'Incorrect password. Please try again.';
            } else {
                errorMessage.value =
                    'Failed to open database. Check the file and password.';
            }
        } finally {
            isLoading.value = false;
        }
    }

    return {
        fileName,
        password,
        isLoading,
        errorMessage,
        step,
        useBiometrics,
        isBiometricsSupported,
        checkLastPath,
        selectFile,
        resetFile,
        decrypt,
        attemptBiometricUnlock,
        store,
    };
}
