import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { computed, reactive } from 'vue';
import * as kdbxweb from 'kdbxweb';
import { buildDatabaseView } from '../src/kdbxView.js';

// Only the two backend calls the file pick makes are mocked; `mock.module` is
// process-global in Bun, so the handler is a per-test variable rather than a
// fixed table.
let invokeHandler;
mock.module('@tauri-apps/api/core', () => ({
    invoke: (cmd, args) => invokeHandler(cmd, args),
}));

const { MAX_ICON_FILE_SIZE, useIconPicker } =
    await import('../src/composables/useIconPicker.js');

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3];
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function uuid(id) {
    return { id, equals: (other) => other?.id === id };
}

function makeDb() {
    const entry = {
        uuid: uuid('entry-1'),
        fields: new Map([
            ['Title', 'Example'],
            ['URL', 'https://example.com'],
        ]),
        times: { update: mock(() => {}) },
        icon: 0,
        history: [],
    };
    const group = {
        uuid: uuid('group-1'),
        name: 'Work',
        entries: [entry],
        groups: [],
        times: { update: mock(() => {}) },
        icon: 48,
    };
    const root = {
        uuid: uuid('root'),
        name: 'Root',
        entries: [],
        groups: [group],
        times: { update: mock(() => {}) },
    };

    return {
        meta: { customIcons: new Map() },
        getDefaultGroup: () => root,
        addDeletedObject: mock(() => {}),
        root,
        group,
        entry,
    };
}

let db;
let store;
let actions;
let downloadIcon;
let picker;

function setup() {
    db = makeDb();
    store = reactive({
        db,
        dbVersion: 0,
        downloadSiteIcons: true,
        touchDb() {
            this.dbVersion++;
        },
    });
    actions = { saveDatabaseChanges: mock(() => {}) };
    downloadIcon = mock(async () => true);

    const databaseView = computed(() => {
        store.dbVersion;
        return buildDatabaseView(store.db, new Map());
    });

    picker = useIconPicker(store, {
        databaseView,
        actions,
        iconDataUrls: new Map(),
        // Indirect, so a test can swap the mock after construction.
        downloadIcon: (entry) => downloadIcon(entry),
    });
}

function storeIcon(bytes = PNG, name = 'stored.png') {
    const id = kdbxweb.KdbxUuid.random().id;
    db.meta.customIcons.set(id, {
        data: new Uint8Array(bytes).buffer,
        name,
    });
    return id;
}

beforeEach(() => {
    invokeHandler = async () => null;
    setup();
});

describe('useIconPicker', () => {
    test('opens for a group by uuid and for an entry by object', () => {
        picker.openGroupIconPicker('group-1');
        expect(picker.showIconPicker.value).toBe(true);
        expect(picker.iconTargetName.value).toBe('Work');
        expect(picker.selectedIconId.value).toBe(48);

        picker.openEntryIconPicker(db.entry);
        expect(picker.iconTargetName.value).toBe('Example');
        expect(picker.selectedIconId.value).toBe(0);

        // An object that is not in this database opens nothing at all.
        picker.closeIconPicker();
        picker.openGroupIconPicker('missing');
        expect(picker.showIconPicker.value).toBe(false);
    });

    test('assigns a standard icon, drops the custom one and saves', () => {
        const iconId = storeIcon();
        db.group.customIcon = new kdbxweb.KdbxUuid(iconId);
        picker.openGroupIconPicker('group-1');

        picker.chooseStandardIcon(61);

        expect(db.group.icon).toBe(61);
        // A custom icon wins wherever an icon is drawn, so choosing a built-in
        // one has to clear it — and the icon nobody uses now goes with it.
        expect(db.group.customIcon).toBeUndefined();
        expect(db.meta.customIcons.has(iconId)).toBe(false);
        expect(db.group.times.update).toHaveBeenCalled();
        expect(store.dbVersion).toBe(1);
        expect(actions.saveDatabaseChanges).toHaveBeenCalledWith({
            debounce: true,
        });
        expect(picker.showIconPicker.value).toBe(false);
    });

    test('keeps a replaced icon that another object still uses', () => {
        const iconId = storeIcon();
        db.group.customIcon = new kdbxweb.KdbxUuid(iconId);
        db.entry.customIcon = new kdbxweb.KdbxUuid(iconId);

        picker.openGroupIconPicker('group-1');
        picker.chooseStandardIcon(61);

        expect(db.meta.customIcons.has(iconId)).toBe(true);
    });

    test('assigns a stored custom icon, and ignores an unknown one', () => {
        const iconId = storeIcon();
        picker.openEntryIconPicker(db.entry);

        picker.chooseCustomIcon('not-in-this-database');
        expect(db.entry.customIcon).toBeUndefined();
        expect(picker.showIconPicker.value).toBe(true);

        picker.chooseCustomIcon(iconId);
        expect(db.entry.customIcon.id).toBe(iconId);
        expect(picker.selectedCustomIconId.value).toBe(null); // dialog closed
    });

    test('resets to the default icon of the kind it was opened for', () => {
        db.group.icon = 61;
        db.entry.icon = 61;

        picker.openGroupIconPicker('group-1');
        picker.useDefaultIcon();
        expect(db.group.icon).toBe(48);

        picker.openEntryIconPicker(db.entry);
        picker.useDefaultIcon();
        expect(db.entry.icon).toBe(0);
    });

    test('lists the database icons with data URLs for the grid', () => {
        storeIcon(PNG, 'first.png');
        // An icon with no bytes cannot be drawn and must not leave a hole.
        db.meta.customIcons.set('empty', { data: null });

        picker.openGroupIconPicker('group-1');

        expect(picker.pickerCustomIcons.value).toHaveLength(1);
        expect(picker.pickerCustomIcons.value[0].name).toBe('first.png');
        expect(picker.pickerCustomIcons.value[0].src).toStartWith(
            'data:image/png;base64,',
        );
    });

    test('stores an icon picked from a file', async () => {
        invokeHandler = async (cmd) => {
            if (cmd === 'pick_attachment_file') {
                return {
                    path: '/tmp/logo.png',
                    fileName: 'logo.png',
                    size: 11,
                };
            }
            if (cmd === 'read_database') return new Uint8Array(PNG);
            return null;
        };
        picker.openEntryIconPicker(db.entry);

        await picker.pickIconFile();
        await flush();

        expect(db.meta.customIcons.size).toBe(1);
        const [id, icon] = [...db.meta.customIcons.entries()][0];
        expect(icon.name).toBe('logo.png');
        expect(db.entry.customIcon.id).toBe(id);
        expect(actions.saveDatabaseChanges).toHaveBeenCalled();
        expect(picker.showIconPicker.value).toBe(false);
        expect(picker.iconPickerBusy.value).toBe(false);
    });

    test('reuses the stored icon when the same file is picked again', async () => {
        const existingId = storeIcon(PNG, 'already-here.png');
        db.group.customIcon = new kdbxweb.KdbxUuid(existingId);
        invokeHandler = async (cmd) => {
            if (cmd === 'pick_attachment_file') {
                return {
                    path: '/tmp/logo.png',
                    fileName: 'logo.png',
                    size: 11,
                };
            }
            if (cmd === 'read_database') return new Uint8Array(PNG);
            return null;
        };
        picker.openEntryIconPicker(db.entry);

        await picker.pickIconFile();

        expect(db.meta.customIcons.size).toBe(1);
        expect(db.entry.customIcon.id).toBe(existingId);
    });

    test('refuses a file that is too large before reading it', async () => {
        const commands = [];
        invokeHandler = async (cmd) => {
            commands.push(cmd);
            if (cmd === 'pick_attachment_file') {
                return {
                    path: '/tmp/photo.png',
                    fileName: 'photo.png',
                    size: MAX_ICON_FILE_SIZE + 1,
                };
            }
            return null;
        };
        picker.openEntryIconPicker(db.entry);

        await picker.pickIconFile();

        // The size comes back with the pick precisely so the bytes are never
        // read: an icon is embedded in the vault and re-encrypted on each save.
        expect(commands).toEqual(['pick_attachment_file']);
        expect(picker.iconPickerError.value).toContain('under 256 KB');
        expect(db.meta.customIcons.size).toBe(0);
        expect(picker.showIconPicker.value).toBe(true);
    });

    test('refuses a file whose bytes are not an image', async () => {
        invokeHandler = async (cmd) => {
            if (cmd === 'pick_attachment_file') {
                return {
                    path: '/tmp/notes.txt',
                    fileName: 'notes.txt',
                    size: 5,
                };
            }
            if (cmd === 'read_database') {
                return new TextEncoder().encode('hello');
            }
            return null;
        };
        picker.openEntryIconPicker(db.entry);

        await picker.pickIconFile();

        expect(picker.iconPickerError.value).toContain('not a supported image');
        expect(db.meta.customIcons.size).toBe(0);
        expect(db.entry.customIcon).toBeUndefined();
    });

    test('applies nothing when the database locks during the pick', async () => {
        invokeHandler = async (cmd) => {
            if (cmd === 'pick_attachment_file') {
                // Auto-lock lands while the native dialog is on screen.
                store.db = null;
                return {
                    path: '/tmp/logo.png',
                    fileName: 'logo.png',
                    size: 11,
                };
            }
            if (cmd === 'read_database') return new Uint8Array(PNG);
            return null;
        };
        picker.openEntryIconPicker(db.entry);

        await picker.pickIconFile();

        expect(db.meta.customIcons.size).toBe(0);
        expect(db.entry.customIcon).toBeUndefined();
        expect(actions.saveDatabaseChanges).not.toHaveBeenCalled();
    });

    test('offers the favicon download only for an entry with a URL', async () => {
        picker.openGroupIconPicker('group-1');
        expect(picker.canDownloadFavicon.value).toBe(false);

        picker.openEntryIconPicker(db.entry);
        expect(picker.canDownloadFavicon.value).toBe(true);

        // Sending a domain to a third party is opt-out everywhere else too.
        store.downloadSiteIcons = false;
        expect(picker.canDownloadFavicon.value).toBe(false);
        store.downloadSiteIcons = true;

        db.entry.fields.set('URL', '');
        store.touchDb();
        expect(picker.canDownloadFavicon.value).toBe(false);
    });

    test('reports a favicon that could not be downloaded, and closes on success', async () => {
        downloadIcon = mock(async () => false);
        picker.openEntryIconPicker(db.entry);

        await picker.downloadFavicon();
        expect(picker.iconPickerError.value).toContain('No icon');
        expect(picker.showIconPicker.value).toBe(true);

        downloadIcon.mockImplementation(async () => true);
        await picker.downloadFavicon();
        expect(picker.showIconPicker.value).toBe(false);
    });
});
