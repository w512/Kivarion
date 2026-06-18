import {
    afterEach,
    beforeEach,
    describe,
    expect,
    mock,
    spyOn,
    test,
} from 'bun:test';
import { reactive } from 'vue';
import * as kdbxweb from 'kdbxweb';

globalThis.__KIVARION_ICON_DEBOUNCE_MS__ = 0;

let currentStore;
let fetchMock;
let consoleErrorSpy;

mock.module('../src/store.js', () => ({
    useStore: () => currentStore,
}));

mock.module('@tauri-apps/plugin-http', () => ({
    fetch: (...args) => fetchMock(...args),
}));

const { useEntryIcons } = await import('../src/composables/useEntryIcons.js');

function response({
    ok = true,
    status = 200,
    type = 'image/png',
    length,
    bytes = [1, 2, 3],
} = {}) {
    const data = new Uint8Array(bytes).buffer;
    return {
        ok,
        status,
        headers: {
            get(name) {
                const key = name.toLowerCase();
                if (key === 'content-type') return type;
                if (key === 'content-length')
                    return length ?? String(data.byteLength);
                return null;
            },
        },
        arrayBuffer: async () => data,
    };
}

function makeEntry(url = 'https://example.com') {
    return {
        uuid: kdbxweb.KdbxUuid.random(),
        fields: new Map([['URL', url]]),
        times: { update: mock(() => {}) },
    };
}

function makeStore(entries) {
    const root = { entries, groups: [] };
    currentStore = reactive({
        db: {
            meta: { customIcons: new Map() },
            getDefaultGroup: () => root,
        },
    });
    return currentStore;
}

async function tick() {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
}

beforeEach(() => {
    fetchMock = mock(async () => response());
    currentStore = null;
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    consoleErrorSpy?.mockRestore();
});

describe('useEntryIcons', () => {
    test('fetches png icons, assigns a custom icon and emits an update', async () => {
        const entry = makeEntry();
        const store = makeStore([entry]);
        const emit = mock(() => {});

        const { downloadIcon } = useEntryIcons(emit);
        const changed = await downloadIcon(entry);
        await tick();

        expect(changed).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(entry.customIcon).toBeTruthy();
        expect(store.db.meta.customIcons.size).toBe(1);
        expect(entry.times.update).toHaveBeenCalledTimes(1);
        expect(emit).toHaveBeenCalledWith('updated');
    });

    test('rejects non-image/png responses without mutating the entry', async () => {
        fetchMock = mock(async () =>
            response({ type: 'text/html', bytes: [60, 33] }),
        );
        const entry = makeEntry('https://bad.example');
        const store = makeStore([entry]);
        const emit = mock(() => {});

        const { downloadIcon } = useEntryIcons(emit);
        const changed = await downloadIcon(entry);
        await tick();

        expect(changed).toBe(false);
        expect(entry.customIcon).toBeUndefined();
        expect(store.db.meta.customIcons.size).toBe(0);
        expect(emit).not.toHaveBeenCalled();
    });

    test('does not emit or add a new icon when fetched bytes are unchanged', async () => {
        const entry = makeEntry('https://same.example');
        const store = makeStore([entry]);
        const icon = kdbxweb.KdbxUuid.random();
        store.db.meta.customIcons.set(icon.id, {
            data: new Uint8Array([1, 2, 3]).buffer,
        });
        entry.customIcon = icon;
        const emit = mock(() => {});

        const { downloadIcon } = useEntryIcons(emit);
        const changed = await downloadIcon(entry);
        await tick();

        expect(changed).toBe(false);
        expect(store.db.meta.customIcons.size).toBe(1);
        expect(entry.customIcon.id).toBe(icon.id);
        expect(emit).not.toHaveBeenCalled();
    });

    test('removes the previous custom icon when it becomes unused', async () => {
        fetchMock = mock(async () => response({ bytes: [9, 8, 7] }));
        const entry = makeEntry('https://replace.example');
        const store = makeStore([entry]);
        const oldIcon = kdbxweb.KdbxUuid.random();
        store.db.meta.customIcons.set(oldIcon.id, {
            data: new Uint8Array([1, 1, 1]).buffer,
        });
        entry.customIcon = oldIcon;

        const { downloadIcon } = useEntryIcons(mock(() => {}));
        const changed = await downloadIcon(entry);
        await tick();

        expect(changed).toBe(true);
        expect(store.db.meta.customIcons.has(oldIcon.id)).toBe(false);
        expect(store.db.meta.customIcons.size).toBe(1);
    });

    test('keeps the previous custom icon when another entry still uses it', async () => {
        fetchMock = mock(async () => response({ bytes: [7, 7, 7] }));
        const entry = makeEntry('https://shared.example');
        const otherEntry = makeEntry('https://other.example');
        const store = makeStore([entry, otherEntry]);
        const oldIcon = kdbxweb.KdbxUuid.random();
        store.db.meta.customIcons.set(oldIcon.id, {
            data: new Uint8Array([1, 1, 1]).buffer,
        });
        entry.customIcon = oldIcon;
        otherEntry.customIcon = oldIcon;

        const { downloadIcon } = useEntryIcons(mock(() => {}));
        const changed = await downloadIcon(entry);
        await tick();

        expect(changed).toBe(true);
        expect(store.db.meta.customIcons.has(oldIcon.id)).toBe(true);
        expect(store.db.meta.customIcons.size).toBe(2);
    });

    test('coalesces concurrent fetches for the same domain', async () => {
        let resolveFetch;
        fetchMock = mock(
            () =>
                new Promise((resolve) => {
                    resolveFetch = () =>
                        resolve(response({ bytes: [4, 5, 6] }));
                }),
        );
        const entryA = makeEntry('https://cache.example/a');
        const entryB = makeEntry('https://cache.example/b');
        makeStore([entryA, entryB]);
        const { downloadIcon } = useEntryIcons(mock(() => {}));

        const first = downloadIcon(entryA);
        const second = downloadIcon(entryB);
        await tick();
        resolveFetch();

        expect(await first).toBe(true);
        expect(await second).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
