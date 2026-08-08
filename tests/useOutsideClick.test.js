import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { ref } from 'vue';
import { renderer } from './helpers/vueSfc.js';
import { useOutsideClick } from '../src/composables/useOutsideClick.js';

// No DOM in bun:test, so `document` is a recording fake: the composable only
// needs add/removeEventListener, and the tests dispatch by calling the
// captured listeners themselves. Elements are plain objects with `contains`.

let clickListeners;
const originalDocument = globalThis.document;

function makeElement(descendants = []) {
    const el = {
        contains: (target) => target === el || descendants.includes(target),
    };
    return el;
}

function click(target) {
    const event = { target };
    for (const listener of [...clickListeners]) listener(event);
    return event;
}

/** Mount a throwaway component whose setup registers the composable. */
function mountWith(elementRef, handler) {
    const app = renderer.createApp({
        setup() {
            useOutsideClick(elementRef, handler);
            return () => null;
        },
    });
    app.mount({});
    return app;
}

beforeEach(() => {
    clickListeners = new Set();
    globalThis.document = {
        addEventListener: (type, listener) => {
            if (type === 'click') clickListeners.add(listener);
        },
        removeEventListener: (type, listener) => {
            if (type === 'click') clickListeners.delete(listener);
        },
    };
});

afterEach(() => {
    globalThis.document = originalDocument;
});

describe('useOutsideClick', () => {
    test('fires for a click outside, not for the element or a descendant', () => {
        const inside = {};
        const boundary = makeElement([inside]);
        const handler = mock(() => {});
        mountWith(ref(boundary), handler);

        click(boundary);
        click(inside);
        expect(handler).toHaveBeenCalledTimes(0);

        const outside = {};
        click(outside);
        expect(handler).toHaveBeenCalledTimes(1);
        // The originating event is passed through.
        expect(handler.mock.calls[0][0].target).toBe(outside);
    });

    test('accepts a raw element as well as a ref', () => {
        const boundary = makeElement();
        const handler = mock(() => {});
        mountWith(boundary, handler);

        click(boundary);
        expect(handler).toHaveBeenCalledTimes(0);
        click({});
        expect(handler).toHaveBeenCalledTimes(1);
    });

    test('does nothing while the template ref is still empty', () => {
        const handler = mock(() => {});
        mountWith(ref(null), handler);

        click({});
        expect(handler).toHaveBeenCalledTimes(0);
    });

    test('removes its document listener on unmount', () => {
        const handler = mock(() => {});
        const app = mountWith(ref(makeElement()), handler);
        expect(clickListeners.size).toBe(1);

        app.unmount();

        // Auto-lock can unmount the owner mid-session; a leaked listener would
        // keep calling a handler whose component is gone.
        expect(clickListeners.size).toBe(0);
        click({});
        expect(handler).toHaveBeenCalledTimes(0);
    });
});
