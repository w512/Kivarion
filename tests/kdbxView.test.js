import { describe, expect, test } from 'bun:test';
import {
    findEntryByUuid,
    findGroupByUuid,
    getAllEntries,
    groupContainsEntryUuid,
    groupContainsGroupUuid,
    getUniqueGroupName,
    groupNameExistsInParent,
    resolveGroupMove,
    toEntryListItem,
    toGroupTreeNode,
} from '../src/kdbxView.js';

function uuid(id) {
    return {
        id,
        equals(other) {
            return other?.id === id;
        },
    };
}

function entry(id, title) {
    return {
        uuid: uuid(id),
        fields: new Map([['Title', title]]),
        times: {
            creationTime: new Date('2024-01-01T00:00:00Z'),
            lastModTime: new Date('2024-01-02T00:00:00Z'),
        },
    };
}

function makeDb() {
    const rootEntry = entry('entry-root', 'Root Entry');
    const childEntry = entry('entry-child', 'Child Entry');
    const recycleEntry = entry('entry-trash', 'Trash Entry');
    const recycleGroup = { uuid: uuid('recycle'), name: 'Recycle Bin', entries: [recycleEntry], groups: [] };
    const childGroup = { uuid: uuid('child'), name: 'Child', entries: [childEntry], groups: [] };
    const duplicateGroup = { uuid: uuid('duplicate'), name: 'New group', entries: [], groups: [] };
    const root = { uuid: uuid('root'), name: 'Root', entries: [rootEntry], groups: [childGroup, recycleGroup, duplicateGroup] };
    childGroup.parentGroup = root;
    recycleGroup.parentGroup = root;
    duplicateGroup.parentGroup = root;

    return {
        meta: { recycleBinUuid: uuid('recycle'), customIcons: new Map() },
        getDefaultGroup: () => root,
        root,
        childGroup,
        rootEntry,
        childEntry,
        recycleEntry,
        duplicateGroup,
    };
}

describe('kdbx view helpers', () => {
    test('finds groups and entries by uuid', () => {
        const db = makeDb();

        expect(findGroupByUuid(db, 'child')).toBe(db.childGroup);
        expect(findEntryByUuid(db, 'entry-child')).toBe(db.childEntry);
        expect(findGroupByUuid(db, 'missing')).toBe(null);
        expect(findEntryByUuid(db, 'missing')).toBe(null);
    });

    test('checks subtree containment by uuid', () => {
        const db = makeDb();

        expect(groupContainsGroupUuid(db.root, 'child')).toBe(true);
        expect(groupContainsEntryUuid(db.root, 'entry-child')).toBe(true);
        expect(groupContainsEntryUuid(db.childGroup, 'entry-root')).toBe(false);
    });

    test('collects all entries excluding recycle bin', () => {
        const db = makeDb();

        expect(getAllEntries(db).map(e => e.uuid.id)).toEqual(['entry-root', 'entry-child']);
    });

    test('maps groups and entries to plain view models', () => {
        const db = makeDb();

        expect(toGroupTreeNode(db.root, db)).toEqual({
            uuid: 'root',
            name: 'Root',
            entryCount: 1,
            isRecycleBin: false,
            children: [
                { uuid: 'child', name: 'Child', entryCount: 1, isRecycleBin: false, children: [] },
                { uuid: 'recycle', name: 'Recycle Bin', entryCount: 1, isRecycleBin: true, children: [] },
                { uuid: 'duplicate', name: 'New group', entryCount: 0, isRecycleBin: false, children: [] },
            ],
        });

        expect(toEntryListItem(db.childEntry, db)).toMatchObject({
            uuid: 'entry-child',
            title: 'Child Entry',
            iconSrc: null,
        });
    });

    test('resolves valid group moves into move() arguments', () => {
        const db = makeDb();

        // Nest 'duplicate' inside sibling 'child' → append (no index).
        expect(resolveGroupMove(db, 'duplicate', 'child', 'inside')).toEqual({
            group: db.duplicateGroup,
            toGroup: db.childGroup,
            atIndex: undefined,
        });

        // root.groups order: [child(0), recycle(1), duplicate(2)].
        // Reorder 'duplicate' before 'child' → lands at index 0.
        expect(resolveGroupMove(db, 'duplicate', 'child', 'before')).toMatchObject({
            group: db.duplicateGroup,
            toGroup: db.root,
            atIndex: 0,
        });

        // Same-parent shift: drag 'child' (idx 0) after 'duplicate' (idx 2).
        // Raw insert index is 3, decremented to 2 because the splice removes
        // 'child' from an earlier position first.
        expect(resolveGroupMove(db, 'child', 'duplicate', 'after')).toMatchObject({
            group: db.childGroup,
            toGroup: db.root,
            atIndex: 2,
        });
    });

    test('rejects invalid group moves', () => {
        const db = makeDb();

        // Give 'child' a descendant so we can test the cycle guard.
        const grand = { uuid: uuid('grand'), name: 'Grand', entries: [], groups: [] };
        grand.parentGroup = db.childGroup;
        db.childGroup.groups.push(grand);

        expect(resolveGroupMove(db, 'child', 'child', 'inside')).toBe(null); // onto self
        expect(resolveGroupMove(db, 'child', 'grand', 'inside')).toBe(null); // into own descendant
        expect(resolveGroupMove(db, 'root', 'child', 'inside')).toBe(null);  // root can't move
        expect(resolveGroupMove(db, 'child', 'root', 'before')).toBe(null);  // root has no siblings
        expect(resolveGroupMove(db, 'child', 'missing', 'inside')).toBe(null);
    });

    test('validates group sibling names and generates unique defaults', () => {
        const db = makeDb();

        expect(groupNameExistsInParent(db.childGroup, ' recycle bin ')).toBe(true);
        expect(groupNameExistsInParent(db.childGroup, 'Child')).toBe(false);
        expect(getUniqueGroupName(db.root)).toBe('New group 2');
        expect(getUniqueGroupName(db.root, 'Project')).toBe('Project');
    });
});
