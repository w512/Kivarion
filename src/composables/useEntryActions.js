import { computed, ref, toValue } from 'vue';
import { getField } from '../utils';
import {
    deleteMovesToRecycleBin,
    findEntryByUuid,
    findGroupByUuid,
    getObjectUuid,
    getRestoreTargetGroup,
    isObjectInRecycleBin,
} from '../kdbxView.js';

/**
 * Everything that changes an entry from the list or the detail column: add,
 * delete, restore, move to another group, and the save that follows an edit.
 *
 * Adding, restoring and moving all change which entry the detail column shows,
 * so they go through `selection.requestNavigation` — `EntryDetail` reloads its
 * form whenever the entry changes, and an unguarded one of these threw away a
 * half-typed entry without a word.
 *
 * @param {object} store - the Pinia store.
 * @param {object} deps
 * @param {import('vue').Ref|(() => object)} deps.databaseView - the view model.
 * @param {object} deps.selection - `useEntrySelection`.
 * @param {object} deps.actions - `useDatabaseActions`.
 */
export function useEntryActions(store, { databaseView, selection, actions }) {
    const view = () => toValue(databaseView);

    const showDeleteConfirm = ref(false);
    const entryToDeleteUuid = ref(null);

    const entryToDelete = computed(() =>
        findEntryByUuid(view(), entryToDeleteUuid.value),
    );

    const entryDeleteIsPermanent = computed(
        () => !deleteMovesToRecycleBin(view(), entryToDelete.value),
    );

    const entryDeleteMessage = computed(() => {
        const title = getField(entryToDelete.value, 'Title') || 'No title';
        return entryDeleteIsPermanent.value
            ? `“${title}” will be permanently deleted. This action cannot be undone.`
            : `“${title}” will be moved to the Recycle Bin. You can restore it later.`;
    });

    // Guarded like every other change of selection: this swaps the detail column
    // to a new entry. (Cmd+N was only ever half-safe here — it is skipped while
    // the focus is in a form field, which the list header's "+" never is.)
    function addEntry() {
        selection.requestNavigation(() => {
            const entryUuid = actions.addEntry(
                selection.resolveTargetGroup(store.selectedGroupUuid),
            );
            if (entryUuid) selection.selectedEntryUuid.value = entryUuid;
        });
    }

    function requestDelete(entry) {
        const uuid = getObjectUuid(entry);
        if (!uuid) return;
        entryToDeleteUuid.value = uuid;
        showDeleteConfirm.value = true;
    }

    function confirmDelete() {
        const entry = entryToDelete.value;
        if (!store.db || !entry) return;

        if (isObjectInRecycleBin(view(), entry)) {
            store.db.move(entry, null);
        } else {
            store.db.remove(entry);
        }
        if (selection.selectedEntryUuid.value === entryToDeleteUuid.value) {
            selection.selectedEntryUuid.value = null;
        }
        entryToDeleteUuid.value = null;
        showDeleteConfirm.value = false;
        store.touchDb();
        actions.saveDatabaseChanges({ debounce: true });
    }

    function cancelDelete() {
        entryToDeleteUuid.value = null;
        showDeleteConfirm.value = false;
    }

    function restoreEntry(entryUuid) {
        // Closes the detail column when the restored entry is the open one, so
        // it goes through the same draft guard as the other selection changes.
        selection.requestNavigation(() => {
            const entry = findEntryByUuid(view(), entryUuid);
            if (!entry || !isObjectInRecycleBin(view(), entry)) return;

            const target = getRestoreTargetGroup(view(), entry);
            if (!target) return;
            store.db.move(entry, target);
            if (selection.selectedEntryUuid.value === entryUuid) {
                selection.selectedEntryUuid.value = null;
            }
            store.touchDb();
            actions.saveDatabaseChanges({ debounce: true });
        });
    }

    // Emitted by GroupTree when an entry is dropped on a group.
    function moveEntry({ entryUuid, targetGroupUuid }) {
        // Dropping an entry on a group selects both that group and the entry, so
        // an edit open on a *different* entry would be replaced without asking.
        // The drop is carried out (or dropped) together with the selection, which
        // is what the three answers of the unsaved-changes modal already mean.
        selection.requestNavigation(() => {
            const entry = findEntryByUuid(view(), entryUuid);
            const targetGroup = findGroupByUuid(view(), targetGroupUuid);
            if (!entry || !targetGroup || entry.parentGroup === targetGroup)
                return;

            store.db.move(entry, targetGroup);
            store.selectedGroupUuid = targetGroupUuid;
            selection.selectedEntryUuid.value = entryUuid;
            store.touchDb();
            actions.saveDatabaseChanges({ debounce: true });
        });
    }

    function onEntryUpdated() {
        store.touchDb();
        actions.saveDatabaseChanges({ debounce: true });
    }

    return {
        showDeleteConfirm,
        entryDeleteIsPermanent,
        entryDeleteMessage,
        addEntry,
        requestDelete,
        confirmDelete,
        cancelDelete,
        restoreEntry,
        moveEntry,
        onEntryUpdated,
    };
}
