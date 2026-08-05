import { beforeEach, describe, expect, test } from 'bun:test';
import {
    isAnyModalOpen,
    registerOpenModal,
    resetModalState,
    unregisterOpenModal,
} from '../src/modalState.js';

describe('modalState', () => {
    beforeEach(() => {
        resetModalState();
    });

    test('reports nothing open until a modal registers', () => {
        expect(isAnyModalOpen()).toBe(false);

        registerOpenModal();
        expect(isAnyModalOpen()).toBe(true);

        unregisterOpenModal();
        expect(isAnyModalOpen()).toBe(false);
    });

    test('stays open while a second modal is stacked on the first', () => {
        // A confirmation raised from inside another dialog: closing the top one
        // must not report the page as interactive again while the one
        // underneath is still up.
        registerOpenModal();
        registerOpenModal();

        unregisterOpenModal();
        expect(isAnyModalOpen()).toBe(true);

        unregisterOpenModal();
        expect(isAnyModalOpen()).toBe(false);
    });

    test('does not go negative on an unbalanced unregister', () => {
        // A count driven below zero would need an extra open just to read as
        // "a modal is showing" again, silently disabling every guard that asks.
        unregisterOpenModal();
        unregisterOpenModal();
        expect(isAnyModalOpen()).toBe(false);

        registerOpenModal();
        expect(isAnyModalOpen()).toBe(true);
    });
});
