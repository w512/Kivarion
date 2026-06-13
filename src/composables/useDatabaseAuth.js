import { ref, nextTick } from 'vue';
import * as kdbxweb from 'kdbxweb';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile, exists } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store.js';

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
            isBiometricsSupported.value = await invoke('is_biometric_available');
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
                if (await exists(lastPath)) {
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
                filters: [
                    { name: 'KDBX Database', extensions: ['kdbx'] },
                ],
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
        const pref = localStorage.getItem(`kivarion-biometrics-${path}`);
        if (pref === 'true') {
            useBiometrics.value = true;
            attemptBiometricUnlock(path);
        } else {
            useBiometrics.value = false;
        }
    }

    async function attemptBiometricUnlock(path) {
        isLoading.value = true;
        try {
            const pass = await invoke('load_biometric_password', { id: path });
            if (pass) {
                password.value = pass;
                isBiometricAuthenticated.value = true;
                await decrypt();
            }
        } catch (err) {
            console.error('Biometric unlock failed or cancelled:', err);
            // It's okay, user can fallback to password
        } finally {
            isLoading.value = false;
        }
    }

    async function decrypt() {
        if (!store.filePath || !password.value) {
            return;
        }

        isLoading.value = true;
        errorMessage.value = '';

        try {
            const fileContents = await readFile(store.filePath);
            const arrayBuffer = fileContents.buffer;

            const credentials = new kdbxweb.Credentials(
                kdbxweb.ProtectedValue.fromString(password.value),
            );

            const db = await kdbxweb.Kdbx.load(arrayBuffer, credentials);

            store.db = db;
            store.fileName = fileName.value;

            // Save or delete biometric password based on user preference.
            // Skip saving if we just authenticated via biometrics (avoids a redundant prompt).
            if (useBiometrics.value && !isBiometricAuthenticated.value) {
                try {
                    await invoke('save_biometric_password', { id: store.filePath, pass: password.value });
                    localStorage.setItem(`kivarion-biometrics-${store.filePath}`, 'true');
                } catch (e) {
                    console.error('Failed to save biometric password:', e);
                }
            } else if (!useBiometrics.value) {
                try {
                    await invoke('delete_biometric_password', { id: store.filePath });
                    localStorage.removeItem(`kivarion-biometrics-${store.filePath}`);
                } catch (e) {}
            }

            localStorage.setItem('kivarion-last-db-path', store.filePath);
            password.value = '';
            isBiometricAuthenticated.value = false;
            router.push({ name: 'database' });
        } catch (err) {
            console.error('Decryption failed:', err);
            isBiometricAuthenticated.value = false;
            if (err.code === 'InvalidKey') {
                errorMessage.value = 'Incorrect password. Please try again.';
            } else {
                errorMessage.value = 'Failed to open database. Check the file and password.';
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
        store
    };
}
