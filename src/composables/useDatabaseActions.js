import { computed, ref } from 'vue';
import { saveDatabase } from '../dbHelper.js';
import {
    ALL_ENTRIES_UUID,
    findGroupByUuid,
    getDefaultGroup,
    getObjectUuid,
    getUniqueGroupName,
} from '../kdbxView.js';

export function useDatabaseActions(store) {
    // Surfaced to the UI so a failed save is never silent.
    const isSaving = ref(false);
    const saveError = ref(null);
    // Distinct from saveError: the file was changed on disk by another writer.
    // The UI offers an explicit "overwrite" rather than treating it as a fault.
    const saveConflict = ref(false);
    const lastSavedDbVersion = ref(store.dbVersion);
    const hasUnsavedChanges = computed(() => {
        return (
            !!saveError.value ||
            saveConflict.value ||
            store.dbVersion > lastSavedDbVersion.value
        );
    });

    let pendingSaveVersion = null;
    let activeSavePromise = null;
    let forceNextSave = false;

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
    function saveDatabaseChanges({ force = false } = {}) {
        if (!store.db) return Promise.resolve(false);

        if (force) forceNextSave = true;
        pendingSaveVersion = store.dbVersion;

        if (!activeSavePromise) {
            activeSavePromise = flushSaveQueue().finally(() => {
                activeSavePromise = null;
            });
        }

        return activeSavePromise;
    }

    async function flushSaveQueue() {
        isSaving.value = true;
        let ok = true;

        try {
            while (pendingSaveVersion !== null && store.db) {
                const versionToSave = pendingSaveVersion;
                pendingSaveVersion = null;

                // A duplicate request for a version that has just been saved
                // does not need another disk write.
                if (
                    !saveError.value &&
                    versionToSave <= lastSavedDbVersion.value
                ) {
                    continue;
                }

                try {
                    saveError.value = null;
                    const force = forceNextSave;
                    forceNextSave = false;
                    await saveDatabase(store.db, store.fileName, { force });
                    saveConflict.value = false;
                    lastSavedDbVersion.value = versionToSave;
                } catch (error) {
                    console.error('Failed to save changes:', error);
                    if (error?.code === 'EXTERNAL_CONFLICT') {
                        // Let the UI ask the user; don't treat it as a hard error.
                        saveConflict.value = true;
                    } else {
                        saveError.value =
                            error?.message || String(error) || 'Unknown error';
                    }
                    pendingSaveVersion = null;
                    ok = false;
                    break;
                }
            }
        } finally {
            isSaving.value = false;
            // Never carry a force request past the flush that requested it.
            forceNextSave = false;
        }

        return ok && !hasUnsavedChanges.value;
    }

    function addEntry(targetGroupUuid) {
        if (!store.db) return null;

        const targetGroup =
            targetGroupUuid === ALL_ENTRIES_UUID
                ? getDefaultGroup(store.db)
                : findGroupByUuid(store.db, targetGroupUuid);

        if (!targetGroup) return null;

        const entry = store.db.createEntry(targetGroup);
        entry.fields.set('Title', 'New entry');
        entry.times.update();
        store.touchDb();
        saveDatabaseChanges();
        return getObjectUuid(entry);
    }

    function addGroup(parentGroupUuid) {
        if (!store.db || !parentGroupUuid) return null;

        const parentGroup =
            parentGroupUuid === ALL_ENTRIES_UUID
                ? getDefaultGroup(store.db)
                : findGroupByUuid(store.db, parentGroupUuid);

        if (!parentGroup) return null;

        const group = store.db.createGroup(
            parentGroup,
            getUniqueGroupName(parentGroup),
        );
        store.touchDb();
        saveDatabaseChanges();
        return getObjectUuid(group);
    }

    return {
        saveDatabaseChanges,
        addEntry,
        addGroup,
        isSaving,
        saveError,
        saveConflict,
        hasUnsavedChanges,
        lastSavedDbVersion,
    };
}
