import { describe, expect, test } from 'bun:test';
import {
    biometricPreferenceKey,
    clearDatabasePreferences,
    collapsedGroupsPreferenceKey,
    pruneCollapsedGroups,
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

describe('pruneCollapsedGroups', () => {
    test('keeps only the groups that are collapsed and still exist', () => {
        const stored = {
            'still-collapsed': true,
            'expanded-again': false,
            deleted: true,
        };

        expect(
            pruneCollapsedGroups(
                stored,
                new Set(['still-collapsed', 'expanded-again', 'root']),
            ),
        ).toEqual({ 'still-collapsed': true });
    });

    test('drops expanded groups instead of remembering them as false', () => {
        // The record is per database and lives in localStorage forever; an
        // entry for every group the user ever toggled only ever grew.
        expect(pruneCollapsedGroups({ a: false, b: false })).toEqual({});
    });

    test('does not judge existence when there is no database to check', () => {
        // Called while a database is being closed, an empty tree must not read
        // as "every group is gone" and wipe the user's state.
        expect(pruneCollapsedGroups({ a: true, b: true }, null)).toEqual({
            a: true,
            b: true,
        });
    });

    test('survives a stored value that is not a map of groups', () => {
        // A corrupted or hand-edited key used to blow up on the first lookup.
        for (const stored of [null, undefined, 'nope', 42, ['a', 'b']]) {
            expect(pruneCollapsedGroups(stored, new Set(['a']))).toEqual({});
        }
    });
});
