/**
 * A stand-in for an open `kdbxweb.Kdbx`, small enough to read in one screen.
 *
 * `buildDatabaseView` only ever reads the graph, so plain objects are enough —
 * what the tests need beyond that is a record of the mutations, which is why
 * `move` and `remove` push onto `moved`/`removed` instead of doing anything.
 */

export function uuid(id) {
    return {
        id,
        equals(other) {
            return other?.id === id;
        },
    };
}

export function fakeEntry(id, title) {
    return {
        uuid: uuid(id),
        fields: new Map([['Title', title]]),
        times: {
            creationTime: new Date('2024-01-01T00:00:00Z'),
            lastModTime: new Date('2024-01-02T00:00:00Z'),
            update() {},
        },
    };
}

/**
 * Root
 *  ├─ Child          (Child Entry)
 *  ├─ Recycle Bin    (Trash Entry)
 *  └─ Root Entry
 */
export function makeFakeDatabase() {
    const rootEntry = fakeEntry('entry-root', 'Root Entry');
    const childEntry = fakeEntry('entry-child', 'Child Entry');
    const recycleEntry = fakeEntry('entry-trash', 'Trash Entry');
    const recycleGroup = {
        uuid: uuid('recycle'),
        name: 'Recycle Bin',
        entries: [recycleEntry],
        groups: [],
    };
    const childGroup = {
        uuid: uuid('child'),
        name: 'Child',
        entries: [childEntry],
        groups: [],
    };
    const root = {
        uuid: uuid('root'),
        name: 'Root',
        entries: [rootEntry],
        groups: [childGroup, recycleGroup],
    };
    childGroup.parentGroup = root;
    recycleGroup.parentGroup = root;
    rootEntry.parentGroup = root;
    childEntry.parentGroup = childGroup;
    recycleEntry.parentGroup = recycleGroup;

    const moved = [];
    const removed = [];
    return {
        meta: {
            name: 'Test Vault',
            recycleBinEnabled: true,
            recycleBinUuid: uuid('recycle'),
            customIcons: new Map(),
        },
        getDefaultGroup: () => root,
        move(object, target, atIndex) {
            // Only record the index when a caller passed one, so the many
            // assertions written as `{ object, target }` keep matching.
            moved.push(
                atIndex === undefined
                    ? { object, target }
                    : { object, target, atIndex },
            );
        },
        remove(object) {
            removed.push(object);
        },
        moved,
        removed,
        root,
        childGroup,
        recycleGroup,
        rootEntry,
        childEntry,
        recycleEntry,
    };
}
