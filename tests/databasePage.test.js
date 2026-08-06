import { beforeEach, describe, expect, test } from 'bun:test';
import { nextTick, reactive } from 'vue';
import { makeFakeDatabase } from './helpers/fakeDatabase.js';
import {
    installDomGlobals,
    loadVueComponent,
    renderer,
} from './helpers/vueSfc.js';
import { resetDatabaseActions } from '../src/composables/useDatabaseActions.js';

// `DatabasePage` is now composition and little else: it builds the view model
// and hands it, plus one shared selection object, to the composables that hold
// the actual state. What is left to get wrong is the wiring, so this mounts the
// real page against stubbed children and checks that what each column is given
// follows what the user did — and that a forced lock takes everything down.

let store;
let db;
let rendered;

/** Records every mount of a stubbed child, with live `props` and `attrs`. */
function captureStub(name, props = []) {
    return {
        default: {
            name,
            props,
            inheritAttrs: false,
            setup(componentProps, { attrs }) {
                (rendered[name] ||= []).push({ props: componentProps, attrs });
                return () => null;
            },
        },
    };
}

const memory = new Map();

async function mountPage() {
    const stubs = {
        '../store.js': { useStore: () => store },
        'vue-router': {
            useRouter: () => ({ replace() {}, push: async () => {} }),
        },
        '@tauri-apps/api/path': { homeDir: async () => '/Users/tester' },
        '../composables/useClipboard.js': {
            useClipboard: () => ({ copy: () => {} }),
        },
        '../components/GroupTree.vue': captureStub('GroupTree', [
            'groups',
            'selectedGroupUuid',
            'allEntriesCount',
            'collapsedGroups',
        ]),
        '../components/EntryList.vue': captureStub('EntryList', [
            'entries',
            'selectedEntryUuid',
            'canRestore',
        ]),
        '../components/EntryDetail.vue': captureStub('EntryDetail', ['entry']),
        '../components/DatabaseHeader.vue': captureStub('DatabaseHeader', [
            'dbName',
            'filePath',
            'search',
        ]),
        '../components/ConfirmModal.vue': captureStub('ConfirmModal', [
            'show',
            'title',
            'message',
        ]),
        '../components/InputModal.vue': captureStub('InputModal', [
            'show',
            'title',
            'modelValue',
        ]),
        '../components/DatabaseSettingsModal.vue': captureStub(
            'DatabaseSettingsModal',
            ['show', 'dbName', 'keyFilePath', 'busy', 'error'],
        ),
    };

    const component = await loadVueComponent(
        'src/pages/DatabasePage.vue',
        stubs,
    );
    const root = { type: 'root', props: {}, children: [] };
    renderer.createApp(component).mount(root);
    return root;
}

const last = (name) => rendered[name]?.at(-1);
const confirmModalTitled = (fragment) =>
    rendered.ConfirmModal.find((modal) =>
        modal.props.title?.includes(fragment),
    );

beforeEach(() => {
    installDomGlobals();
    // The key-file association is read from the backend as the page mounts.
    window.__TAURI_INTERNALS__ = { invoke: async () => null };
    memory.clear();
    globalThis.localStorage = {
        getItem: (key) => (memory.has(key) ? memory.get(key) : null),
        setItem: (key, value) => memory.set(key, String(value)),
        removeItem: (key) => memory.delete(key),
        get length() {
            return memory.size;
        },
        key: (index) => [...memory.keys()][index] ?? null,
    };

    // The save state is a module-level singleton that outlives any one page.
    resetDatabaseActions();
    rendered = {};
    db = makeFakeDatabase();
    store = reactive({
        db,
        dbVersion: 0,
        filePath: '/tmp/test.kdbx',
        selectedGroupUuid: null,
        knownMtime: null,
        touchDb() {
            store.dbVersion++;
        },
    });
});

describe('DatabasePage', () => {
    test('opens on the root group with the tree and its entries', async () => {
        await mountPage();

        expect(store.selectedGroupUuid).toBe('root');
        expect(last('DatabaseHeader').props.dbName).toBe('Test Vault');
        expect(last('GroupTree').props.groups[0].name).toBe('Root');
        // The bin is excluded from the count, and from "All Entries".
        expect(last('GroupTree').props.allEntriesCount).toBe(2);
        expect(last('EntryList').props.entries.map((row) => row.title)).toEqual(
            ['Root Entry'],
        );
        // Nothing selected yet, so there is no detail column.
        expect(rendered.EntryDetail).toBe(undefined);
    });

    test('selecting a group and an entry moves both columns', async () => {
        await mountPage();

        last('GroupTree').attrs.onSelect('child');
        await nextTick();
        expect(last('EntryList').props.entries.map((row) => row.title)).toEqual(
            ['Child Entry'],
        );

        last('EntryList').attrs.onSelect('entry-child');
        await nextTick();
        expect(last('EntryDetail').props.entry).toBe(db.childEntry);
    });

    test('the entry list offers Restore only inside the Recycle Bin', async () => {
        await mountPage();

        expect(last('EntryList').props.canRestore).toBe(false);

        last('GroupTree').attrs.onSelect('recycle');
        await nextTick();
        expect(last('EntryList').props.canRestore).toBe(true);
    });

    test('deleting the open entry raises the confirmation for it', async () => {
        await mountPage();

        last('GroupTree').attrs.onSelect('child');
        await nextTick();
        last('EntryList').attrs.onSelect('entry-child');
        await nextTick();
        last('EntryDetail').attrs.onDelete();
        await nextTick();

        const confirm = confirmModalTitled('entry');
        expect(confirm.props.show).toBe(true);
        expect(confirm.props.message).toContain('“Child Entry”');
        expect(confirm.props.message).toContain('Recycle Bin');
    });

    test('a forced lock closes every dialog and drops the selection', async () => {
        await mountPage();

        last('GroupTree').attrs.onSelect('child');
        await nextTick();
        last('EntryList').attrs.onSelect('entry-child');
        await nextTick();
        last('EntryDetail').attrs.onDelete();
        last('GroupTree').attrs.onRenameGroup('child');
        await nextTick();
        expect(confirmModalTitled('entry').props.show).toBe(true);
        expect(last('InputModal').props.show).toBe(true);

        // What `useAutoLock` dispatches while the database is still open. The
        // page's handler has to reach into every composable it split into.
        window.dispatchEvent(new Event('kivarion:before-lock'));
        await nextTick();

        expect(confirmModalTitled('entry').props.show).toBe(false);
        expect(last('InputModal').props.show).toBe(false);
        expect(last('DatabaseSettingsModal').props.show).toBe(false);
        expect(last('EntryList').props.selectedEntryUuid).toBe(null);
    });
});
