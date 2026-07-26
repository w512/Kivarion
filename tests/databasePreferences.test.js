import { describe, expect, test } from 'bun:test';
import {
    biometricPreferenceKey,
    clearDatabasePreferences,
    collapsedGroupsPreferenceKey,
} from '../src/databasePreferences.js';

function makeStorage(initial) {
    const values = new Map(Object.entries(initial));
    return {
        get length() {
            return values.size;
        },
        key(index) {
            return [...values.keys()][index] ?? null;
        },
        removeItem(key) {
            values.delete(key);
        },
        getItem(key) {
            return values.get(key) ?? null;
        },
        keys() {
            return [...values.keys()];
        },
    };
}

describe('database-specific preference cleanup', () => {
    test('builds stable keys from the absolute database path', () => {
        expect(biometricPreferenceKey('/vaults/main.kdbx')).toBe(
            'kivarion-biometrics-/vaults/main.kdbx',
        );
        expect(collapsedGroupsPreferenceKey('/vaults/main.kdbx')).toBe(
            'kivarion-collapsed-groups-/vaults/main.kdbx',
        );
    });

    test('removes path-keyed biometric and group state only', () => {
        const storage = makeStorage({
            'kivarion-biometrics-/old/vault.kdbx': 'true',
            'kivarion-collapsed-groups-/old/vault.kdbx': '{"group":true}',
            'kivarion-theme': 'dark',
            'kivarion-backup-depth': '3',
        });

        expect(clearDatabasePreferences(storage)).toBe(2);
        expect(storage.keys()).toEqual([
            'kivarion-theme',
            'kivarion-backup-depth',
        ]);
    });

    test('snapshots keys so adjacent matches are not skipped while deleting', () => {
        const storage = makeStorage({
            'kivarion-biometrics-/one.kdbx': 'true',
            'kivarion-biometrics-/two.kdbx': 'true',
            'kivarion-collapsed-groups-/three.kdbx': '{}',
        });

        expect(clearDatabasePreferences(storage)).toBe(3);
        expect(storage.length).toBe(0);
    });
});
