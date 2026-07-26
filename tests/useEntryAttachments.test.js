import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { createRenderer, reactive, ref } from 'vue';

// The add flow talks to the backend (native picker + byte read) and to the
// store, so those are mocked; everything else runs for real. `mock.module` is
// process-global in Bun, which is why only these three modules are replaced.
let currentStore;
let invokeCalls;
let pickedFile;

mock.module('../src/store.js', () => ({ useStore: () => currentStore }));
mock.module('../src/composables/useClipboard.js', () => ({
    useClipboard: () => ({ copy: () => {} }),
}));
mock.module('@tauri-apps/api/core', () => ({
    invoke: async (command, args) => {
        invokeCalls.push(command);
        if (command === 'pick_attachment_file') return pickedFile;
        if (command === 'read_database') {
            return new Uint8Array(args.path.length).fill(7);
        }
        return null;
    },
}));

const {
    addEntryAttachment,
    deleteEntryAttachment,
    getAttachmentBytes,
    getUniqueAttachmentName,
    renameEntryAttachment,
    validateAttachmentName,
    LARGE_ATTACHMENT_SIZE,
    useEntryAttachments,
} = await import('../src/composables/useEntryAttachments.js');

// setTimeout(0) drains the microtask queue, so every await inside the add flow
// has run by the time it resolves.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeEntry() {
    const snapshots = [];
    const update = mock(() => {});
    const entry = {
        binaries: new Map([
            ['report.pdf', { hash: 'one', value: new Uint8Array([1]) }],
            ['photo.png', { hash: 'two', value: new Uint8Array([2]) }],
        ]),
        pushHistory: mock(() => snapshots.push([...entry.binaries.keys()])),
        times: { update },
    };
    return { entry, snapshots, update };
}

describe('entry attachment helpers', () => {
    test('reads runtime KDBX binary representations', () => {
        const buffer = new Uint8Array([1, 2, 3]).buffer;

        expect([...getAttachmentBytes(buffer)]).toEqual([1, 2, 3]);
        expect([
            ...getAttachmentBytes({ hash: 'hash', value: buffer }),
        ]).toEqual([1, 2, 3]);
        expect([
            ...getAttachmentBytes({
                value: new Uint8Array([9, 9, 9]),
                getBinary: () => buffer,
            }),
        ]).toEqual([1, 2, 3]);
    });

    test('validates names and generates a non-destructive duplicate name', () => {
        expect(validateAttachmentName('')).toBe(
            'Attachment name cannot be empty.',
        );
        expect(validateAttachmentName('../secret')).toContain('slashes');
        expect(validateAttachmentName('REPORT.PDF', ['report.pdf'])).toContain(
            'already exists',
        );
        expect(
            getUniqueAttachmentName('report.pdf', [
                'report.pdf',
                'report (2).pdf',
            ]),
        ).toBe('report (3).pdf');
    });

    test('adds an attachment under a unique name with history', () => {
        const { entry, snapshots, update } = makeEntry();
        const binary = { hash: 'three', value: new Uint8Array([3]) };

        const result = addEntryAttachment(entry, 'report.pdf', binary);

        expect(result).toEqual({ ok: true, name: 'report (2).pdf' });
        expect(entry.binaries.get('report (2).pdf')).toBe(binary);
        expect(snapshots).toEqual([['report.pdf', 'photo.png']]);
        expect(update).toHaveBeenCalledTimes(1);
    });

    test('renames an attachment with history and timestamp updates', () => {
        const { entry, snapshots, update } = makeEntry();
        const binary = entry.binaries.get('report.pdf');

        const result = renameEntryAttachment(
            entry,
            'report.pdf',
            'summary.pdf',
        );

        expect(result).toEqual({
            ok: true,
            changed: true,
            name: 'summary.pdf',
        });
        expect(entry.binaries.has('report.pdf')).toBe(false);
        expect(entry.binaries.get('summary.pdf')).toBe(binary);
        expect(snapshots).toEqual([['report.pdf', 'photo.png']]);
        expect(update).toHaveBeenCalledTimes(1);
    });

    test('refuses a rename collision without mutating history', () => {
        const { entry } = makeEntry();

        const result = renameEntryAttachment(entry, 'report.pdf', 'photo.png');

        expect(result.ok).toBe(false);
        expect(result.error).toContain('already exists');
        expect(entry.pushHistory).not.toHaveBeenCalled();
    });

    test('deletes an attachment with a restorable history snapshot', () => {
        const { entry, snapshots, update } = makeEntry();

        expect(deleteEntryAttachment(entry, 'photo.png')).toBe(true);
        expect(entry.binaries.has('photo.png')).toBe(false);
        expect(snapshots).toEqual([['report.pdf', 'photo.png']]);
        expect(update).toHaveBeenCalledTimes(1);
    });
});

// The composable registers `onUnmounted`, so it is exercised inside a real (if
// headless) component instance rather than called bare.
const renderer = createRenderer({
    patchProp() {},
    insert() {},
    remove() {},
    createElement(type) {
        return { type };
    },
    createText(text) {
        return { text };
    },
    createComment(text) {
        return { comment: text };
    },
    setText(node, text) {
        node.text = text;
    },
    setElementText(node, text) {
        node.text = text;
    },
    parentNode() {
        return null;
    },
    nextSibling() {
        return null;
    },
});

describe('adding an attachment', () => {
    let entryRef;
    let emitted;

    function startAdd() {
        let api;
        const app = renderer.createApp({
            setup() {
                api = useEntryAttachments(entryRef, ref(false), (event) =>
                    emitted.push(event),
                );
                return () => null;
            },
        });
        app.mount({});
        return { api, done: api.addAttachment() };
    }

    beforeEach(() => {
        invokeCalls = [];
        emitted = [];
        currentStore = reactive({
            dbVersion: 0,
            db: {
                createBinary: async (data) => ({ hash: 'new', value: data }),
            },
        });
        entryRef = ref(makeEntry().entry);
        pickedFile = {
            path: '/tmp/huge.bin',
            fileName: 'huge.bin',
            size: LARGE_ATTACHMENT_SIZE + 1,
        };
    });

    test('adds a small file without asking anything', async () => {
        pickedFile.size = 1024;
        const { api, done } = startAdd();
        await done;

        expect(api.pendingLargeAttachment.value).toBeNull();
        expect(entryRef.value.binaries.has('huge.bin')).toBe(true);
        expect(emitted).toEqual(['updated']);
        expect(api.totalAttachmentsSize.value).toBe(2 + '/tmp/huge.bin'.length);
    });

    test('does not read a large file until the size warning is accepted', async () => {
        const { api, done } = startAdd();
        await flush();

        expect(api.pendingLargeAttachment.value).toEqual({
            name: 'huge.bin',
            size: LARGE_ATTACHMENT_SIZE + 1,
        });
        expect(invokeCalls).toEqual(['pick_attachment_file']);

        api.cancelLargeAttachment();
        await done;

        expect(invokeCalls).toEqual(['pick_attachment_file']);
        expect(entryRef.value.binaries.has('huge.bin')).toBe(false);
        expect(entryRef.value.pushHistory).not.toHaveBeenCalled();
        expect(emitted).toEqual([]);
        expect(api.isAddingAttachment.value).toBe(false);
    });

    test('adds the large file once the warning is confirmed', async () => {
        const { api, done } = startAdd();
        await flush();
        api.confirmLargeAttachment();
        await done;

        expect(invokeCalls).toEqual(['pick_attachment_file', 'read_database']);
        expect(api.pendingLargeAttachment.value).toBeNull();
        expect(entryRef.value.binaries.has('huge.bin')).toBe(true);
        expect(emitted).toEqual(['updated']);
    });

    test('answers a pending warning when the database locks', async () => {
        const { api, done } = startAdd();
        await flush();

        // Auto-lock nulls store.db while the modal is open; the promise must
        // not stay unresolved and nothing may be written to the old entry.
        currentStore.db = null;
        await done;

        expect(api.pendingLargeAttachment.value).toBeNull();
        expect(invokeCalls).toEqual(['pick_attachment_file']);
        expect(entryRef.value.binaries.has('huge.bin')).toBe(false);
        expect(api.isAddingAttachment.value).toBe(false);
    });
});
