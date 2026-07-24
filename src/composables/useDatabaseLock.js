import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store.js';
import { clearManagedClipboard } from './useClipboard.js';

/**
 * Close the currently-unlocked database without asking UI questions.
 *
 * Auto-lock must be unconditional: it must not be blocked by unsaved-edit or
 * save-error modals. Components can listen to `kivarion:before-lock` to discard
 * transient UI-only drafts before the database object is dropped.
 */
export async function lockDatabase(router = null, { forgetFile = false } = {}) {
    const store = useStore();

    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('kivarion:before-lock'));
    }

    void clearManagedClipboard();

    store.db = null;
    store.fileName = '';
    store.selectedGroupUuid = null;

    if (forgetFile) {
        // Closing sends the user back to the file picker, so the backend drops
        // both the remembered path and the filesystem access it granted for it.
        const path = store.filePath;
        try {
            await invoke('forget_database', { path });
        } catch (err) {
            console.error('Failed to forget the database path:', err);
        }
        store.filePath = null;
        store.knownMtime = null;
    }

    if (router?.replace) {
        await router.replace({ name: 'home' }).catch(() => {});
    }
}
