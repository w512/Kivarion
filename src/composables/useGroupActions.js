import { computed, ref, toValue, watch } from 'vue';
import {
    ALL_ENTRIES_UUID,
    deleteMovesToRecycleBin,
    findGroupByUuid,
    getObjectUuid,
    getRestoreTargetGroup,
    groupContainsEntryUuid,
    groupContainsGroupUuid,
    groupNameExistsInParent,
    isObjectInRecycleBin,
    isRecycleBinGroup,
    normalizeGroupName,
    resolveGroupMove,
} from '../kdbxView.js';

/**
 * Everything the group tree can do to the vault: add, rename, delete, restore,
 * reorder, and empty the Recycle Bin — with the confirmation state each of
 * those needs.
 *
 * @param {object} store - the Pinia store.
 * @param {object} deps
 * @param {import('vue').Ref|(() => object)} deps.databaseView - the view model.
 * @param {object} deps.selection - `useEntrySelection`; the draft guard, and
 *   what has to be moved off a group that is about to disappear.
 * @param {object} deps.actions - `useDatabaseActions`.
 */
export function useGroupActions(store, { databaseView, selection, actions }) {
    const view = () => toValue(databaseView);

    const showRenameModal = ref(false);
    const groupToRenameUuid = ref(null);
    const newGroupName = ref('');
    const groupNameError = ref('');

    const showDeleteGroupConfirm = ref(false);
    const showEmptyRecycleBinConfirm = ref(false);
    const groupToDeleteUuid = ref(null);

    watch(newGroupName, () => {
        groupNameError.value = '';
    });

    function getGroupName(groupUuid) {
        if (!groupUuid) return '';
        if (groupUuid === ALL_ENTRIES_UUID) return 'All Entries';
        return findGroupByUuid(view(), groupUuid)?.name || '';
    }

    const groupToDeleteName = computed(() =>
        getGroupName(groupToDeleteUuid.value),
    );

    const groupDeleteIsPermanent = computed(() => {
        const group = findGroupByUuid(view(), groupToDeleteUuid.value);
        return !deleteMovesToRecycleBin(view(), group);
    });

    const groupDeleteMessage = computed(() =>
        groupDeleteIsPermanent.value
            ? `“${groupToDeleteName.value}” and all its contents will be permanently deleted. This action cannot be undone.`
            : `“${groupToDeleteName.value}” and all its contents will be moved to the Recycle Bin. You can restore the group later.`,
    );

    function addGroup(parentGroupUuid) {
        selection.requestNavigation(() => {
            const groupUuid = actions.addGroup(
                selection.resolveTargetGroup(parentGroupUuid),
            );
            if (groupUuid) {
                store.selectedGroupUuid = groupUuid;
                selection.selectedEntryUuid.value = null;
            }
        });
    }

    function requestRenameGroup(groupUuid) {
        const group = findGroupByUuid(view(), groupUuid);
        if (!group) return;

        groupToRenameUuid.value = groupUuid;
        newGroupName.value = group.name || '';
        groupNameError.value = '';
        showRenameModal.value = true;
    }

    function confirmRenameGroup() {
        const group = findGroupByUuid(view(), groupToRenameUuid.value);
        if (!group) return;

        const normalizedName = normalizeGroupName(newGroupName.value);
        if (!normalizedName) {
            groupNameError.value = 'Group name cannot be empty.';
            return;
        }
        if (groupNameExistsInParent(group, normalizedName)) {
            groupNameError.value =
                'A group with this name already exists here.';
            return;
        }

        group.name = normalizedName;
        if (group.times) group.times.update();
        store.touchDb();
        groupToRenameUuid.value = null;
        groupNameError.value = '';
        showRenameModal.value = false;
        actions.saveDatabaseChanges({ debounce: true });
    }

    function requestDeleteGroup(groupUuid) {
        const group = findGroupByUuid(view(), groupUuid);
        if (
            !store.db ||
            !group ||
            groupUuid === getObjectUuid(view().rootGroup) ||
            isRecycleBinGroup(store.db, group)
        ) {
            return;
        }

        groupToDeleteUuid.value = groupUuid;
        showDeleteGroupConfirm.value = true;
    }

    function confirmDeleteGroup() {
        selection.requestNavigation(deleteConfirmedGroup);
    }

    function deleteConfirmedGroup() {
        const group = findGroupByUuid(view(), groupToDeleteUuid.value);
        if (!store.db || !group) return;

        if (groupContainsGroupUuid(group, store.selectedGroupUuid)) {
            store.selectedGroupUuid = getObjectUuid(view().rootGroup);
        }
        if (groupContainsEntryUuid(group, selection.selectedEntryUuid.value)) {
            selection.selectedEntryUuid.value = null;
        }

        if (isObjectInRecycleBin(view(), group)) {
            store.db.move(group, null);
        } else {
            store.db.remove(group);
        }
        groupToDeleteUuid.value = null;
        showDeleteGroupConfirm.value = false;
        store.touchDb();
        actions.saveDatabaseChanges({ debounce: true });
    }

    function restoreGroup(groupUuid) {
        const group = findGroupByUuid(view(), groupUuid);
        if (!group || !isObjectInRecycleBin(view(), group)) return;

        const target = getRestoreTargetGroup(view(), group);
        if (!target) return;
        store.db.move(group, target);
        store.touchDb();
        actions.saveDatabaseChanges({ debounce: true });
    }

    function moveGroup({ draggedUuid, targetUuid, position }) {
        const plan = resolveGroupMove(
            view(),
            draggedUuid,
            targetUuid,
            position,
        );
        if (!plan) return;

        store.db.move(plan.group, plan.toGroup, plan.atIndex);
        store.touchDb();
        actions.saveDatabaseChanges({ debounce: true });
    }

    function requestEmptyRecycleBin() {
        const bin = view().recycleBinGroup;
        if (!bin || (!bin.entries?.length && !bin.groups?.length)) return;
        showEmptyRecycleBinConfirm.value = true;
    }

    function confirmEmptyRecycleBin() {
        selection.requestNavigation(emptyConfirmedRecycleBin);
    }

    function emptyConfirmedRecycleBin() {
        const bin = view().recycleBinGroup;
        if (!store.db || !bin) return;

        // If the current selection lives inside the bin, fall back to the root.
        if (groupContainsGroupUuid(bin, store.selectedGroupUuid)) {
            store.selectedGroupUuid = getObjectUuid(view().rootGroup);
        }
        if (groupContainsEntryUuid(bin, selection.selectedEntryUuid.value)) {
            selection.selectedEntryUuid.value = null;
        }

        // Permanently delete everything in the bin (move to null records
        // tombstones).
        for (const entry of [...(bin.entries || [])])
            store.db.move(entry, null);
        for (const child of [...(bin.groups || [])]) store.db.move(child, null);

        showEmptyRecycleBinConfirm.value = false;
        store.touchDb();
        actions.saveDatabaseChanges({ debounce: true });
    }

    /** Cancel button for all three dialogs above — and what a forced lock calls
     * to take them down. */
    function cancelGroupAction() {
        showRenameModal.value = false;
        groupToRenameUuid.value = null;
        groupNameError.value = '';
        showDeleteGroupConfirm.value = false;
        showEmptyRecycleBinConfirm.value = false;
        groupToDeleteUuid.value = null;
    }

    return {
        showRenameModal,
        newGroupName,
        groupNameError,
        showDeleteGroupConfirm,
        showEmptyRecycleBinConfirm,
        groupDeleteIsPermanent,
        groupDeleteMessage,
        addGroup,
        requestRenameGroup,
        confirmRenameGroup,
        requestDeleteGroup,
        confirmDeleteGroup,
        restoreGroup,
        moveGroup,
        requestEmptyRecycleBin,
        confirmEmptyRecycleBin,
        cancelGroupAction,
    };
}
