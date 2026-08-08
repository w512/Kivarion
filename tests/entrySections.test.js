import { beforeEach, describe, expect, test } from 'bun:test';
import { nextTick, reactive } from 'vue';
import {
    allText,
    findFirst,
    installDomGlobals,
    loadVueComponent,
    mount,
} from './helpers/vueSfc.js';

beforeEach(() => {
    installDomGlobals();
});

function byClass(root, className) {
    return findFirst(root, (node) =>
        String(node.props?.class || '').includes(className),
    );
}

function buttonWithText(root, text) {
    return findFirst(
        root,
        (node) => node.type === 'button' && allText(node).trim() === text,
    );
}

describe('collapsible entry sections', () => {
    test('History starts collapsed and previews only changed values', async () => {
        const EntryHistory = await loadVueComponent(
            'src/components/entry-detail/EntryHistory.vue',
        );
        const secret = (text) => ({ getText: () => text });
        const historical = {
            fields: new Map([
                ['Title', 'Account'],
                ['UserName', 'old-user'],
                ['Password', secret('old-password')],
            ]),
            binaries: new Map(),
            times: { lastModTime: new Date('2026-08-01T10:00:00Z') },
        };
        const entry = {
            fields: new Map([
                ['Title', 'Account'],
                ['UserName', 'new-user'],
                ['Password', secret('new-password')],
            ]),
            binaries: new Map(),
            history: [historical],
        };
        const restored = [];
        const { root } = mount(EntryHistory, () => ({
            entry,
            refreshKey: 0,
            onRestore: (index) => restored.push(index),
        }));
        await nextTick();

        const toggle = byClass(root, 'section-header');
        expect(toggle.props['aria-expanded']).toBe(false);
        expect(byClass(root, 'history-list')).toBeNull();

        toggle.props.onClick();
        await nextTick();
        expect(toggle.props['aria-expanded']).toBe(true);

        buttonWithText(root, 'Preview').props.onClick();
        await nextTick();

        const previewText = allText(byClass(root, 'history-preview'));
        expect(previewText).toContain('old-user');
        expect(previewText).toContain('new-user');
        expect(previewText).toContain('••••••••');
        expect(previewText).not.toContain('old-password');
        expect(previewText).not.toContain('new-password');
        // An unchanged title is intentionally absent from the diff.
        expect(previewText).not.toContain('Account');

        buttonWithText(root, 'Restore').props.onClick();
        expect(restored).toEqual([0]);
    });

    test('Metadata starts collapsed and closes for another entry', async () => {
        const EntryMetadata = await loadVueComponent(
            'src/components/entry-detail/EntryMetadata.vue',
        );
        const state = reactive({
            entry: {
                uuid: { id: 'entry-one' },
                times: {},
            },
        });
        const { root } = mount(EntryMetadata, () => ({ entry: state.entry }));
        await nextTick();

        const toggle = byClass(root, 'section-header');
        expect(toggle.props['aria-expanded']).toBe(false);
        expect(byClass(root, 'metadata-grid')).toBeNull();

        toggle.props.onClick();
        await nextTick();
        expect(allText(byClass(root, 'metadata-grid'))).toContain('entry-one');

        state.entry = { uuid: { id: 'entry-two' }, times: {} };
        await nextTick();
        expect(toggle.props['aria-expanded']).toBe(false);
        expect(byClass(root, 'metadata-grid')).toBeNull();
    });

    test('Attachments starts collapsed, opens for Add, and resets on entry change', async () => {
        const EntryAttachments = await loadVueComponent(
            'src/components/entry-detail/EntryAttachments.vue',
        );
        const state = reactive({ entryId: 'entry-one' });
        let addCalls = 0;
        const { root, unmount } = mount(EntryAttachments, () => ({
            entryId: state.entryId,
            attachments: [],
            thumbnails: new Map(),
            totalSize: 0,
            adding: false,
            error: '',
            onAdd: () => addCalls++,
        }));
        await nextTick();

        const toggle = byClass(root, 'section-toggle');
        expect(toggle.props['aria-expanded']).toBe(false);
        expect(byClass(root, 'attachments-content')).toBeNull();

        byClass(root, 'add-attachment-btn').props.onClick();
        await nextTick();
        expect(addCalls).toBe(1);
        expect(toggle.props['aria-expanded']).toBe(true);
        expect(allText(byClass(root, 'attachments-content'))).toContain(
            'No attachments',
        );

        state.entryId = 'entry-two';
        await nextTick();
        expect(toggle.props['aria-expanded']).toBe(false);
        expect(byClass(root, 'attachments-content')).toBeNull();

        unmount();
    });
});
