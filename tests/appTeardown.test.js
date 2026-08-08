import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { nextTick, ref } from 'vue';
import { loadVueComponent, renderer } from './helpers/vueSfc.js';

let store;
let actions;
let router;
let pageHandler;
let closeRequested;
let quitRequested;
let destroyWindow;
let invoke;
let unlistenClose;
let unlistenQuit;

async function tick() {
    await Promise.resolve();
    await nextTick();
    await Promise.resolve();
}

async function mountApp() {
    const App = await loadVueComponent('src/App.vue', {
        'vue-router': { useRouter: () => router },
        './store.js': { useStore: () => store },
        './composables/useAutoLock.js': { useAutoLock: mock(() => {}) },
        './composables/useDatabaseActions.js': {
            useDatabaseActions: () => actions,
        },
        './teardownGuard.js': {
            teardownPageHandler: () => pageHandler,
        },
        '@tauri-apps/api/core': {
            invoke: (...args) => invoke(...args),
        },
        '@tauri-apps/api/event': {
            listen: mock(async (event, handler) => {
                expect(event).toBe('kivarion:quit-requested');
                quitRequested = handler;
                return unlistenQuit;
            }),
        },
        '@tauri-apps/api/window': {
            getCurrentWindow: () => ({
                onCloseRequested: mock(async (handler) => {
                    closeRequested = handler;
                    return unlistenClose;
                }),
                destroy: (...args) => destroyWindow(...args),
            }),
        },
    });
    const app = renderer.createApp(App);
    app.component('RouterView', { render: () => null });
    app.mount({ type: 'root', children: [] });
    await tick();
    return app;
}

beforeEach(() => {
    store = { db: { id: 'open' } };
    actions = {
        isSaving: ref(false),
        hasUnsavedChanges: ref(false),
        saveDatabaseChanges: mock(async () => true),
    };
    router = { push: mock(async () => {}) };
    pageHandler = null;
    closeRequested = null;
    quitRequested = null;
    destroyWindow = mock(async () => {});
    invoke = mock(async () => {});
    unlistenClose = mock(() => {});
    unlistenQuit = mock(() => {});
});

describe('application-level teardown guard', () => {
    test('registers one app-lifetime close and quit listener and removes both', async () => {
        const app = await mountApp();

        expect(closeRequested).toBeFunction();
        expect(quitRequested).toBeFunction();

        app.unmount();
        expect(unlistenClose).toHaveBeenCalledTimes(1);
        expect(unlistenQuit).toHaveBeenCalledTimes(1);
    });

    test('leaves a clean native window close to Tauri', async () => {
        const app = await mountApp();
        const event = { preventDefault: mock(() => {}) };

        await closeRequested(event);

        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(destroyWindow).not.toHaveBeenCalled();
        app.unmount();
    });

    test('lets DatabasePage own a guarded close and supplies a non-recursive finish', async () => {
        let finish;
        pageHandler = mock((complete) => {
            finish = complete;
            return true;
        });
        const app = await mountApp();
        const event = { preventDefault: mock(() => {}) };

        await closeRequested(event);

        expect(pageHandler).toHaveBeenCalledTimes(1);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(destroyWindow).not.toHaveBeenCalled();

        finish();
        expect(destroyWindow).toHaveBeenCalledTimes(1);
        app.unmount();
    });

    test('returns from Settings to DatabasePage before handing over unsaved work', async () => {
        actions.hasUnsavedChanges.value = true;
        const databasePageHandler = mock(() => true);
        router.push = mock(async () => {
            pageHandler = databasePageHandler;
        });
        const app = await mountApp();
        const event = { preventDefault: mock(() => {}) };

        await closeRequested(event);

        expect(router.push).toHaveBeenCalledWith({ name: 'database' });
        expect(databasePageHandler).toHaveBeenCalledTimes(1);
        expect(actions.saveDatabaseChanges).not.toHaveBeenCalled();
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        app.unmount();
    });

    test('falls back to flushing when DatabasePage cannot take over', async () => {
        actions.isSaving.value = true;
        const save = deferred();
        actions.saveDatabaseChanges = mock(() => save.promise);
        const app = await mountApp();
        const event = { preventDefault: mock(() => {}) };

        await closeRequested(event);

        expect(router.push).toHaveBeenCalledWith({ name: 'database' });
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(destroyWindow).not.toHaveBeenCalled();

        save.resolve(true);
        await tick();
        expect(destroyWindow).toHaveBeenCalledTimes(1);
        app.unmount();
    });

    test('does not finish the fallback teardown when the flush fails', async () => {
        actions.hasUnsavedChanges.value = true;
        actions.saveDatabaseChanges = mock(async () => false);
        const app = await mountApp();
        const event = { preventDefault: mock(() => {}) };

        await closeRequested(event);
        await tick();

        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(destroyWindow).not.toHaveBeenCalled();
        app.unmount();
    });

    test('guards quit through the same flow and invokes the backend only after finish', async () => {
        let finish;
        pageHandler = mock((complete) => {
            finish = complete;
            return true;
        });
        const app = await mountApp();

        await quitRequested();
        expect(invoke).not.toHaveBeenCalled();

        finish();
        expect(invoke).toHaveBeenCalledWith('quit_app');
        app.unmount();
    });
});

function deferred() {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
