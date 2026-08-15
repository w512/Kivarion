import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
    clearToasts,
    dismissToast,
    pauseToast,
    resetToasts,
    resumeToast,
    showErrorToast,
    toasts,
    TOAST_TIMEOUT,
} from '../src/toast.js';

let now;
let scheduled;
let realSetTimeout;
let realClearTimeout;

/** Timers under test: run them by hand rather than waiting six seconds. */
function installFakeTimers() {
    now = 0;
    scheduled = new Map();
    let nextTimerId = 1;

    realSetTimeout = globalThis.setTimeout;
    realClearTimeout = globalThis.clearTimeout;
    globalThis.setTimeout = (fn, delay) => {
        const id = nextTimerId++;
        scheduled.set(id, { fn, at: now + (delay || 0) });
        return id;
    };
    globalThis.clearTimeout = (id) => scheduled.delete(id);
}

function advance(ms) {
    now += ms;
    for (const [id, timer] of [...scheduled]) {
        if (timer.at > now) continue;
        scheduled.delete(id);
        timer.fn();
    }
}

function messages() {
    return toasts.value.map((toast) => toast.message);
}

beforeEach(() => {
    installFakeTimers();
    resetToasts();
});

afterEach(() => {
    clearToasts();
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
});

describe('toast', () => {
    test('shows a message and drops it once the timeout passes', () => {
        showErrorToast('Could not add this attachment.');
        expect(messages()).toEqual(['Could not add this attachment.']);

        advance(TOAST_TIMEOUT - 1);
        expect(messages()).toHaveLength(1);

        advance(1);
        expect(messages()).toEqual([]);
    });

    test('ignores an empty message', () => {
        showErrorToast('');
        showErrorToast(null);
        showErrorToast('   ');
        expect(messages()).toEqual([]);
    });

    test('repeats of one complaint restart the timer instead of stacking', () => {
        // Pressing Save twice on the same invalid form is one problem, not two.
        showErrorToast('Custom field “ApiKey” is duplicated.');
        advance(TOAST_TIMEOUT - 100);
        showErrorToast('Custom field “ApiKey” is duplicated.');

        expect(messages()).toHaveLength(1);
        advance(200);
        expect(messages()).toHaveLength(1);

        advance(TOAST_TIMEOUT);
        expect(messages()).toEqual([]);
    });

    test('keeps the stack short by dropping the oldest message', () => {
        for (const message of ['one', 'two', 'three', 'four', 'five']) {
            showErrorToast(message);
        }
        expect(messages()).toEqual(['two', 'three', 'four', 'five']);
    });

    test('dismissing early cancels the message its timer would have removed', () => {
        const first = showErrorToast('first');
        showErrorToast('second');

        dismissToast(first);
        expect(messages()).toEqual(['second']);

        // The dismissed toast's timer must not survive to take another one out.
        advance(TOAST_TIMEOUT);
        expect(messages()).toEqual([]);
    });

    test('hovering holds a message on screen and leaving restarts its life', () => {
        const id = showErrorToast('read me');
        pauseToast(id);
        advance(TOAST_TIMEOUT * 3);
        expect(messages()).toEqual(['read me']);

        resumeToast(id);
        advance(TOAST_TIMEOUT - 1);
        expect(messages()).toEqual(['read me']);
        advance(1);
        expect(messages()).toEqual([]);
    });

    test('resuming a message that is already gone does not bring it back', () => {
        const id = showErrorToast('gone');
        dismissToast(id);
        resumeToast(id);
        expect(messages()).toEqual([]);
    });

    test('clearing drops every message and its timer', () => {
        // A message can name a custom field or an attachment of the database
        // that was open, so a lock has to take all of them with it.
        showErrorToast('Custom field “Recovery codes” is duplicated.');
        showErrorToast('Could not add this attachment.');

        clearToasts();
        expect(messages()).toEqual([]);

        showErrorToast('after the lock');
        advance(TOAST_TIMEOUT - 1);
        expect(messages()).toEqual(['after the lock']);
    });
});
