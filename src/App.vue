<script setup>
import { nextTick, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useStore } from './store.js';
import { useAutoLock } from './composables/useAutoLock.js';
import { useDatabaseActions } from './composables/useDatabaseActions.js';
import { teardownPageHandler } from './teardownGuard.js';

useAutoLock();

// --- Teardown guards -----------------------------------------------------
//
// A window close (red button / Cmd+W) and an app quit (Cmd+Q / the app menu —
// the backend holds `ExitRequested` and re-emits it as
// `kivarion:quit-requested`) would otherwise kill the process while an
// auto-save is still in flight or an entry edit is pending.
//
// Both are registered here, once, rather than in `DatabasePage`. There can only
// be one `onCloseRequested` listener — Tauri's wrapper finalizes an unprevented
// close with `destroy()`, so a second one would destroy the window the first
// had just prevented — and a listener that lives on a page disappears with it.
// It used to live on `DatabasePage`, which is unmounted the moment the user
// opens Settings with a database still open: from there Cmd+Q hit the "nothing
// to flush" fallback below and the close button was not guarded at all, so
// either one ended the process over a database with unsaved changes.
//
// While this listener exists the capability must grant
// `core:window:allow-destroy`, or the title-bar close button silently stops
// working.
const store = useStore();
const router = useRouter();
const { isSaving, hasUnsavedChanges, saveDatabaseChanges } =
    useDatabaseActions(store);

let unlistenCloseRequested = null;
let unlistenQuitRequested = null;

onMounted(async () => {
    unlistenCloseRequested = await getCurrentWindow().onCloseRequested(
        async (event) => {
            if (await guardTeardown(closeWindow)) event.preventDefault();
        },
    );
    unlistenQuitRequested = await listen(
        'kivarion:quit-requested',
        async () => {
            if (!(await guardTeardown(quitApp))) quitApp();
        },
    );
});

onUnmounted(() => {
    unlistenCloseRequested?.();
    unlistenCloseRequested = null;
    unlistenQuitRequested?.();
    unlistenQuitRequested = null;
});

/**
 * @returns {Promise<boolean>} true when the teardown has been taken over and
 *   the caller must not finish it.
 */
async function guardTeardown(finish) {
    // DatabasePage owns the full flow — the entry-edit draft, the
    // "Saving changes…" modal, the conflict modal — so it decides while it is
    // on screen.
    const handler = teardownPageHandler();
    if (handler) return handler(finish);

    // Nothing to lose: no database, or one whose every change is on disk. With
    // the page unmounted there is no entry-edit draft either, so these two
    // cover everything that could hold a teardown up.
    if (!store.db) return false;
    if (!isSaving.value && !hasUnsavedChanges.value) return false;

    // A database with unsaved work while its page is not mounted — the user is
    // in Settings. Every control that can resolve a stuck save is rendered
    // there, so go back to it and hand the decision over instead of keeping a
    // second copy of those dialogs here. A rejected navigation must not take
    // the guard down with it: the flush below still protects the write.
    await router.push({ name: 'database' }).catch(() => {});
    await nextTick();
    const pageHandler = teardownPageHandler();
    if (pageHandler) return pageHandler(finish);

    // The page did not take over (it always should). Flush anyway rather than
    // drop a pending write on the floor.
    void saveDatabaseChanges().then((saved) => {
        if (saved) finish();
    });
    return true;
}

function closeWindow() {
    // destroy() rather than close(): the flush already ran, and close() would
    // re-enter the guard above.
    void getCurrentWindow().destroy();
}

function quitApp() {
    void invoke('quit_app');
}
</script>

<template>
    <router-view />
</template>

<style>
:root {
    --bg-color: #0f1117;
    --card-bg: #1a1b23;
    --border-color: #2a2b35;
    --text-primary: #e4e4e7;
    --text-secondary: #71717a;
    --accent-color: #6366f1;
    --accent-hover: #5457e5;
    --error-color: #ef4444;
    --input-bg: #12131a;
    --badge-bg: #1f2028;
    --note-bg: #3d3518;
    --note-border: #66551c;
    --note-label: #e0c45c;
    /* A revealed password is drawn one colour per character class
       (`ColoredPassword.vue`). Letters follow the surrounding text so an
       ordinary password still looks ordinary; digits are green and symbols red,
       the two that have to be told apart at a glance. */
    --password-letter: var(--text-primary);
    --password-digit: #22c55e;
    --password-symbol: #ff5a5a;
}

:root[data-theme='light'] {
    --bg-color: #f8fafc;
    --card-bg: #ffffff;
    --border-color: #e2e8f0;
    --text-primary: #0f172a;
    --text-secondary: #64748b;
    --accent-color: #6366f1;
    --accent-hover: #4f46e5;
    --error-color: #ef4444;
    --input-bg: #f1f5f9;
    --badge-bg: #f1f5f9;
    --note-bg: #fff7cc;
    --note-border: #eadb8b;
    --note-label: #806600;
    /* Red survives the white background at full brightness (#ff0000 is 4.0:1);
       green does not — pure #00ff00 lands at 1.4:1, which is unreadable rather
       than merely bright. This green is about as vivid as one can get here and
       still be read: 3.2:1 on the card, 2.9:1 on the generator's preview strip.
       Anything brighter stops being legible, and misreading one character of a
       password is worth avoiding. */
    --password-digit: #0ea54a;
    --password-symbol: #ff0000;
}

* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family:
        'Inter',
        system-ui,
        -apple-system,
        BlinkMacSystemFont,
        'Segoe UI',
        Roboto,
        sans-serif;
    background-color: var(--bg-color);
    color: var(--text-primary);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
}

::selection {
    background: rgba(99, 102, 241, 0.3);
}

/* Visible keyboard focus ring across the app (keyboard only, not mouse). */
:focus-visible {
    outline: 2px solid var(--accent-color);
    outline-offset: 2px;
}

:focus:not(:focus-visible) {
    outline: none;
}

::-webkit-scrollbar {
    width: 6px;
}

::-webkit-scrollbar-track {
    background: var(--bg-color);
}

::-webkit-scrollbar-thumb {
    background: var(--border-color);
    border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
    background: var(--text-secondary);
}
</style>
