import { beforeEach, describe, expect, test } from 'bun:test';
import { nextTick, reactive, ref } from 'vue';
import { useCollapsedGroups } from '../src/composables/useCollapsedGroups.js';
import { collapsedGroupsPreferenceKey } from '../src/databasePreferences.js';
import { renderer } from './helpers/vueSfc.js';

let values;

function mountCollapsed(store, knownGroups) {
    let collapsedGroups;
    const app = renderer.createApp({
        setup() {
            collapsedGroups = useCollapsedGroups(store, knownGroups);
            return () => null;
        },
    });
    app.mount({});
    return { app, collapsedGroups };
}

beforeEach(() => {
    values = new Map();
    globalThis.localStorage = {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: (key) => values.delete(key),
    };
});

describe('collapsed groups persistence', () => {
    test('loads, prunes and immediately persists the state for an open database', async () => {
        const path = '/vaults/a.kdbx';
        const key = collapsedGroupsPreferenceKey(path);
        values.set(
            key,
            JSON.stringify({ kept: true, expanded: false, deleted: true }),
        );
        const store = reactive({ filePath: path, db: {} });
        const knownGroups = ref(new Set(['kept', 'expanded']));

        const { app, collapsedGroups } = mountCollapsed(store, knownGroups);
        await nextTick();

        expect(collapsedGroups.value).toEqual({ kept: true });
        expect(JSON.parse(values.get(key))).toEqual({ kept: true });
        app.unmount();
    });

    test('keeps independent maps when the open database changes', async () => {
        const firstPath = '/vaults/a.kdbx';
        const secondPath = '/vaults/b.kdbx';
        const firstKey = collapsedGroupsPreferenceKey(firstPath);
        const secondKey = collapsedGroupsPreferenceKey(secondPath);
        values.set(firstKey, JSON.stringify({ first: true }));
        values.set(secondKey, JSON.stringify({ second: true }));
        const store = reactive({ filePath: firstPath, db: {} });
        const knownGroups = ref(new Set(['first', 'second', 'changed']));
        const { app, collapsedGroups } = mountCollapsed(store, knownGroups);

        collapsedGroups.value = { changed: true };
        await nextTick();
        expect(JSON.parse(values.get(firstKey))).toEqual({ changed: true });

        store.filePath = secondPath;
        await nextTick();
        expect(collapsedGroups.value).toEqual({ second: true });
        expect(JSON.parse(values.get(firstKey))).toEqual({ changed: true });

        store.filePath = null;
        await nextTick();
        expect(collapsedGroups.value).toEqual({});
        expect(JSON.parse(values.get(secondKey))).toEqual({ second: true });
        app.unmount();
    });
});
