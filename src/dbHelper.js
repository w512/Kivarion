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
 * @param {kdbxweb.Kdbx} db - The database instance
 * @param {string} fileName - Name of the file (used for the download fallback)
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<void>} Rejects if the database could not be saved. On an
 *   external-modification conflict the rejection has `.code === 'EXTERNAL_CONFLICT'`.
 */
export async function saveDatabase(db, fileName, { force = false } = {}) {
    const store = useStore();

    if (!db || !fileName) {
        throw new Error('Cannot save: missing database or file name');
    }

    // Serialize first. If this throws, nothing on disk has been touched yet.
    const arrayBuffer = await db.save();
    const bytes = new Uint8Array(arrayBuffer);

    if (!store.filePath) {
        // Fallback: download the file (web mode or no filesystem access).
        downloadFile(bytes, fileName);
        return;
    }

    try {
        // The vault bytes go over as the raw IPC body; everything else rides
        // along in headers (see `invokeWithBytes`). Omitting `expected-mtime`
        // is what tells the backend to skip the concurrency check.
        const newMtime = await invokeWithBytes('save_database', bytes, {
            path: store.filePath,
            'expected-mtime': force ? null : (store.knownMtime ?? null),
            backup: store.backupEnabled !== false,
            'backup-depth': clampNumberSetting(
                store.backupDepth,
                SETTING_LIMITS.backupDepth,
            ),
        });
        store.knownMtime = newMtime;
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

/**
 * Browser fallback: trigger a download of the serialized database.
 */
function downloadFile(bytes, fileName) {
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';

    document.body.appendChild(a);
    a.click();

    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
