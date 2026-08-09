import { describe, expect, test } from 'bun:test';
import * as kdbxweb from 'kdbxweb';

import { normalizeDatabase } from '../src/dbHelper.js';

async function makeRealDatabase() {
    const credentials = new kdbxweb.Credentials(
        kdbxweb.ProtectedValue.fromString('123'),
    );
    await credentials.ready;
    const db = kdbxweb.Kdbx.create(credentials, 'Vault');
    // AES-KDF keeps this independent of the Argon2 engine that `main.js`
    // wires into kdbxweb at app start.
    db.setKdf(kdbxweb.Consts.KdfId.Aes);
    return db;
}

describe('normalizeDatabase', () => {
    // kdbxweb serializes an `undefined` optional field as an *empty* element
    // (`<EnableSearching></EnableSearching>`, `<UsageCount></UsageCount>`),
    // which KeePassXC rejects with "Invalid EnableSearching value" / "Invalid
    // number value" — a vault saved by Kivarion became unopenable elsewhere.
    // `undefined` shows up whenever the source file omitted the element, so
    // each field is pinned to its KeePass default after load.
    test('pins undefined tri-state flags to null across the whole tree', async () => {
        const db = await makeRealDatabase();
        const root = db.getDefaultGroup();
        const child = db.createGroup(root, 'Child');
        const grandchild = db.createGroup(child, 'Grandchild');
        // What a group read from a file without these elements looks like.
        child.enableSearching = undefined;
        child.enableAutoType = undefined;
        grandchild.enableSearching = undefined;

        expect(normalizeDatabase(db)).toBe(db);

        expect(child.enableSearching).toBe(null);
        expect(child.enableAutoType).toBe(null);
        expect(grandchild.enableSearching).toBe(null);
    });

    test('pins undefined numbers and plain booleans to their KeePass defaults', async () => {
        const db = await makeRealDatabase();
        const root = db.getDefaultGroup();
        const child = db.createGroup(root, 'Child');
        const entry = db.createEntry(child);
        entry.pushHistory();

        child.icon = undefined;
        child.expanded = undefined;
        child.times.usageCount = undefined;
        child.times.expires = undefined;
        entry.times.usageCount = undefined;
        entry.history[0].times.usageCount = undefined;
        db.meta._mntncHistoryDays = undefined;
        db.meta._keyChangeRec = undefined;
        db.meta._keyChangeForce = undefined;
        db.meta._historyMaxItems = undefined;
        db.meta._historyMaxSize = undefined;

        normalizeDatabase(db);

        expect(child.icon).toBe(kdbxweb.Consts.Icons.Folder);
        expect(child.expanded).toBe(true);
        expect(child.times.usageCount).toBe(0);
        expect(child.times.expires).toBe(false);
        expect(entry.times.usageCount).toBe(0);
        expect(entry.history[0].times.usageCount).toBe(0);
        expect(db.meta.mntncHistoryDays).toBe(
            kdbxweb.Consts.Defaults.MntncHistoryDays,
        );
        expect(db.meta.keyChangeRec).toBe(-1);
        expect(db.meta.keyChangeForce).toBe(-1);
        expect(db.meta.historyMaxItems).toBe(
            kdbxweb.Consts.Defaults.HistoryMaxItems,
        );
        expect(db.meta.historyMaxSize).toBe(
            kdbxweb.Consts.Defaults.HistoryMaxSize,
        );
    });

    test('leaves explicit values untouched', async () => {
        const db = await makeRealDatabase();
        const root = db.getDefaultGroup();
        const searchable = db.createGroup(root, 'Searchable');
        const excluded = db.createGroup(root, 'Excluded');
        searchable.enableSearching = true;
        searchable.enableAutoType = false;
        searchable.icon = 7;
        searchable.expanded = false;
        searchable.times.usageCount = 3;
        searchable.times.expires = true;
        excluded.enableSearching = false;
        db.meta.historyMaxItems = 42;
        db.meta.keyChangeRec = 90;
        // The recycle bin created by kdbxweb has `enableSearching = false`.

        normalizeDatabase(db);

        expect(searchable.enableSearching).toBe(true);
        expect(searchable.enableAutoType).toBe(false);
        expect(searchable.icon).toBe(7);
        expect(searchable.expanded).toBe(false);
        expect(searchable.times.usageCount).toBe(3);
        expect(searchable.times.expires).toBe(true);
        expect(excluded.enableSearching).toBe(false);
        expect(root.enableSearching).toBe(null);
        expect(db.meta.historyMaxItems).toBe(42);
        expect(db.meta.keyChangeRec).toBe(90);
    });

    test('tolerates a database with no groups', () => {
        expect(() => normalizeDatabase({})).not.toThrow();
        expect(() => normalizeDatabase(null)).not.toThrow();
    });

    test('a normalized database never serializes an empty element for these fields', async () => {
        const db = await makeRealDatabase();
        const root = db.getDefaultGroup();
        const child = db.createGroup(root, 'Child');
        const entry = db.createEntry(child);
        child.enableSearching = undefined;
        child.enableAutoType = undefined;
        child.icon = undefined;
        child.times.usageCount = undefined;
        entry.times.usageCount = undefined;
        db.meta._historyMaxItems = undefined;

        // Without normalization the empty elements are really there — this is
        // the file KeePassXC refused to open.
        const brokenXml = await db.saveXml();
        expect(brokenXml).toContain('<EnableSearching/>');
        expect(brokenXml).toContain('<UsageCount/>');
        expect(brokenXml).toContain('<HistoryMaxItems/>');

        normalizeDatabase(db);
        const xml = await db.saveXml();

        for (const element of [
            'EnableSearching',
            'EnableAutoType',
            'IsExpanded',
            'Expires',
            'IconID',
            'UsageCount',
            'MaintenanceHistoryDays',
            'MasterKeyChangeRec',
            'MasterKeyChangeForce',
            'HistoryMaxItems',
            'HistoryMaxSize',
        ]) {
            expect(xml).not.toContain(`<${element}/>`);
            expect(xml).not.toContain(`<${element}></${element}>`);
        }
        expect(xml).toContain('<EnableSearching>null</EnableSearching>');
    });

    test('survives a full save/load round trip with the defaults, not undefined', async () => {
        const db = await makeRealDatabase();
        const child = db.createGroup(db.getDefaultGroup(), 'Child');
        child.enableSearching = undefined;
        child.icon = undefined;
        child.times.usageCount = undefined;
        normalizeDatabase(db);

        const bytes = await db.save();
        const reloaded = await kdbxweb.Kdbx.load(bytes, db.credentials);
        const reloadedChild = reloaded
            .getDefaultGroup()
            .groups.find((g) => g.name === 'Child');

        expect(reloadedChild.enableSearching).toBe(null);
        expect(reloadedChild.enableAutoType).toBe(null);
        expect(reloadedChild.icon).toBe(kdbxweb.Consts.Icons.Folder);
        expect(reloadedChild.times.usageCount).toBe(0);
    });
});
