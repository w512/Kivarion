import { describe, expect, test } from 'bun:test';
import {
    findEntryByUuid,
    findGroupByUuid,
    getAllEntries,
    groupContainsEntryUuid,
    groupContainsGroupUuid,
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
    const root = { uuid: uuid('root'), name: 'Root', entries: [rootEntry], groups: [childGroup, recycleGroup] };

    return {
        meta: { recycleBinUuid: uuid('recycle'), customIcons: new Map() },
        getDefaultGroup: () => root,
        root,
        childGroup,
        rootEntry,
        childEntry,
        recycleEntry,
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

        expect(toGroupTreeNode(db.root)).toEqual({
            uuid: 'root',
            name: 'Root',
            entryCount: 1,
            children: [
                { uuid: 'child', name: 'Child', entryCount: 1, children: [] },
                { uuid: 'recycle', name: 'Recycle Bin', entryCount: 1, children: [] },
            ],
        });

        expect(toEntryListItem(db.childEntry, db)).toMatchObject({
            uuid: 'entry-child',
            title: 'Child Entry',
            iconSrc: null,
        });
    });
});
