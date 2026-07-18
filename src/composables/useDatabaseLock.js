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
        localStorage.removeItem('kivarion-last-db-path');
        store.filePath = null;
        store.knownMtime = null;
    }

    if (router?.replace) {
        await router.replace({ name: 'home' }).catch(() => {});
    }
}
