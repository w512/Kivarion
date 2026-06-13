import { writeFile, rename, copyFile, exists, remove } from '@tauri-apps/plugin-fs';
import { useStore } from './store.js';

/**
 * Save the database to disk.
 *
 * The write is atomic: the new contents are first written to a temporary file,
 * the current good file is backed up (`<file>.bak`), and only then is the temp
 * file renamed over the original. A crash or I/O error at any point leaves the
 * original `.kdbx` intact, so we never end up with a half-written database.
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

    const targetPath = store.filePath;
    const tmpPath = `${targetPath}.${uniqueSaveToken()}.tmp`;
    const backupPath = `${targetPath}.bak`;

    try {
        // 1. Write the new database to a temp file; the original is untouched.
        await writeFile(tmpPath, bytes);

        // 2. Back up the current good file before replacing it.
        if (await exists(targetPath)) {
            await copyFile(targetPath, backupPath);
        }

        // 3. Atomically replace the original with the temp file.
        await rename(tmpPath, targetPath);
    } catch (error) {
        // Best-effort cleanup so we don't leave a stray temp file behind.
        try {
            if (await exists(tmpPath)) await remove(tmpPath);
        } catch {
            /* ignore cleanup failures */
        }
        throw error;
    }
}

/**
 * Browser fallback: trigger a download of the serialized database.
 */
function uniqueSaveToken() {
    return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

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
