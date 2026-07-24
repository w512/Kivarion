// Tracks whether the app is currently waiting on the operating system rather
// than on the user.
//
// Native file dialogs, the Touch ID prompt and Quick Look all take focus away
// from the Kivarion window, which fires the same `blur` event as the user
// switching to another app. With "lock on focus loss" enabled that locked the
// database mid-operation: choosing a key file, exporting an attachment or
// previewing one would drop `store.db` and bounce back to the unlock screen.
//
// Callers wrap the OS-facing call in `withSystemInteraction`; `useAutoLock`
// consults `isSystemInteractionActive()` before locking on focus loss. The
// inactivity timer is deliberately left alone — a long-open dialog should still
// count as idle time.

let activeCount = 0;

export function isSystemInteractionActive() {
    return activeCount > 0;
}

/**
 * Run an operation that hands focus to the OS, suppressing focus-loss locking
 * for its duration.
 *
 * @template T
 * @param {() => Promise<T> | T} run
 * @returns {Promise<T>}
 */
export async function withSystemInteraction(run) {
    activeCount++;
    try {
        return await run();
    } finally {
        activeCount--;
    }
}
