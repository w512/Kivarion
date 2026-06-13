import { computed, ref } from 'vue';
import { saveDatabase } from '../dbHelper.js';

export function useDatabaseActions(store) {
    // Surfaced to the UI so a failed save is never silent.
    const isSaving = ref(false);
    const saveError = ref(null);
    const lastSavedDbVersion = ref(store.dbVersion);
    const hasUnsavedChanges = computed(() => {
        return !!saveError.value || store.dbVersion > lastSavedDbVersion.value;
    });

    let saveQueued = false;
    let activeSavePromise = null;

    /**
     * Persist the current database through a single in-process queue.
     *
     * kdbxweb objects are mutated synchronously and many actions can request a
     * save without awaiting it. Writing all requests through this queue prevents
     * concurrent writes to the same `.tmp`/`.bak` files and guarantees that, if
     * the database changes while a save is in progress, the latest version is
     * saved again before the promise resolves.
     *
     * On failure the database remains dirty (`hasUnsavedChanges`) and the error
     * is exposed via `saveError` so the UI can warn the user and offer a retry.
     *
     * @returns {Promise<boolean>} true when the latest database version is saved.
     */
    function saveDatabaseChanges() {
        if (!store.db) return Promise.resolve(false);

        saveQueued = true;

        if (!activeSavePromise) {
            activeSavePromise = flushSaveQueue()
                .finally(() => {
                    activeSavePromise = null;
                });
        }

        return activeSavePromise;
    }

    async function flushSaveQueue() {
        isSaving.value = true;
        saveError.value = null;
        let ok = true;

        try {
            while (saveQueued && store.db) {
                saveQueued = false;
                const versionToSave = store.dbVersion;

                try {
                    await saveDatabase(store.db, store.fileName);
                    lastSavedDbVersion.value = versionToSave;
                } catch (error) {
                    console.error('Failed to save changes:', error);
                    saveError.value = error?.message || String(error) || 'Unknown error';
                    saveQueued = false;
                    ok = false;
                    break;
                }
            }
        } finally {
            isSaving.value = false;
        }

        return ok && !hasUnsavedChanges.value;
    }

    function addEntry(selectedGroup, selectedEntryRef) {
        if (!store.db) return;

        let targetGroup = selectedGroup.value;
        if (targetGroup?.uuid?.id === 'all') {
            targetGroup = store.db.getDefaultGroup();
        }

        if (!targetGroup) return;

        const entry = store.db.createEntry(targetGroup);
        entry.fields.set('Title', 'New entry');
        entry.times.update();
        store.touchDb();
        selectedEntryRef.value = entry;
        saveDatabaseChanges();
    }

    function addGroup(parentGroup) {
        if (!store.db || !parentGroup) return;
        store.db.createGroup(parentGroup, 'New group');
        store.touchDb();
        saveDatabaseChanges();
    }

    return {
        saveDatabaseChanges,
        addEntry,
        addGroup,
        isSaving,
        saveError,
        hasUnsavedChanges,
        lastSavedDbVersion
    };
}
