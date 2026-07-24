import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createRenderer, nextTick } from 'vue';

let memory;
let api;
let documentListeners;
let originalWindow;

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

// A resizer element that records the pointer-capture calls made on it.
function makeDivider() {
    return {
        captured: [],
        released: [],
        setPointerCapture(id) {
            this.captured.push(id);
        },
        releasePointerCapture(id) {
            this.released.push(id);
        },
    };
}

function pointerDown(divider, { button = 0, pointerId = 7 } = {}) {
    return { button, pointerId, currentTarget: divider };
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

    documentListeners = {};
    globalThis.document = {
        addEventListener: mock((event, handler) => {
            documentListeners[event] = handler;
        }),
        removeEventListener: mock((event, handler) => {
            if (documentListeners[event] === handler) {
                delete documentListeners[event];
            }
        }),
    };

    // Restored afterwards: bun shares one process across test files, so a
    // stray global `window` would follow us into the next one.
    originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        writable: true,
        value: { innerWidth: 1400 },
    });
});

afterEach(() => {
    if (originalWindow) {
        Object.defineProperty(globalThis, 'window', originalWindow);
    } else {
        delete globalThis.window;
    }
});

describe('useResizable', () => {
    test('migrates legacy underscore localStorage width keys to kebab-case', () => {
        memory.kivarion_sidebarWidth = '333';

        const { api } = mountResizable([
            'kivarion-sidebar-width',
            220,
            {
                minWidth: 150,
                maxWidth: 600,
                legacyKeys: ['kivarion_sidebarWidth'],
            },
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
            {
                minWidth: 150,
                maxWidth: 600,
                legacyKeys: ['kivarion_sidebarWidth'],
            },
        ]);

        expect(api.width.value).toBe(280);
        expect(memory.kivarion_sidebarWidth).toBe('333');
    });

    test('clamps invalid persisted widths before saving', async () => {
        memory['kivarion-entries-width'] = '-5';

        const { api } = mountResizable([
            'kivarion-entries-width',
            300,
            { minWidth: 200, maxWidth: 800 },
        ]);

        expect(api.width.value).toBe(200);
        expect(memory['kivarion-entries-width']).toBe('200');

        api.width.value = 1200;
        await nextTick();

        expect(api.width.value).toBe(800);
        expect(memory['kivarion-entries-width']).toBe('800');
    });

    test('drops the document listeners when the component unmounts mid-drag', () => {
        const { api, unmount } = mountResizable([
            'kivarion-sidebar-width',
            220,
            { minWidth: 150, maxWidth: 600 },
        ]);
        const divider = makeDivider();

        api.startResize(pointerDown(divider));
        expect(Object.keys(documentListeners).sort()).toEqual([
            'pointercancel',
            'pointermove',
            'pointerup',
        ]);

        // Auto-lock unmounting the page during a drag must not leave the
        // listeners (or the capture) behind.
        unmount();

        expect(documentListeners).toEqual({});
        expect(divider.released).toEqual([7]);
        expect(api.isResizing.value).toBe(false);
    });

    test('captures the pointer so a release outside the window still ends the drag', () => {
        const { api } = mountResizable([
            'kivarion-sidebar-width',
            220,
            { minWidth: 150, maxWidth: 600 },
        ]);
        const divider = makeDivider();

        api.startResize(pointerDown(divider, { pointerId: 42 }));
        expect(divider.captured).toEqual([42]);
        expect(api.isResizing.value).toBe(true);

        documentListeners.pointerup();

        expect(api.isResizing.value).toBe(false);
        expect(divider.released).toEqual([42]);
        expect(documentListeners).toEqual({});
    });

    test('ignores a drag started with a non-primary button', () => {
        const { api } = mountResizable([
            'kivarion-sidebar-width',
            220,
            { minWidth: 150, maxWidth: 600 },
        ]);

        api.startResize(pointerDown(makeDivider(), { button: 2 }));

        expect(api.isResizing.value).toBe(false);
        expect(documentListeners).toEqual({});
    });

    test('clamps to the bound instead of ignoring an out-of-range pointer', () => {
        const { api } = mountResizable([
            'kivarion-sidebar-width',
            220,
            { minWidth: 150, maxWidth: 600 },
        ]);

        api.startResize(pointerDown(makeDivider()));

        documentListeners.pointermove({ clientX: 400 });
        expect(api.width.value).toBe(400);

        // Dragging past the limit used to leave the column at its last
        // in-range width, so it stopped following the pointer entirely.
        documentListeners.pointermove({ clientX: 20 });
        expect(api.width.value).toBe(150);

        documentListeners.pointermove({ clientX: 5000 });
        expect(api.width.value).toBe(600);
    });

    test('keeps room for the columns to the right in a narrow window', () => {
        globalThis.window.innerWidth = 700;

        const { api } = mountResizable([
            'kivarion-sidebar-width',
            220,
            { minWidth: 150, maxWidth: 600, reserve: 468 },
        ]);

        api.startResize(pointerDown(makeDivider()));
        documentListeners.pointermove({ clientX: 600 });

        // 700 - 468 = 232, well below the 600 the setting alone would allow.
        expect(api.width.value).toBe(232);
    });

    test('offsets the pointer position by the column to the left', () => {
        const sidebarWidth = { value: 220 };
        const { api } = mountResizable([
            'kivarion-entries-width',
            300,
            { minWidth: 200, maxWidth: 800, offsetSource: sidebarWidth },
        ]);

        api.startResize(pointerDown(makeDivider()));
        documentListeners.pointermove({ clientX: 620 });

        expect(api.width.value).toBe(400);
    });
});
