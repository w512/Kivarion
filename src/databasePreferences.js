export const BIOMETRIC_PREFERENCE_PREFIX = 'kivarion-biometrics-';
export const COLLAPSED_GROUPS_PREFERENCE_PREFIX = 'kivarion-collapsed-groups-';

export const DATABASE_PREFERENCE_PREFIXES = [
    BIOMETRIC_PREFERENCE_PREFIX,
    COLLAPSED_GROUPS_PREFERENCE_PREFIX,
];

export function biometricPreferenceKey(path) {
    return `${BIOMETRIC_PREFERENCE_PREFIX}${path}`;
}

export function collapsedGroupsPreferenceKey(path) {
    return `${COLLAPSED_GROUPS_PREFERENCE_PREFIX}${path}`;
}

/**
 * Normalize the stored collapsed-group state, dropping everything that no
 * longer means anything.
 *
 * Two things used to accumulate in `kivarion-collapsed-groups-<path>` forever:
 * groups the user expanded again (written as `false` but never removed) and
 * groups that have since been deleted. Neither is recoverable from the UI, so
 * the record only ever grew.
 *
 * @param {unknown} stored - the parsed localStorage value; anything that is not
 *   a plain object (`null`, an array, a string from a corrupted write) yields an
 *   empty map rather than throwing on the first lookup.
 * @param {{ has(uuid: string): boolean }|null} [knownGroups] - the groups that
 *   exist right now, as anything answering `has` — callers pass the view's
 *   `groupsByUuid` map. `null` means "no database to check against", in which
 *   case existence is not judged: that must not be a reason to wipe the user's
 *   state.
 * @returns {Record<string, true>} only the groups that are collapsed and exist.
 */
export function pruneCollapsedGroups(stored, knownGroups = null) {
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
        return {};
    }

    const pruned = {};
    for (const [uuid, collapsed] of Object.entries(stored)) {
        if (!collapsed) continue;
        if (knownGroups && !knownGroups.has(uuid)) continue;
        pruned[uuid] = true;
    }
    return pruned;
}

/**
 * Remove preferences keyed by an absolute database path while preserving
 * application-wide settings such as theme, backup policy and column widths.
 *
 * Snapshot keys first: removing an item changes localStorage.length/indexes.
 * Returns the number removed so Settings can report a useful result.
 */
export function clearDatabasePreferences(storage = localStorage) {
    const keys = [];
    for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (
            key &&
            DATABASE_PREFERENCE_PREFIXES.some((prefix) =>
                key.startsWith(prefix),
            )
        ) {
            keys.push(key);
        }
    }

    for (const key of keys) storage.removeItem(key);
    return keys.length;
}
