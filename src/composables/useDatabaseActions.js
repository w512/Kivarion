import { computed, ref } from 'vue';
import {
    loadDatabaseFromDisk,
    readFileMtime,
    saveDatabase,
} from '../dbHelper.js';
import {
    ALL_ENTRIES_UUID,
    findGroupByUuid,
    getDefaultGroup,
    getObjectUuid,
    getUniqueGroupName,
} from '../kdbxView.js';

const AUTO_SAVE_DEBOUNCE_MS = globalThis.__KIVARION_SAVE_DEBOUNCE_MS__ ?? 300;

export function useDatabaseActions(store) {
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
                    saveConflict.value = false;
                    lastSavedDbVersion.value = versionToSave;
                    // The file was just written with the database's current
                    // credentials, so any rekey that was pending is now real.
                    credentialsOnDisk = null;
                } catch (error) {
                    console.error('Failed to save changes:', error);
                    if (error?.code === 'EXTERNAL_CONFLICT') {
                        // Let the UI ask the user; don't treat it as a hard error.
                        saveConflict.value = true;
                        conflictDiskMtime.value = store.filePath
                            ? await readFileMtime(store.filePath)
                            : null;
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

        return ok && !hasUnsavedChanges.value;
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
            // unsaved rekey together.
            pendingSaveVersion = null;
            forceNextSave = false;
            clearTimeout(autoSaveTimer);
            autoSaveTimer = null;
            credentialsOnDisk = null;
            lastSavedDbVersion.value = store.dbVersion;
            saveConflict.value = false;
            conflictDiskMtime.value = null;
            saveError.value = null;
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

    function addEntry(targetGroupUuid) {
        if (!store.db) return null;

        const targetGroup =
            targetGroupUuid === ALL_ENTRIES_UUID
                ? getDefaultGroup(store.db)
                : findGroupByUuid(store.db, targetGroupUuid);

        if (!targetGroup) return null;

        const entry = store.db.createEntry(targetGroup);
        entry.fields.set('Title', 'New entry');
        entry.times.update();
        store.touchDb();
        saveDatabaseChanges({ debounce: true });
        return getObjectUuid(entry);
    }

    function addGroup(parentGroupUuid) {
        if (!store.db || !parentGroupUuid) return null;

        const parentGroup =
            parentGroupUuid === ALL_ENTRIES_UUID
                ? getDefaultGroup(store.db)
                : findGroupByUuid(store.db, parentGroupUuid);

        if (!parentGroup) return null;

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
