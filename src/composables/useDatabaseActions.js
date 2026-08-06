import { computed, effectScope, ref, watch } from 'vue';
import {
    loadDatabaseFromDisk,
    readFileMtime,
    saveDatabase,
} from '../dbHelper.js';
import { getObjectUuid, getUniqueGroupName } from '../kdbxView.js';

const AUTO_SAVE_DEBOUNCE_MS = globalThis.__KIVARION_SAVE_DEBOUNCE_MS__ ?? 300;

// One instance for the whole application.
//
// This used to be built per `DatabasePage`, so every field of it — the dirty
// marker, the save error, the conflict, the record of an unsaved rekey — was
// thrown away the moment that page unmounted. Opening Settings does exactly
// that: `DatabaseHeader` links there without closing the database. A save that
// had failed (`SAVE_LOCKED`, a conflict, an I/O error) therefore came back from
// Settings looking like a database with nothing outstanding — no banner,
// `hasUnsavedChanges` false — and the next Lock or Close dropped those changes
// without asking. The state describes the database that is open, not the page
// that happens to be showing it, so it lives here and is reset when a different
// database takes its place.
let scope = null;
let instance = null;

export function useDatabaseActions(store) {
    if (!instance) {
        // Detached on purpose. The first caller is a component's `setup()`, and
        // an attached scope would be collected by that component and stopped on
        // its unmount — the very thing this exists to outlive.
        scope = effectScope(true);
        instance = scope.run(() => createDatabaseActions(store));
    }
    return instance;
}

/** Test seam: drop the instance (and its watcher) a previous test left behind. */
export function resetDatabaseActions() {
    scope?.stop();
    scope = null;
    instance = null;
}

function createDatabaseActions(store) {
    // Surfaced to the UI so a failed save is never silent.
    const isSaving = ref(false);
    const saveError = ref(null);
    // Distinct from saveError: the file was changed on disk by another writer.
    // The UI turns this into an explicit choice (keep mine / take the file's
    // version) rather than treating it as a fault.
    const saveConflict = ref(false);
    // mtime of the on-disk version at the moment the conflict was detected, so
    // the modal can say how fresh the other writer's version is.
    const conflictDiskMtime = ref(null);
    const isReloading = ref(false);
    const lastSavedDbVersion = ref(store.dbVersion);
    const hasUnsavedChanges = computed(() => {
        return (
            !!saveError.value ||
            saveConflict.value ||
            store.dbVersion > lastSavedDbVersion.value
        );
    });

    let pendingSaveVersion = null;
    let activeSavePromise = null;
    let forceNextSave = false;
    let autoSaveTimer = null;
    // Credentials the file on disk is still encrypted with while a master
    // password / key file change waits to be written. See below.
    let credentialsOnDisk = null;
    // Work that only becomes correct once the new credentials are on disk. See
    // `runAfterSuccessfulSave`.
    let afterSaveActions = [];

    // Which database everything above is about, and a counter that marks the
    // moment it was replaced. A save can still be in flight across that
    // moment — it belongs to the previous database, and its result must not be
    // written over the state of the new one.
    let trackedDb = store.db;
    let generation = 0;

    /**
     * Start tracking whatever database is open now, from a clean sheet.
     *
     * Called when `store.db` changes under us (a lock, a different file opened,
     * a reload from disk). Everything outstanding referred to the previous
     * database and is unreachable once it is gone.
     */
    function adoptOpenDatabase() {
        trackedDb = store.db;
        generation++;
        pendingSaveVersion = null;
        forceNextSave = false;
        clearTimeout(autoSaveTimer);
        autoSaveTimer = null;
        credentialsOnDisk = null;
        // These describe a rekey of the previous database. They also close over
        // its new master password, so dropping them here is what keeps that
        // string from outliving the database it belongs to.
        afterSaveActions = [];
        lastSavedDbVersion.value = store.dbVersion;
        saveError.value = null;
        saveConflict.value = false;
        conflictDiskMtime.value = null;
    }

    watch(
        () => store.db,
        (db) => {
            if (db !== trackedDb) adoptOpenDatabase();
        },
    );

    /**
     * Record the credentials the file on disk still uses.
     *
     * A rekey has to be applied to the open database before anything can be
     * written with it, so if that write fails (I/O error, `SAVE_LOCKED`,
     * `EXTERNAL_CONFLICT`) memory and disk disagree about the key. Reloading
     * then failed with `InvalidKey` under a generic "could not reload" message,
     * and the only way out was retrying the save. With the previous credentials
     * kept here, "keep the file" stays available: discarding local changes
     * discards the unsaved rekey with them.
     *
     * The first call after a successful save wins — a second unsaved change must
     * not overwrite the credentials the file actually has.
     *
     * @param {import('kdbxweb').Credentials} credentials
     */
    function rememberCredentialsOnDisk(credentials) {
        if (!credentialsOnDisk) credentialsOnDisk = credentials ?? null;
    }

    /**
     * Queue work that is only correct once the write actually lands.
     *
     * A rekey brings two records with it that describe the *file*, not the
     * open database: which key file unlocks it, and the master password kept
     * for Touch ID. `confirmDatabaseSettings` used to update both itself, but
     * only when the save it had just issued succeeded — so if that one failed
     * (`SAVE_LOCKED`, a conflict, an I/O error) and the user then resolved it
     * from the banner or the conflict modal, the file was rekeyed while the
     * remembered key file and the Keychain entry still described the old
     * credentials: the next launch offered the wrong key file, and Touch ID
     * kept handing over a password the database no longer had.
     *
     * Queued here instead, these ride along with whichever write finally
     * succeeds. They are dropped by `adoptOpenDatabase` when the database is
     * locked or replaced, so nothing they close over outlives it.
     *
     * @param {() => Promise<void>|void} action
     */
    function runAfterSuccessfulSave(action) {
        if (typeof action === 'function') afterSaveActions.push(action);
    }

    async function drainAfterSaveActions() {
        const actions = afterSaveActions;
        afterSaveActions = [];
        for (const action of actions) {
            try {
                await action();
            } catch (error) {
                // The vault is written; this is bookkeeping beside it. Each
                // action reports its own failure to the user where it matters.
                console.error('A post-save step failed:', error);
            }
        }
    }

    // Rapid field edits used to rerun Argon2 and encrypt the entire vault for
    // every small mutation. Delay ordinary auto-saves briefly; explicit flushes
    // (close, retry, settings changes) still call saveDatabaseChanges directly.
    function scheduleDatabaseSave() {
        clearTimeout(autoSaveTimer);
        autoSaveTimer = setTimeout(() => {
            autoSaveTimer = null;
            void saveDatabaseChanges();
        }, AUTO_SAVE_DEBOUNCE_MS);
        return Promise.resolve(false);
    }

    /**
     * Turn a still-pending debounced auto-save into an immediate one.
     *
     * Auto-lock drops `store.db` without asking any questions, so the delayed
     * callback would find no database and drop the mutation on the floor. Lock
     * paths call this while the database is still open; it is a no-op when
     * nothing is waiting.
     *
     * @returns {Promise<boolean>} the save result, or false when nothing was pending.
     */
    function flushPendingSave() {
        if (autoSaveTimer === null) return Promise.resolve(false);
        return saveDatabaseChanges();
    }

    /**
     * Persist the current database through a single in-process queue.
     *
     * kdbxweb objects are mutated synchronously and many actions can request a
     * save without awaiting it. Writing all requests through this queue prevents
     * concurrent writes to the same `.tmp`/`.bak` files and guarantees that, if
     * the database changes while a save is in progress, the latest version is
     * saved again before the promise resolves.
     *
     * On failure the database remains dirty (`hasUnsavedChanges`) and the error
     * is exposed via `saveError` so the UI can warn the user and offer a retry.
     *
     * `{ debounce: true }` coalesces rapid mutations into a single delayed
     * write and resolves `false` right away — its result says nothing about
     * the eventual save, so call this plainly whenever the outcome matters.
     *
     * @returns {Promise<boolean>} true when the latest database version is saved.
     */
    function saveDatabaseChanges({ force = false, debounce = false } = {}) {
        if (!store.db) return Promise.resolve(false);
        if (debounce && !force) return scheduleDatabaseSave();

        clearTimeout(autoSaveTimer);
        autoSaveTimer = null;
        if (force) forceNextSave = true;
        pendingSaveVersion = store.dbVersion;

        if (!activeSavePromise) {
            activeSavePromise = flushSaveQueue().finally(() => {
                activeSavePromise = null;
            });
        }

        return activeSavePromise;
    }

    async function flushSaveQueue() {
        isSaving.value = true;
        // The database this flush is writing. If it is replaced mid-write, the
        // outcome below describes a vault that is no longer open and has to be
        // dropped rather than recorded against its successor.
        const saveGeneration = generation;
        let ok = true;

        try {
            while (pendingSaveVersion !== null && store.db) {
                const versionToSave = pendingSaveVersion;
                pendingSaveVersion = null;

                // A duplicate request for a version that has just been saved
                // does not need another disk write.
                if (
                    !saveError.value &&
                    versionToSave <= lastSavedDbVersion.value
                ) {
                    continue;
                }

                try {
                    saveError.value = null;
                    const force = forceNextSave;
                    forceNextSave = false;
                    await saveDatabase(store.db, store.fileName, { force });
                    // A different database took the place of the one this
                    // write belongs to. The write itself succeeded — which is
                    // what the caller asked about — but none of the
                    // bookkeeping below may be recorded against its successor.
                    if (saveGeneration !== generation) break;
                    saveConflict.value = false;
                    conflictDiskMtime.value = null;
                    lastSavedDbVersion.value = versionToSave;
                    // The file was just written with the database's current
                    // credentials, so any rekey that was pending is now real.
                    credentialsOnDisk = null;
                } catch (error) {
                    console.error('Failed to save changes:', error);
                    ok = false;
                    // Same as above: a failure that belongs to a database
                    // which is no longer open must not raise a banner or a
                    // conflict modal over the one that replaced it.
                    if (saveGeneration !== generation) break;
                    if (error?.code === 'EXTERNAL_CONFLICT') {
                        // Let the UI ask the user; don't treat it as a hard
                        // error. Read the timestamp before raising the flag:
                        // the modal renders as soon as `saveConflict` is set,
                        // and setting it first showed the previous conflict's
                        // date for as long as this await took.
                        const diskMtime = store.filePath
                            ? await readFileMtime(store.filePath)
                            : null;
                        conflictDiskMtime.value = diskMtime;
                        saveConflict.value = true;
                    } else {
                        const message =
                            error?.message || String(error) || 'Unknown error';
                        saveError.value = message.includes('SAVE_LOCKED')
                            ? 'Another Kivarion window is saving this database. Please wait a moment, then retry.'
                            : message;
                    }
                    pendingSaveVersion = null;
                    ok = false;
                    break;
                }
            }
        } finally {
            isSaving.value = false;
            // Never carry a force request past the flush that requested it.
            forceNextSave = false;
        }

        const saved = ok && !hasUnsavedChanges.value;
        // Run the queued post-save work only once the database is genuinely
        // clean, and with `isSaving` already false: one of these raises a Touch
        // ID prompt, and the user answering it is not a write in progress.
        // `activeSavePromise` is still pending, so the caller's `await` — and
        // any save requested meanwhile — waits for these to finish.
        if (saved) await drainAfterSaveActions();
        return saved;
    }

    /**
     * Resolve an external-modification conflict by taking the version on disk.
     *
     * The file is re-read with the credentials of the currently open database —
     * or, when a rekey is still unsaved, with the ones the file actually has
     * (`rememberCredentialsOnDisk`) — so it works without asking for the master
     * password again. **Every unsaved in-memory change is discarded**, the
     * unsaved rekey included; the caller must have confirmed that with the user,
     * and must drop any pending entry-edit draft first, since the whole object
     * graph is replaced.
     *
     * @returns {Promise<boolean>} true when the database was replaced.
     */
    async function reloadDatabaseFromDisk() {
        if (!store.db || !store.filePath || isSaving.value) return false;

        isReloading.value = true;
        try {
            // Before the read, for the same reason as in `useDatabaseAuth`: the
            // load reruns the KDF, and a timestamp taken after it would mark an
            // external write that happened in between as already known, so the
            // next save would silently overwrite it.
            const mtimeBeforeRead = await readFileMtime(store.filePath);

            const db = await loadDatabaseFromDisk(
                store.filePath,
                store.db.credentials,
                credentialsOnDisk,
            );

            store.db = db;
            store.knownMtime = mtimeBeforeRead;
            store.touchDb();

            // Memory now matches the file, so nothing is outstanding: drop the
            // dirty marker, the queued save, the conflict and the record of an
            // unsaved rekey together. Done here rather than left to the
            // `store.db` watcher so it is in effect before this returns.
            adoptOpenDatabase();
            return true;
        } catch (error) {
            console.error('Failed to reload the database from disk:', error);
            // Keep `saveConflict` set: the choice is still open, the banner
            // just explains why this half of it did not work.
            saveError.value =
                error?.code === 'InvalidKey'
                    ? 'Could not reload the file from disk: it does not open with this database’s password or key file. Its master password was probably changed by another program — save your version instead, or lock the database and open the file with the password it has now.'
                    : `Could not reload the file from disk: ${
                          error?.message || error
                      }`;
            return false;
        } finally {
            isReloading.value = false;
        }
    }

    // Both take a resolved group rather than a uuid: looking one up means
    // searching the vault, and the page that calls these already holds the
    // index that answers it (`buildDatabaseView`).
    function addEntry(targetGroup) {
        if (!store.db || !targetGroup) return null;

        const entry = store.db.createEntry(targetGroup);
        entry.fields.set('Title', 'New entry');
        entry.times.update();
        store.touchDb();
        saveDatabaseChanges({ debounce: true });
        return getObjectUuid(entry);
    }

    function addGroup(parentGroup) {
        if (!store.db || !parentGroup) return null;

        const group = store.db.createGroup(
            parentGroup,
            getUniqueGroupName(parentGroup),
        );
        store.touchDb();
        saveDatabaseChanges({ debounce: true });
        return getObjectUuid(group);
    }

    return {
        saveDatabaseChanges,
        flushPendingSave,
        reloadDatabaseFromDisk,
        rememberCredentialsOnDisk,
        runAfterSuccessfulSave,
        addEntry,
        addGroup,
        isSaving,
        isReloading,
        saveError,
        saveConflict,
        conflictDiskMtime,
        hasUnsavedChanges,
        lastSavedDbVersion,
    };
}
