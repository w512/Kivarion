import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { createRenderer, nextTick } from 'vue';

let memory;
let api;

const { useResizable } = await import('../src/composables/useResizable.js');

const renderer = createRenderer({
    patchProp() {},
    insert(child, parent) {
        parent.children ||= [];
        parent.children.push(child);
    },
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

function mountResizable(args) {
    api = null;
    const app = renderer.createApp({
        setup() {
            api = useResizable(...args);
            return () => null;
        },
    });
    app.mount({});
    return { api, unmount: () => app.unmount() };
}

beforeEach(() => {
    memory = {};
    globalThis.localStorage = {
        getItem: mock((key) => (key in memory ? memory[key] : null)),
        setItem: mock((key, value) => {
            memory[key] = String(value);
        }),
        removeItem: mock((key) => {
            delete memory[key];
        }),
    };

    globalThis.document = {
        addEventListener: mock(() => {}),
        removeEventListener: mock(() => {}),
    };
});

describe('useResizable', () => {
    test('migrates legacy underscore localStorage width keys to kebab-case', () => {
        memory.kivarion_sidebarWidth = '333';

        const { api } = mountResizable([
            'kivarion-sidebar-width',
            220,
            150,
            600,
            null,
            ['kivarion_sidebarWidth'],
        ]);

        expect(api.width.value).toBe(333);
        expect(memory['kivarion-sidebar-width']).toBe('333');
        expect(memory.kivarion_sidebarWidth).toBeUndefined();
    });

    test('prefers the new key over a legacy key', () => {
        memory['kivarion-sidebar-width'] = '280';
        memory.kivarion_sidebarWidth = '333';

        const { api } = mountResizable([
            'kivarion-sidebar-width',
            220,
            150,
            600,
            null,
            ['kivarion_sidebarWidth'],
        ]);

        expect(api.width.value).toBe(280);
        expect(memory.kivarion_sidebarWidth).toBe('333');
    });

    test('clamps invalid persisted widths before saving', async () => {
        memory['kivarion-entries-width'] = '-5';

        const { api } = mountResizable([
            'kivarion-entries-width',
            300,
            200,
            800,
        ]);

        expect(api.width.value).toBe(200);
        expect(memory['kivarion-entries-width']).toBe('200');

        api.width.value = 1200;
        await nextTick();

        expect(api.width.value).toBe(800);
        expect(memory['kivarion-entries-width']).toBe('800');
    });
});
