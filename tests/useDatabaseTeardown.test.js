import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { ref } from 'vue';
import { useDatabaseTeardown } from '../src/composables/useDatabaseTeardown.js';
import {
    clearTeardownPageHandler,
    setTeardownPageHandler,
    teardownPageHandler,
} from '../src/teardownGuard.js';
import { renderer } from './helpers/vueSfc.js';

function deferred() {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

async function tick() {
    await Promise.resolve();
    await Promise.resolve();
}

function mountTeardown({
    db = {},
    hasDraft = false,
    hasUnsavedChanges = false,
    isSaving = false,
    saveDatabaseChanges = async () => true,
    reloadDatabaseFromDisk = async () => true,
    requestNavigation = (continueNavigation) => continueNavigation(),
} = {}) {
    let api;
    const store = { db };
    const actions = {
        isSaving: ref(isSaving),
        hasUnsavedChanges: ref(hasUnsavedChanges),
        saveConflict: ref(false),
        conflictDiskMtime: ref(null),
        saveDatabaseChanges: mock(saveDatabaseChanges),
        reloadDatabaseFromDisk: mock(reloadDatabaseFromDisk),
    };
    const selection = {
        hasDraft: mock(() => hasDraft),
        requestNavigation: mock(requestNavigation),
        discardDraft: mock(() => {}),
        restoreSelectionAfterReload: mock(() => {}),
    };
    const app = renderer.createApp({
        setup() {
            api = useDatabaseTeardown({
                store,
                router: {},
                actions,
                selection,
            });
            return () => null;
        },
    });
    app.mount({});
    return { api, app, actions, selection };
}

beforeEach(() => {
    setTeardownPageHandler(null);
});

describe('database teardown guard', () => {
    test('registers only while an open database page is mounted', () => {
        const open = mountTeardown();
        expect(teardownPageHandler()).toBeFunction();

        open.app.unmount();
        expect(teardownPageHandler()).toBe(null);

        const closed = mountTeardown({ db: null });
        expect(teardownPageHandler()).toBe(null);
        closed.app.unmount();
    });

    test('does not let an old page clear a newer page handler', () => {
        const oldHandler = () => true;
        const newHandler = () => true;
        setTeardownPageHandler(oldHandler);
        setTeardownPageHandler(newHandler);

        clearTeardownPageHandler(oldHandler);

        expect(teardownPageHandler()).toBe(newHandler);
    });

    test('leaves a clean teardown to App.vue', () => {
        const { app } = mountTeardown();
        const finish = mock(() => {});

        expect(teardownPageHandler()(finish)).toBe(false);
        expect(finish).not.toHaveBeenCalled();

        app.unmount();
    });

    test('parks teardown on an entry draft before checking the save queue', () => {
        let continueNavigation;
        const { app, selection } = mountTeardown({
            hasDraft: true,
            requestNavigation: (next) => {
                continueNavigation = next;
            },
        });
        const finish = mock(() => {});

        expect(teardownPageHandler()(finish)).toBe(true);
        expect(finish).not.toHaveBeenCalled();
        expect(selection.requestNavigation).toHaveBeenCalledTimes(1);

        continueNavigation();
        expect(finish).toHaveBeenCalledTimes(1);

        app.unmount();
    });

    test('shows saving progress and finishes only after the flush succeeds', async () => {
        const save = deferred();
        const { api, app } = mountTeardown({
            hasUnsavedChanges: true,
            saveDatabaseChanges: () => save.promise,
        });
        const finish = mock(() => {});

        expect(teardownPageHandler()(finish)).toBe(true);
        expect(api.showClosingSaveModal.value).toBe(true);
        expect(finish).not.toHaveBeenCalled();

        save.resolve(true);
        await tick();

        expect(api.showClosingSaveModal.value).toBe(false);
        expect(finish).toHaveBeenCalledTimes(1);
        app.unmount();
    });

    test('cancelling the wait prevents a late save result from closing the app', async () => {
        const save = deferred();
        const { api, app } = mountTeardown({
            hasUnsavedChanges: true,
            saveDatabaseChanges: () => save.promise,
        });
        const finish = mock(() => {});

        teardownPageHandler()(finish);
        api.cancelClosingSave();
        save.resolve(true);
        await tick();

        expect(api.showClosingSaveModal.value).toBe(false);
        expect(finish).not.toHaveBeenCalled();
        app.unmount();
    });

    test('offers close without saving after an ordinary save failure', async () => {
        const { api, app } = mountTeardown({
            hasUnsavedChanges: true,
            saveDatabaseChanges: async () => false,
        });
        const finish = mock(() => {});

        teardownPageHandler()(finish);
        await tick();

        expect(api.showClosingSaveModal.value).toBe(false);
        expect(api.showCloseAfterSaveErrorConfirm.value).toBe(true);
        expect(finish).not.toHaveBeenCalled();

        api.forceCloseDatabase();
        expect(finish).toHaveBeenCalledTimes(1);
        expect(api.showCloseAfterSaveErrorConfirm.value).toBe(false);
        app.unmount();
    });

    test('keeps a conflict as the only decision and resumes after overwrite', async () => {
        let actions;
        const mounted = mountTeardown({
            hasUnsavedChanges: true,
            saveDatabaseChanges: async (options) => {
                if (!options?.force) {
                    actions.saveConflict.value = true;
                    return false;
                }
                actions.hasUnsavedChanges.value = false;
                return true;
            },
        });
        ({ actions } = mounted);
        const { api, app } = mounted;
        const finish = mock(() => {});

        teardownPageHandler()(finish);
        await tick();

        expect(actions.saveConflict.value).toBe(true);
        expect(api.showCloseAfterSaveErrorConfirm.value).toBe(false);
        expect(finish).not.toHaveBeenCalled();

        await api.overwriteOnConflict();

        expect(actions.saveDatabaseChanges).toHaveBeenLastCalledWith({
            force: true,
        });
        expect(finish).toHaveBeenCalledTimes(1);
        app.unmount();
    });

    test('reload discards the draft but resumes teardown only on success', async () => {
        let reloadSucceeds = false;
        let actions;
        const mounted = mountTeardown({
            hasUnsavedChanges: true,
            saveDatabaseChanges: async () => {
                actions.saveConflict.value = true;
                return false;
            },
            reloadDatabaseFromDisk: async () => {
                if (reloadSucceeds) actions.hasUnsavedChanges.value = false;
                return reloadSucceeds;
            },
        });
        ({ actions } = mounted);
        const { api, app, selection } = mounted;
        const finish = mock(() => {});
        teardownPageHandler()(finish);
        await tick();

        await api.reloadFromConflict();
        expect(selection.discardDraft).toHaveBeenCalledTimes(1);
        expect(selection.restoreSelectionAfterReload).not.toHaveBeenCalled();
        expect(finish).not.toHaveBeenCalled();

        reloadSucceeds = true;
        await api.reloadFromConflict();
        expect(selection.restoreSelectionAfterReload).toHaveBeenCalledTimes(1);
        expect(finish).toHaveBeenCalledTimes(1);
        app.unmount();
    });
});
