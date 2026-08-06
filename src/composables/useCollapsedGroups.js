import { ref, toValue, watch } from 'vue';
import {
    collapsedGroupsPreferenceKey,
    pruneCollapsedGroups,
} from '../databasePreferences.js';

/**
 * The collapsed branches of the group tree, per database file.
 *
 * Stored under `kivarion-collapsed-groups-<path>`; only *collapsed* groups are
 * written, so expanding one drops its uuid rather than recording `false`.
 *
 * @param {object} store - the Pinia store (read for `filePath` and `db`).
 * @param {(() => { has(uuid: string): boolean }|null)} knownGroups - the groups
 *   that exist right now, or `null` while no database is open. Anything
 *   answering `has` will do; callers pass the view's `groupsByUuid`.
 * @returns {import('vue').Ref<Record<string, true>>} for `v-model` on GroupTree.
 */
export function useCollapsedGroups(store, knownGroups) {
    const collapsedGroups = ref({});

    function storageKey() {
        return store.filePath
            ? collapsedGroupsPreferenceKey(store.filePath)
            : null;
    }

    function load() {
        const key = storageKey();
        if (!key) {
            collapsedGroups.value = {};
            return;
        }

        let stored;
        try {
            stored = JSON.parse(localStorage.getItem(key) || '{}');
        } catch {
            stored = null;
        }

        // Groups deleted since the last session would otherwise keep their entry
        // forever. Only prune against the tree when there is one to check: this
        // also runs while a database is being closed, and an empty tree must not
        // be read as "every group is gone". The pruned map is written straight
        // back by the watcher below.
        collapsedGroups.value = pruneCollapsedGroups(
            stored,
            toValue(knownGroups),
        );
    }

    watch(() => store.filePath, load, { immediate: true });

    // Not `deep`: GroupTree replaces the map instead of mutating it, so the ref
    // itself changes on every toggle.
    watch(collapsedGroups, (value) => {
        const key = storageKey();
        if (key) localStorage.setItem(key, JSON.stringify(value));
    });

    return collapsedGroups;
}
