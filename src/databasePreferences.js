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
