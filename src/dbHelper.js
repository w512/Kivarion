import { invoke } from '@tauri-apps/api/core';
import { useStore } from './store.js';

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
 * @param {kdbxweb.Kdbx} db - The database instance
 * @param {string} fileName - Name of the file (used for the download fallback)
 * @returns {Promise<void>} Rejects if the database could not be saved.
 */
export async function saveDatabase(db, fileName) {
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

    await invoke('save_database', { path: store.filePath, data: bytes });
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
