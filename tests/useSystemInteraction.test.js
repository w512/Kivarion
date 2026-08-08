import { describe, expect, test } from 'bun:test';
import {
    isSystemInteractionActive,
    withSystemInteraction,
} from '../src/composables/useSystemInteraction.js';

// The counter these two share is what keeps "lock on focus loss" from firing
// while a native dialog, Touch ID or Quick Look holds the window's focus. A
// count that leaks upward would suppress focus-loss locking for the rest of
// the session — silently, since everything else keeps working.

describe('withSystemInteraction', () => {
    test('is active exactly while the wrapped call runs', async () => {
        expect(isSystemInteractionActive()).toBe(false);

        let activeDuring = null;
        const result = await withSystemInteraction(async () => {
            activeDuring = isSystemInteractionActive();
            return 'picked-file';
        });

        expect(activeDuring).toBe(true);
        // The wrapped call's result passes through untouched.
        expect(result).toBe('picked-file');
        expect(isSystemInteractionActive()).toBe(false);
    });

    test('releases the suppression even when the call throws', async () => {
        await expect(
            withSystemInteraction(() => {
                throw new Error('dialog cancelled');
            }),
        ).rejects.toThrow('dialog cancelled');
        expect(isSystemInteractionActive()).toBe(false);

        await expect(
            withSystemInteraction(() => Promise.reject(new Error('async'))),
        ).rejects.toThrow('async');
        expect(isSystemInteractionActive()).toBe(false);
    });

    test('stays active until the last overlapping interaction ends', async () => {
        let releaseOuter;
        const outer = withSystemInteraction(
            () => new Promise((resolve) => (releaseOuter = resolve)),
        );

        // A second interaction starts and finishes while the first is open;
        // its end must not clear the first one's suppression.
        await withSystemInteraction(async () => {
            expect(isSystemInteractionActive()).toBe(true);
        });
        expect(isSystemInteractionActive()).toBe(true);

        releaseOuter();
        await outer;
        expect(isSystemInteractionActive()).toBe(false);
    });
});
