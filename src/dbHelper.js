import { invoke } from '@tauri-apps/api/core';
import * as kdbxweb from 'kdbxweb';
import { invokeWithBytes } from './ipc.js';
import { SETTING_LIMITS, clampNumberSetting, useStore } from './store.js';
import { toExactArrayBuffer } from './utils.js';

/**
 * Re-read a database from disk with the given credentials.
 *
 * Used to resolve an external-modification conflict by taking the version that
 * is on disk. Every unsaved in-memory change is dropped by design, so callers
 * must confirm with the user first.
 *
 * `fallbackCredentials` covers the one case where the open database's
 * credentials are expected not to fit the file: a master password or key file
 * changed here but not yet written. The file is still encrypted with the
 * previous credentials, and discarding local changes has to discard that rekey
 * along with them. Only `InvalidKey` falls back — a corrupt file must still be
 * reported as corrupt — and the bytes are read once for both attempts.
 *
 * @param {string} path
 * @param {kdbxweb.Credentials} credentials - normally `store.db.credentials`
 * @param {kdbxweb.Credentials} [fallbackCredentials]
 * @returns {Promise<kdbxweb.Kdbx>}
 */
export async function loadDatabaseFromDisk(
    path,
    credentials,
    fallbackCredentials = null,
) {
    const bytes = await invoke('read_database', { path });
    const buffer = toExactArrayBuffer(bytes);

    try {
        return await kdbxweb.Kdbx.load(buffer, credentials);
    } catch (error) {
        if (!fallbackCredentials || error?.code !== 'InvalidKey') throw error;
        return kdbxweb.Kdbx.load(buffer, fallbackCredentials);
    }
}

/**
 * Build the credentials that a master-password / key-file change results in.
 *
 * Both halves are prepared and validated here so the caller can swap the result
 * in with a single assignment. Calling `setPassword` on the live credentials and
 * then having `setKeyFile` reject — a key file of an unsupported version does
 * that — used to leave the open database rekeyed halfway, encrypted under a
 * password nobody had asked for. Rejects instead, leaving `current` untouched.
 *
 * Whichever half the user did not touch is carried over from `current`; its
 * hashes are all we have (the plaintext password is not kept), which is exactly
 * what the new credentials need.
 *
 * @param {kdbxweb.Credentials} current
 * @param {{ password?: string, keyFileBuffer?: ArrayBuffer|null, keyFileChanged?: boolean }} change
 * @returns {Promise<kdbxweb.Credentials>}
 */
export async function buildUpdatedCredentials(
    current,
    { password = '', keyFileBuffer = null, keyFileChanged = false } = {},
) {
    const updated = new kdbxweb.Credentials(
        password ? kdbxweb.ProtectedValue.fromString(password) : null,
        keyFileChanged ? keyFileBuffer : null,
    );
    await updated.ready;

    if (!password) updated.passwordHash = current.passwordHash;
    if (!keyFileChanged) updated.keyFileHash = current.keyFileHash;
    return updated;
}

/**
 * Modification time of a file in ms since the epoch, or `null` when it cannot
 * be read. Never rejects — callers use it for tracking and for display.
 */
export async function readFileMtime(path) {
    try {
        return await invoke('file_mtime', { path });
    } catch (error) {
        console.error('Failed to read the file modification time:', error);
        return null;
    }
}

/**
 * Save the database to disk.
 *
 * The actual write happens in the Rust backend (`save_database` command), which
 * performs an atomic temp-write → `.bak` backup → rename. The webview never has
 * direct filesystem access; it only hands the serialized bytes and target path
 * to the backend. A crash or I/O error mid-write leaves the original `.kdbx`
 * intact.
 *
 * Credentials are taken from the db itself (`db.save()` uses `db.credentials`),
 * so they are not passed separately.
 *
 * Passing `{ force: true }` skips the optimistic-concurrency check, used when
 * the user has chosen to overwrite an externally-modified file.
 *
 * Everything that describes *this* save — the target path, the mtime the
 * concurrency check compares against, the backup policy — is read **before**
 * `db.save()`, not after. Serializing a large vault is a full KDF plus the
 * encryption of every byte, i.e. seconds, and `store.filePath` can point at a
 * different file by the time that finishes: auto-lock drops `store.db` without
 * cancelling a save already in progress, and the user is then free to open
 * another database. Read afterwards, the bytes of one vault would be written
 * over another — and with the second vault's `knownMtime` already in the store,
 * even the conflict check would wave it through.
 *
 * @param {kdbxweb.Kdbx} db - The database instance
 * @param {string} fileName - Name of the open file; only checked for presence,
 *   as a database without one is not in a state that can be saved.
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<void>} Rejects if the database could not be saved. On an
 *   external-modification conflict the rejection has `.code === 'EXTERNAL_CONFLICT'`.
 */
export async function saveDatabase(db, fileName, { force = false } = {}) {
    const store = useStore();

    if (!db || !fileName) {
        throw new Error('Cannot save: missing database or file name');
    }

    // A path exists before any save can happen — it is what the user picked to
    // open or create the database, and it is what grants access to the file.
    // This used to fall back to a browser download instead, which in a desktop
    // webview writes nothing and yet returned as though the save had succeeded:
    // the caller cleared its unsaved-changes state over a file that was never
    // written. Refusing loudly is the only safe reading of "nowhere to save to".
    const path = store.filePath;
    if (!path) {
        throw new Error('Cannot save: the database has no file path');
    }

    const expectedMtime = force ? null : (store.knownMtime ?? null);
    const backup = store.backupEnabled !== false;
    const backupDepth = clampNumberSetting(
        store.backupDepth,
        SETTING_LIMITS.backupDepth,
    );

    // Serialize only once there is somewhere to put the result.
    const arrayBuffer = await db.save();
    const bytes = new Uint8Array(arrayBuffer);

    try {
        // The vault bytes go over as the raw IPC body; everything else rides
        // along in headers (see `invokeWithBytes`). Omitting `expected-mtime`
        // is what tells the backend to skip the concurrency check.
        const newMtime = await invokeWithBytes('save_database', bytes, {
            path,
            'expected-mtime': expectedMtime,
            backup,
            'backup-depth': backupDepth,
        });
        // Only the file the store is still tracking may have its timestamp
        // updated: recording this one against a database opened meanwhile
        // would make the next save of *that* file skip its conflict check.
        if (store.filePath === path) store.knownMtime = newMtime;
    } catch (error) {
        const message = error?.message || String(error);
        if (message.includes('EXTERNAL_CONFLICT')) {
            const conflict = new Error(message);
            conflict.code = 'EXTERNAL_CONFLICT';
            throw conflict;
        }
        throw error;
    }
}
