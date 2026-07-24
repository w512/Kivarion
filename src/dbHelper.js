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
 * @param {string} path
 * @param {kdbxweb.Credentials} credentials - normally `store.db.credentials`
 * @returns {Promise<kdbxweb.Kdbx>}
 */
export async function loadDatabaseFromDisk(path, credentials) {
    const bytes = await invoke('read_database', { path });
    return kdbxweb.Kdbx.load(toExactArrayBuffer(bytes), credentials);
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
