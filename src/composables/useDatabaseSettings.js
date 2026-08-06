import { ref, watch } from 'vue';
import * as kdbxweb from 'kdbxweb';
import { invoke } from '@tauri-apps/api/core';
import { toExactArrayBuffer } from '../utils';
import { buildUpdatedCredentials } from '../dbHelper.js';
import { biometricPreferenceKey } from '../databasePreferences.js';
import {
    readKeyFilePreference,
    writeKeyFilePreference,
} from './useDatabaseAuth.js';
import { withSystemInteraction } from './useSystemInteraction.js';

/**
 * The database settings dialog: the name, the master password and the key file.
 *
 * Every step here reruns the KDF, so the open database is captured up front and
 * re-checked after *every* await — an auto-lock during one of them used to
 * apply the submitted password to whatever database was opened next.
 *
 * @param {object} store - the Pinia store.
 * @param {object} deps
 * @param {object} deps.actions - `useDatabaseActions`.
 */
export function useDatabaseSettings(store, { actions }) {
    const showSettingsModal = ref(false);
    const settingsBusy = ref(false);
    const settingsError = ref('');

    // The key file associated with the open database. Lives in the backend (it
    // is tied to a filesystem grant), so it is loaded once per file instead of
    // being read synchronously in a computed.
    const currentKeyFilePath = ref(null);

    watch(
        () => store.filePath,
        async (path) => {
            currentKeyFilePath.value = path
                ? await readKeyFilePreference(path)
                : null;
        },
        { immediate: true },
    );

    function openDatabaseSettings() {
        settingsError.value = '';
        showSettingsModal.value = true;
    }

    function closeDatabaseSettings() {
        if (settingsBusy.value) return;
        settingsError.value = '';
        showSettingsModal.value = false;
    }

    /** Take the dialog down without asking, for a forced lock. */
    function reset() {
        showSettingsModal.value = false;
        settingsBusy.value = false;
        settingsError.value = '';
    }

    async function readKeyFileBuffer(path) {
        if (!path) return null;
        const bytes = await invoke('read_database', { path });
        return toExactArrayBuffer(bytes);
    }

    async function verifyCurrentCredentials(currentPassword, keyFilePath) {
        if (!store.filePath) return true;
        const passwordValue = currentPassword
            ? kdbxweb.ProtectedValue.fromString(currentPassword)
            : null;
        const keyFileBuffer = await readKeyFileBuffer(keyFilePath);
        const credentials = new kdbxweb.Credentials(
            passwordValue,
            keyFileBuffer,
        );
        await credentials.ready;
        const bytes = await invoke('read_database', { path: store.filePath });
        await kdbxweb.Kdbx.load(toExactArrayBuffer(bytes), credentials);
        return true;
    }

    async function confirmDatabaseSettings({
        name,
        password,
        currentPassword,
        keyFilePath,
        keyFileChanged,
    }) {
        const db = store.db;
        if (!db || settingsBusy.value) return;

        const normalizedName = (name || '').trim();
        if (!normalizedName) return;

        settingsError.value = '';
        settingsBusy.value = true;

        if (password || keyFileChanged) {
            try {
                await verifyCurrentCredentials(
                    currentPassword,
                    currentKeyFilePath.value,
                );
            } catch (error) {
                console.error(
                    'Current credentials verification failed:',
                    error,
                );
                settingsError.value =
                    'Current password or key file is incorrect.';
                settingsBusy.value = false;
                return;
            }
        }

        // The database may have been locked while the asynchronous KDF was
        // running. Never apply the submitted credentials to a different session.
        if (store.db !== db || !showSettingsModal.value) {
            settingsBusy.value = false;
            return;
        }

        try {
            const keyFileBuffer = keyFileChanged
                ? await readKeyFileBuffer(keyFilePath)
                : null;
            if (store.db !== db || !showSettingsModal.value) {
                settingsBusy.value = false;
                return;
            }
            if (password || keyFileChanged) {
                // Prepare the complete new credentials before touching the
                // database, then swap them in with a single assignment (see
                // `buildUpdatedCredentials`).
                const updated = await buildUpdatedCredentials(db.credentials, {
                    password,
                    keyFileBuffer,
                    keyFileChanged,
                });
                if (store.db !== db || !showSettingsModal.value) {
                    settingsBusy.value = false;
                    return;
                }

                // The file on disk keeps the old credentials until the save below
                // succeeds; remember them so "keep the file" can still read it if
                // that save fails.
                actions.rememberCredentialsOnDisk(db.credentials);
                db.credentials = updated;
            }
            db.meta.name = normalizedName;
        } catch (error) {
            console.error('Database settings update failed:', error);
            settingsError.value = 'Could not update the database credentials.';
            settingsBusy.value = false;
            return;
        }

        // Both records below describe the *file*, so they are only true once the
        // write lands — and the write that lands may not be this one: it can fail
        // and be retried from the banner, or resolved through the conflict modal.
        // Queueing them makes them ride along with whichever save finally succeeds
        // instead of being tied to this single attempt.
        const path = store.filePath;
        if (keyFileChanged && path) {
            actions.runAfterSuccessfulSave(async () => {
                await writeKeyFilePreference(path, keyFilePath);
                if (store.filePath === path) {
                    currentKeyFilePath.value = keyFilePath || null;
                }
            });
        }

        // If the master password changed, the stored biometric secret is now
        // stale. Update it (or drop it) so Touch ID doesn't keep unlocking with
        // the old password.
        if (
            password &&
            path &&
            localStorage.getItem(biometricPreferenceKey(path)) === 'true'
        ) {
            actions.runAfterSuccessfulSave(() =>
                updateBiometricPassword(path, password),
            );
        }

        store.touchDb();
        showSettingsModal.value = false;
        settingsBusy.value = false;
        await actions.saveDatabaseChanges();
    }

    async function updateBiometricPassword(path, password) {
        try {
            // Saving the secret triggers a Touch ID prompt, which blurs the
            // window — that must not be mistaken for the user leaving the app.
            await withSystemInteraction(() =>
                invoke('save_biometric_password', { id: path, pass: password }),
            );
        } catch (e) {
            console.error(
                'Failed to update biometric password, removing it:',
                e,
            );
            try {
                await invoke('delete_biometric_password', { id: path });
            } catch {}
            localStorage.removeItem(biometricPreferenceKey(path));
        }
    }

    return {
        showSettingsModal,
        settingsBusy,
        settingsError,
        currentKeyFilePath,
        openDatabaseSettings,
        closeDatabaseSettings,
        confirmDatabaseSettings,
        reset,
    };
}
