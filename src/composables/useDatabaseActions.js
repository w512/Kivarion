import { ref } from 'vue';
import { saveDatabase } from '../dbHelper.js';

export function useDatabaseActions(store) {
    // Surfaced to the UI so a failed save is never silent.
    const isSaving = ref(false);
    const saveError = ref(null);

    /**
     * Persist the current database. On failure the error is exposed via
     * `saveError` (and `isSaving`) so the UI can warn the user and offer a
     * retry, instead of silently pretending the data was saved.
     * @returns {Promise<boolean>} true on success, false on failure.
     */
    async function saveDatabaseChanges() {
        isSaving.value = true;
        saveError.value = null;
        try {
            await saveDatabase(store.db, store.fileName);
            return true;
        } catch (error) {
            console.error('Failed to save changes:', error);
            saveError.value = error?.message || String(error) || 'Unknown error';
            return false;
        } finally {
            isSaving.value = false;
        }
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
        saveError
    };
}
