import { beforeEach, describe, expect, test } from 'bun:test';
import {
    installDomGlobals,
    loadVueComponent,
    mount,
    textContent,
} from './helpers/vueSfc.js';

// The component exists to colour a revealed password by character class. What
// must never change while doing that is the text itself: the spans carry no
// separators, so selecting the password on screen and copying it by hand still
// yields the password.

let ColoredPassword;

function runs(root) {
    const found = [];
    const walk = (node) => {
        const className = node.props?.class;
        if (typeof className === 'string' && className.startsWith('run-')) {
            found.push({ kind: className.slice(4), text: textContent(node) });
        }
        for (const child of node.children || []) walk(child);
    };
    walk(root);
    return found;
}

beforeEach(() => {
    installDomGlobals();
});

describe('ColoredPassword', () => {
    test('renders the password unchanged', async () => {
        ColoredPassword ||= await loadVueComponent(
            'src/components/entry-detail/ColoredPassword.vue',
        );

        for (const value of [
            '',
            'correct horse 42!',
            'Ab1!',
            'Пароль-7',
            // Leading, doubled and trailing spaces: `textContent` keeps them,
            // so an extra separator between two spans would show up here.
            '  two  spaces  ',
        ]) {
            const { root } = mount(ColoredPassword, () => ({ value }));
            expect(textContent(root)).toBe(value);
        }
    });

    test('paints one span per character class', async () => {
        ColoredPassword ||= await loadVueComponent(
            'src/components/entry-detail/ColoredPassword.vue',
        );

        const { root } = mount(ColoredPassword, () => ({ value: 'Ab12!!cd' }));

        expect(runs(root)).toEqual([
            { kind: 'letter', text: 'Ab' },
            { kind: 'digit', text: '12' },
            { kind: 'symbol', text: '!!' },
            { kind: 'letter', text: 'cd' },
        ]);
    });

    test('renders nothing for an empty password', async () => {
        ColoredPassword ||= await loadVueComponent(
            'src/components/entry-detail/ColoredPassword.vue',
        );

        const { root } = mount(ColoredPassword, () => ({ value: '' }));

        expect(runs(root)).toEqual([]);
    });
});
