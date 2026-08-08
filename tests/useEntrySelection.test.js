import { beforeEach, describe, expect, test } from 'bun:test';
import { computed, nextTick, reactive } from 'vue';
import { buildDatabaseView } from '../src/kdbxView.js';
import { makeFakeDatabase, uuid } from './helpers/fakeDatabase.js';
import { renderer } from './helpers/vueSfc.js';
import { useEntrySelection } from '../src/composables/useEntrySelection.js';
import { useGroupActions } from '../src/composables/useGroupActions.js';
import { useEntryActions } from '../src/composables/useEntryActions.js';

// The page's three columns pulled apart: what is selected, and the group and
// entry actions that move that selection while they mutate the vault. The draft
// guard is the seam between them — every action that swaps the detail column has
// to wait for the unsaved-changes answer, and each of these used to be the one
// that did not.

let store;
let db;
let saves;
let added;

/** Mount the three composables the way `DatabasePage` composes them. */
function mountPage() {
    let api;
    const app = renderer.createApp({
        setup() {
            const databaseView = computed(() => {
                store.dbVersion;
                return buildDatabaseView(store.db);
            });
            const actions = {
                saveDatabaseChanges: (options) => saves.push(options ?? null),
                addEntry: (group) => {
                    added.push({ kind: 'entry', group });
                    return 'entry-new';
                },
                addGroup: (group) => {
                    added.push({ kind: 'group', group });
                    return 'group-new';
                },
            };
            const selection = useEntrySelection(store, databaseView);
            api = {
                databaseView,
                selection,
                groups: useGroupActions(store, {
                    databaseView,
                    selection,
                    actions,
                }),
                entries: useEntryActions(store, {
                    databaseView,
                    selection,
                    actions,
                }),
            };
            return () => null;
        },
    });
    app.mount({});
    return api;
}

/** Pretend an entry edit is open, and report what the modal's answers did. */
function openDraft(selection) {
    const calls = { saved: 0, discarded: 0 };
    let dirty = true;
    selection.entryDetailRef.value = {
        hasUnsavedChanges: () => dirty,
        savePendingEdit: () => {
            calls.saved++;
            dirty = false;
            return true;
        },
        discardPendingEdit: () => {
            calls.discarded++;
            dirty = false;
        },
    };
    return calls;
}

beforeEach(() => {
    db = makeFakeDatabase();
    saves = [];
    added = [];
    store = reactive({
        db,
        dbVersion: 0,
        filePath: '/tmp/test.kdbx',
        selectedGroupUuid: 'root',
        touchDb() {
            store.dbVersion++;
        },
    });
});

describe('selection and the draft guard', () => {
    test('selecting a group clears the search box and the open entry', () => {
        const { selection } = mountPage();
        selection.selectedEntryUuid.value = 'entry-root';
        selection.searchQuery.value = 'needle';

        selection.selectGroup('child');

        expect(store.selectedGroupUuid).toBe('child');
        expect(selection.selectedEntryUuid.value).toBe(null);
        expect(selection.searchQuery.value).toBe('');
    });

    test('the list follows the selected group, and the query once it settles', async () => {
        const { selection } = mountPage();

        store.selectedGroupUuid = 'child';
        expect(selection.filteredEntries.value.map((row) => row.title)).toEqual(
            ['Child Entry'],
        );

        selection.searchQuery.value = 'root entry';
        await nextTick();
        // Still the group's own entries: the query has not settled yet.
        expect(selection.filteredEntries.value.map((row) => row.title)).toEqual(
            ['Child Entry'],
        );

        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(selection.filteredEntries.value.map((row) => row.title)).toEqual(
            ['Root Entry'],
        );

        // Clearing is instant — no second pause before the list comes back.
        selection.searchQuery.value = '';
        await nextTick();
        expect(selection.filteredEntries.value.map((row) => row.title)).toEqual(
            ['Child Entry'],
        );
    });

    test('a pending selection is parked until the modal is answered', () => {
        const { selection } = mountPage();
        const draft = openDraft(selection);

        expect(selection.selectEntry('entry-child')).toBe(undefined);
        expect(selection.showUnsavedEditConfirm.value).toBe(true);
        expect(selection.selectedEntryUuid.value).toBe(null);

        selection.continueEditing();
        expect(selection.selectedEntryUuid.value).toBe(null);
        expect(draft.saved + draft.discarded).toBe(0);
    });

    test('saving the draft carries the parked selection through', async () => {
        const { selection } = mountPage();
        const draft = openDraft(selection);

        selection.selectEntry('entry-child');
        await selection.saveUnsavedEditAndContinue();

        expect(draft.saved).toBe(1);
        expect(selection.selectedEntryUuid.value).toBe('entry-child');
        expect(selection.showUnsavedEditConfirm.value).toBe(false);
    });

    test('a reload drops a selection the file on disk does not have', () => {
        const { selection } = mountPage();
        store.selectedGroupUuid = 'child';
        selection.selectedEntryUuid.value = 'entry-child';

        db.root.groups = [db.recycleGroup];
        store.touchDb();
        selection.restoreSelectionAfterReload();

        expect(store.selectedGroupUuid).toBe('root');
        expect(selection.selectedEntryUuid.value).toBe(null);
    });
});

describe('entry actions', () => {
    test('adding an entry waits for the unsaved-changes answer', () => {
        const { selection, entries } = mountPage();
        openDraft(selection);

        entries.addEntry();
        expect(added).toEqual([]);

        selection.discardUnsavedEditAndContinue();
        expect(added).toEqual([{ kind: 'entry', group: db.root }]);
        expect(selection.selectedEntryUuid.value).toBe('entry-new');
    });

    test('dragging an entry onto a group waits for it too', () => {
        const { selection, entries } = mountPage();
        openDraft(selection);

        entries.moveEntry({
            entryUuid: 'entry-root',
            targetGroupUuid: 'child',
        });
        expect(db.moved).toEqual([]);

        selection.discardUnsavedEditAndContinue();
        expect(db.moved).toEqual([
            { object: db.rootEntry, target: db.childGroup },
        ]);
        expect(store.selectedGroupUuid).toBe('child');
        expect(selection.selectedEntryUuid.value).toBe('entry-root');
        expect(saves).toEqual([{ debounce: true }]);
    });

    test('delete recycles outside the bin and is permanent inside it', () => {
        const { selection, entries } = mountPage();

        entries.requestDelete(db.childEntry);
        expect(entries.entryDeleteIsPermanent.value).toBe(false);
        expect(entries.entryDeleteMessage.value).toContain('Recycle Bin');
        entries.confirmDelete();
        expect(db.removed).toEqual([db.childEntry]);

        entries.requestDelete(db.recycleEntry);
        expect(entries.entryDeleteIsPermanent.value).toBe(true);
        entries.confirmDelete();
        expect(db.moved).toEqual([{ object: db.recycleEntry, target: null }]);
        expect(entries.showDeleteConfirm.value).toBe(false);
        expect(selection.selectedEntryUuid.value).toBe(null);
    });

    test('restoring sends an entry back to the group it came from', () => {
        const { entries } = mountPage();
        db.recycleEntry.previousParentGroup = db.childGroup.uuid;

        entries.restoreEntry('entry-trash');

        expect(db.moved).toEqual([
            { object: db.recycleEntry, target: db.childGroup },
        ]);
    });

    test('restoring an entry that is not in the bin does nothing', () => {
        const { entries } = mountPage();

        entries.restoreEntry('entry-child');
        entries.restoreEntry('entry-that-does-not-exist');

        expect(db.moved).toEqual([]);
        expect(saves).toEqual([]);
    });

    test('restoring the open entry closes the detail column', () => {
        const { selection, entries } = mountPage();
        selection.selectedEntryUuid.value = 'entry-trash';

        // No previousParentGroup recorded (pre-4.1 file): root is the target.
        entries.restoreEntry('entry-trash');

        expect(db.moved).toEqual([
            { object: db.recycleEntry, target: db.root },
        ]);
        expect(selection.selectedEntryUuid.value).toBe(null);
        expect(saves).toEqual([{ debounce: true }]);
    });
});

describe('group actions', () => {
    test('renaming rejects an empty or duplicate name', () => {
        const { groups } = mountPage();

        groups.requestRenameGroup('child');
        expect(groups.newGroupName.value).toBe('Child');

        groups.newGroupName.value = '   ';
        groups.confirmRenameGroup();
        expect(groups.groupNameError.value).toBe('Group name cannot be empty.');

        groups.newGroupName.value = 'recycle bin';
        groups.confirmRenameGroup();
        expect(groups.groupNameError.value).toContain('already exists');
        expect(db.childGroup.name).toBe('Child');

        groups.newGroupName.value = 'Renamed';
        groups.confirmRenameGroup();
        expect(db.childGroup.name).toBe('Renamed');
        expect(groups.showRenameModal.value).toBe(false);
        expect(saves).toEqual([{ debounce: true }]);
    });

    test('neither the root nor the bin can be deleted', () => {
        const { groups } = mountPage();

        groups.requestDeleteGroup('root');
        expect(groups.showDeleteGroupConfirm.value).toBe(false);

        groups.requestDeleteGroup('recycle');
        expect(groups.showDeleteGroupConfirm.value).toBe(false);
    });

    test('deleting the group holding the selection moves it to the root', () => {
        const { selection, groups } = mountPage();
        store.selectedGroupUuid = 'child';
        selection.selectedEntryUuid.value = 'entry-child';

        groups.requestDeleteGroup('child');
        expect(groups.groupDeleteIsPermanent.value).toBe(false);
        expect(groups.groupDeleteMessage.value).toContain('“Child”');

        groups.confirmDeleteGroup();

        expect(db.removed).toEqual([db.childGroup]);
        expect(store.selectedGroupUuid).toBe('root');
        expect(selection.selectedEntryUuid.value).toBe(null);
    });

    test('deleting a group already in the bin is permanent', () => {
        const trashGroup = {
            uuid: uuid('trash-group'),
            name: 'Old',
            entries: [],
            groups: [],
            parentGroup: db.recycleGroup,
        };
        db.recycleGroup.groups.push(trashGroup);
        const { groups } = mountPage();

        groups.requestDeleteGroup('trash-group');
        expect(groups.groupDeleteIsPermanent.value).toBe(true);
        expect(groups.groupDeleteMessage.value).toContain(
            'permanently deleted',
        );

        groups.confirmDeleteGroup();

        // `move(group, null)` records a tombstone; `remove` would recycle the
        // group right back into the bin it is being deleted from.
        expect(db.moved).toEqual([{ object: trashGroup, target: null }]);
        expect(db.removed).toEqual([]);
        expect(groups.showDeleteGroupConfirm.value).toBe(false);
        expect(saves).toEqual([{ debounce: true }]);
    });

    test('restoring a group sends it back to the group it came from', () => {
        const trashGroup = {
            uuid: uuid('trash-group'),
            name: 'Old',
            entries: [],
            groups: [],
            parentGroup: db.recycleGroup,
            previousParentGroup: db.childGroup.uuid,
        };
        db.recycleGroup.groups.push(trashGroup);
        const { groups } = mountPage();

        groups.restoreGroup('trash-group');

        expect(db.moved).toEqual([
            { object: trashGroup, target: db.childGroup },
        ]);
        expect(saves).toEqual([{ debounce: true }]);
    });

    test('restoring falls back to the root when the original parent is gone', () => {
        const trashGroup = {
            uuid: uuid('trash-group'),
            name: 'Old',
            entries: [],
            groups: [],
            parentGroup: db.recycleGroup,
            previousParentGroup: uuid('group-that-no-longer-exists'),
        };
        db.recycleGroup.groups.push(trashGroup);
        const { groups } = mountPage();

        groups.restoreGroup('trash-group');

        expect(db.moved).toEqual([{ object: trashGroup, target: db.root }]);
    });

    test('restoring a group that is not in the bin does nothing', () => {
        const { groups } = mountPage();

        groups.restoreGroup('child');
        groups.restoreGroup('group-that-does-not-exist');

        expect(db.moved).toEqual([]);
        expect(saves).toEqual([]);
    });

    test('a drag reorder moves the group to the resolved index', () => {
        const { groups } = mountPage();

        // Root's children are [Child, Recycle Bin]; dropping Child after the
        // bin lands at index 1 because `move` splices Child out first.
        groups.moveGroup({
            draggedUuid: 'child',
            targetUuid: 'recycle',
            position: 'after',
        });

        expect(db.moved).toEqual([
            { object: db.childGroup, target: db.root, atIndex: 1 },
        ]);
        expect(saves).toEqual([{ debounce: true }]);
    });

    test('a drag the view model rejects moves nothing', () => {
        const { groups } = mountPage();

        // The root cannot be moved; `resolveGroupMove` returns null.
        groups.moveGroup({
            draggedUuid: 'root',
            targetUuid: 'child',
            position: 'inside',
        });

        expect(db.moved).toEqual([]);
        expect(saves).toEqual([]);
    });

    test('emptying the bin waits for the draft, then clears both kinds', () => {
        const { selection, groups } = mountPage();
        openDraft(selection);
        store.selectedGroupUuid = 'recycle';
        db.recycleGroup.groups.push({
            uuid: uuid('trash-group'),
            name: 'Old',
            entries: [],
            groups: [],
            parentGroup: db.recycleGroup,
        });
        store.touchDb();

        groups.requestEmptyRecycleBin();
        expect(groups.showEmptyRecycleBinConfirm.value).toBe(true);

        groups.confirmEmptyRecycleBin();
        expect(db.moved).toEqual([]);

        selection.discardUnsavedEditAndContinue();
        expect(db.moved.map((call) => call.object.name ?? 'entry')).toEqual([
            'entry',
            'Old',
        ]);
        expect(store.selectedGroupUuid).toBe('root');
        expect(groups.showEmptyRecycleBinConfirm.value).toBe(false);
    });

    test('a new group is added under the group that asked for it', () => {
        const { selection, groups } = mountPage();

        groups.addGroup('child');

        expect(added).toEqual([{ kind: 'group', group: db.childGroup }]);
        expect(store.selectedGroupUuid).toBe('group-new');
        expect(selection.selectedEntryUuid.value).toBe(null);
    });
});
