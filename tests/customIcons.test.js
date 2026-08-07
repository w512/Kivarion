import { describe, expect, mock, test } from 'bun:test';
import * as kdbxweb from 'kdbxweb';
import {
    addCustomIcon,
    findCustomIconByData,
    isCustomIconUsed,
    removeUnusedCustomIcon,
} from '../src/customIcons.js';

const bytes = (...values) => new Uint8Array(values).buffer;

function makeDb() {
    const historyVersion = { customIcon: undefined };
    const entry = { customIcon: undefined, history: [historyVersion] };
    const group = { customIcon: undefined, entries: [entry], groups: [] };
    const root = { customIcon: undefined, entries: [], groups: [group] };

    return {
        meta: { customIcons: new Map() },
        getDefaultGroup: () => root,
        addDeletedObject: mock(() => {}),
        root,
        group,
        entry,
        historyVersion,
    };
}

describe('custom icon storage', () => {
    test('stores bytes with a name and reuses an identical icon', () => {
        const db = makeDb();

        const first = addCustomIcon(db, bytes(1, 2, 3), 'logo.png');
        const second = addCustomIcon(db, bytes(1, 2, 3), 'copy.png');

        // An icon lives inside the .kdbx and is re-encrypted on every save, so
        // the same image must never be stored twice.
        expect(second.id).toBe(first.id);
        expect(db.meta.customIcons.size).toBe(1);
        expect(db.meta.customIcons.get(first.id).name).toBe('logo.png');
        expect(findCustomIconByData(db, bytes(1, 2, 3))).toBe(first.id);
        expect(findCustomIconByData(db, bytes(9))).toBe(null);

        const other = addCustomIcon(db, bytes(4, 5, 6));
        expect(other.id).not.toBe(first.id);
        expect(db.meta.customIcons.size).toBe(2);
    });

    test('counts a group, an entry and a history version as users', () => {
        const db = makeDb();
        const icon = addCustomIcon(db, bytes(1));

        expect(isCustomIconUsed(db, icon.id)).toBe(false);

        for (const holder of [db.group, db.entry, db.historyVersion]) {
            holder.customIcon = new kdbxweb.KdbxUuid(icon.id);
            expect(isCustomIconUsed(db, icon.id)).toBe(true);
            holder.customIcon = undefined;
        }
    });

    test('keeps an icon a group still uses when an entry drops it', () => {
        const db = makeDb();
        const icon = addCustomIcon(db, bytes(1));
        db.group.customIcon = new kdbxweb.KdbxUuid(icon.id);
        db.entry.customIcon = new kdbxweb.KdbxUuid(icon.id);

        // The entry moves on; the group is still pointing at the icon.
        db.entry.customIcon = undefined;

        expect(removeUnusedCustomIcon(db, icon.id)).toBe(false);
        expect(db.meta.customIcons.has(icon.id)).toBe(true);
        expect(db.addDeletedObject).not.toHaveBeenCalled();
    });

    test('deletes an unused icon and records a tombstone for it', () => {
        const db = makeDb();
        const icon = addCustomIcon(db, bytes(1));

        expect(removeUnusedCustomIcon(db, icon.id)).toBe(true);
        expect(db.meta.customIcons.has(icon.id)).toBe(false);
        // Without the tombstone a merge from another copy of a synced vault
        // brings the icon straight back.
        expect(db.addDeletedObject).toHaveBeenCalledTimes(1);
        expect(db.addDeletedObject.mock.calls[0][0].id).toBe(icon.id);

        expect(removeUnusedCustomIcon(db, icon.id)).toBe(false);
        expect(removeUnusedCustomIcon(db, null)).toBe(false);
    });
});
