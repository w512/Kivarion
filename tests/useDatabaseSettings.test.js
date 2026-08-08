import {
    afterEach,
    beforeEach,
    describe,
    expect,
    mock,
    spyOn,
    test,
} from 'bun:test';
import { nextTick, shallowReactive } from 'vue';
import * as kdbxweb from 'kdbxweb';
import * as tauriCore from '@tauri-apps/api/core';
import { useDatabaseSettings } from '../src/composables/useDatabaseSettings.js';
import { biometricPreferenceKey } from '../src/databasePreferences.js';
import { renderer } from './helpers/vueSfc.js';

let store;
let actions;
let queuedAfterSave;
let invokeHandlers;
let invokeSpy;
let loadSpy;
let consoleErrorSpy;
let storage;

function deferred() {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

async function tick() {
    await Promise.resolve();
    await nextTick();
    await Promise.resolve();
}

async function mountSettings() {
    let api;
    const app = renderer.createApp({
        setup() {
            api = useDatabaseSettings(store, { actions });
            return () => null;
        },
    });
    app.mount({});
    await tick();
    return { api, app };
}

beforeEach(async () => {
    storage = new Map();
    globalThis.localStorage = {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: (key) => storage.delete(key),
    };

    const credentials = new kdbxweb.Credentials(
        kdbxweb.ProtectedValue.fromString('old password'),
        null,
    );
    await credentials.ready;
    store = shallowReactive({
        db: {
            credentials,
            meta: { name: 'Old name' },
        },
        filePath: '/vaults/main.kdbx',
        touchDb: mock(() => {}),
    });

    queuedAfterSave = [];
    actions = {
        rememberCredentialsOnDisk: mock(() => {}),
        runAfterSuccessfulSave: mock((run) => queuedAfterSave.push(run)),
        saveDatabaseChanges: mock(async () => true),
    };

    invokeHandlers = {
        remembered_key_file: async () => null,
        read_database: async () => new Uint8Array([1, 2, 3]),
        remember_key_file: async () => {},
        save_biometric_password: async () => {},
        delete_biometric_password: async () => {},
    };
    invokeSpy = spyOn(tauriCore, 'invoke').mockImplementation((cmd, args) => {
        const handler = invokeHandlers[cmd];
        return handler ? handler(args) : Promise.resolve();
    });
    loadSpy = spyOn(kdbxweb.Kdbx, 'load').mockResolvedValue({});
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    invokeSpy?.mockRestore();
    loadSpy?.mockRestore();
    consoleErrorSpy?.mockRestore();
});

describe('database settings', () => {
    test('renames the database and saves without replacing its credentials', async () => {
        const oldCredentials = store.db.credentials;
        const { api, app } = await mountSettings();
        api.openDatabaseSettings();

        await api.confirmDatabaseSettings({
            name: '  Personal vault  ',
            password: '',
            currentPassword: '',
            keyFilePath: null,
            keyFileChanged: false,
        });

        expect(store.db.meta.name).toBe('Personal vault');
        expect(store.db.credentials).toBe(oldCredentials);
        expect(actions.rememberCredentialsOnDisk).not.toHaveBeenCalled();
        expect(actions.runAfterSuccessfulSave).not.toHaveBeenCalled();
        expect(store.touchDb).toHaveBeenCalledTimes(1);
        expect(actions.saveDatabaseChanges).toHaveBeenCalledTimes(1);
        expect(api.showSettingsModal.value).toBe(false);
        app.unmount();
    });

    test('keeps the dialog and database untouched when current credentials are wrong', async () => {
        const oldCredentials = store.db.credentials;
        loadSpy.mockRejectedValueOnce(new Error('invalid key'));
        const { api, app } = await mountSettings();
        api.openDatabaseSettings();

        await api.confirmDatabaseSettings({
            name: 'Changed name',
            password: 'new password',
            currentPassword: 'wrong password',
            keyFilePath: null,
            keyFileChanged: false,
        });

        expect(api.settingsError.value).toBe(
            'Current password or key file is incorrect.',
        );
        expect(api.settingsBusy.value).toBe(false);
        expect(api.showSettingsModal.value).toBe(true);
        expect(store.db.meta.name).toBe('Old name');
        expect(store.db.credentials).toBe(oldCredentials);
        expect(store.touchDb).not.toHaveBeenCalled();
        expect(actions.saveDatabaseChanges).not.toHaveBeenCalled();
        app.unmount();
    });

    test('does not apply a password after the database locks during verification', async () => {
        const verification = deferred();
        loadSpy.mockImplementationOnce(() => verification.promise);
        const originalDb = store.db;
        const { api, app } = await mountSettings();
        api.openDatabaseSettings();

        const confirmation = api.confirmDatabaseSettings({
            name: 'Changed name',
            password: 'new password',
            currentPassword: 'old password',
            keyFilePath: null,
            keyFileChanged: false,
        });
        await tick();
        store.db = null;
        verification.resolve({});
        await confirmation;

        expect(originalDb.meta.name).toBe('Old name');
        expect(actions.rememberCredentialsOnDisk).not.toHaveBeenCalled();
        expect(store.touchDb).not.toHaveBeenCalled();
        expect(actions.saveDatabaseChanges).not.toHaveBeenCalled();
        expect(api.settingsBusy.value).toBe(false);
        app.unmount();
    });

    test('queues key-file and Touch ID records until a save succeeds', async () => {
        invokeHandlers.remembered_key_file = async () => '/keys/old.key';
        storage.set(biometricPreferenceKey(store.filePath), 'true');
        const oldCredentials = store.db.credentials;
        const { api, app } = await mountSettings();
        expect(api.currentKeyFilePath.value).toBe('/keys/old.key');
        api.openDatabaseSettings();

        await api.confirmDatabaseSettings({
            name: 'Updated vault',
            password: 'new password',
            currentPassword: 'old password',
            keyFilePath: '/keys/new.key',
            keyFileChanged: true,
        });

        expect(actions.rememberCredentialsOnDisk).toHaveBeenCalledWith(
            oldCredentials,
        );
        expect(store.db.credentials).not.toBe(oldCredentials);
        expect(queuedAfterSave).toHaveLength(2);
        expect(
            invokeSpy.mock.calls.some(([cmd]) => cmd === 'remember_key_file'),
        ).toBe(false);
        expect(
            invokeSpy.mock.calls.some(
                ([cmd]) => cmd === 'save_biometric_password',
            ),
        ).toBe(false);

        await queuedAfterSave[0]();
        await queuedAfterSave[1]();

        expect(invokeSpy).toHaveBeenCalledWith('remember_key_file', {
            dbPath: '/vaults/main.kdbx',
            keyPath: '/keys/new.key',
        });
        expect(invokeSpy).toHaveBeenCalledWith('save_biometric_password', {
            id: '/vaults/main.kdbx',
            pass: 'new password',
        });
        expect(api.currentKeyFilePath.value).toBe('/keys/new.key');
        app.unmount();
    });

    test('drops a stale Touch ID preference if updating its secret fails', async () => {
        const preferenceKey = biometricPreferenceKey(store.filePath);
        storage.set(preferenceKey, 'true');
        invokeHandlers.save_biometric_password = async () => {
            throw new Error('keychain unavailable');
        };
        const { api, app } = await mountSettings();
        api.openDatabaseSettings();

        await api.confirmDatabaseSettings({
            name: 'Updated vault',
            password: 'new password',
            currentPassword: 'old password',
            keyFilePath: null,
            keyFileChanged: false,
        });
        expect(queuedAfterSave).toHaveLength(1);

        await queuedAfterSave[0]();

        expect(invokeSpy).toHaveBeenCalledWith('delete_biometric_password', {
            id: '/vaults/main.kdbx',
        });
        expect(storage.has(preferenceKey)).toBe(false);
        app.unmount();
    });
});
