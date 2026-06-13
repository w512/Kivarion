<script setup>
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import * as kdbxweb from 'kdbxweb';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store.js';
import { saveDatabase } from '../dbHelper.js';
import { toExactArrayBuffer } from '../utils.js';
import { getDefaultGroup, getObjectUuid } from '../kdbxView.js';
import RestoreBackupModal from '../components/RestoreBackupModal.vue';

const router = useRouter();
const store = useStore();

function goBack() {
    router.back();
}

// Restore is only possible with a database open (we reuse its credentials to
// load the chosen backup without re-prompting for the master password).
const canRestore = computed(() => !!store.db && !!store.filePath);

const showRestore = ref(false);
const backups = ref([]);
const restoreBusy = ref(false);
const restoreError = ref('');

async function openRestore() {
    if (!canRestore.value) return;
    restoreError.value = '';
    try {
        backups.value = await invoke('list_backups', { path: store.filePath });
    } catch (e) {
        backups.value = [];
        restoreError.value = 'Could not list backups: ' + (e?.message || e);
    }
    showRestore.value = true;
}

async function restoreBackup(backup) {
    restoreBusy.value = true;
    restoreError.value = '';
    try {
        const bytes = await invoke('read_database', { path: backup.path });
        const buffer = toExactArrayBuffer(bytes);
        // Reuse the open database's credentials; a backup from before a password
        // change will fail to load here, which we surface as an error.
        const restored = await kdbxweb.Kdbx.load(buffer, store.db.credentials);

        store.db = restored;
        const root = getDefaultGroup(restored);
        store.selectedGroupUuid = root ? getObjectUuid(root) : null;
        store.touchDb();

        // Persist the restored copy over the live file (force past the conflict
        // check — this overwrite is intentional).
        await saveDatabase(restored, store.fileName, { force: true });

        showRestore.value = false;
    } catch (e) {
        console.error('Restore failed:', e);
        restoreError.value = 'Could not restore this backup. It may use a different master password.';
    } finally {
        restoreBusy.value = false;
    }
}
</script>

<template>
    <div class="settings-page">
        <header class="settings-header">
            <button class="back-btn" @click="goBack" title="Go back">
                <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <line x1="19" y1="12" x2="5" y2="12"></line>
                    <polyline points="12 19 5 12 12 5"></polyline>
                </svg>
            </button>
            <h1>Settings</h1>
        </header>
        <div class="settings-content">
            <div class="setting-item">
                <div class="setting-info">
                    <h3>Theme</h3>
                    <p>Select your interface appearance preference</p>
                </div>
                <div class="setting-action">
                    <select v-model="store.theme" class="select-input">
                        <option value="system">System</option>
                        <option value="light">Light</option>
                        <option value="dark">Dark</option>
                    </select>
                </div>
            </div>

            <div class="setting-item">
                <div class="setting-info">
                    <h3>Clipboard Timeout</h3>
                    <p>Automatically clear clipboard after (seconds, 0 to disable)</p>
                </div>
                <div class="setting-action">
                    <input type="number" v-model.number="store.clipboardTimeout" min="0" max="600" class="number-input">
                </div>
            </div>

            <div class="setting-item">
                <div class="setting-info">
                    <h3>Auto-Lock Timeout</h3>
                    <p>Lock database after inactivity (minutes, 0 to disable)</p>
                </div>
                <div class="setting-action">
                    <input type="number" v-model.number="store.autoLockTimeout" min="0" max="1440" class="number-input">
                </div>
            </div>

            <div class="setting-item">
                <div class="setting-info">
                    <h3>Backups</h3>
                    <p>Keep rotating <code>.bak</code> copies of the database on each save</p>
                </div>
                <div class="setting-action">
                    <label class="switch">
                        <input type="checkbox" v-model="store.backupEnabled" />
                        <span class="switch-track"></span>
                    </label>
                </div>
            </div>

            <div class="setting-item" v-if="store.backupEnabled">
                <div class="setting-info">
                    <h3>Backups to keep</h3>
                    <p>Number of rotating backups retained (1–20)</p>
                </div>
                <div class="setting-action">
                    <input type="number" v-model.number="store.backupDepth" min="1" max="20" class="number-input">
                </div>
            </div>

            <div class="setting-item">
                <div class="setting-info">
                    <h3>Restore from backup</h3>
                    <p v-if="canRestore">Replace the open database with an earlier backup</p>
                    <p v-else>Open a database first to restore one of its backups</p>
                </div>
                <div class="setting-action">
                    <button class="action-button" :disabled="!canRestore" @click="openRestore">
                        Restore…
                    </button>
                </div>
            </div>
        </div>

        <RestoreBackupModal
            :show="showRestore"
            :backups="backups"
            :busy="restoreBusy"
            :error="restoreError"
            @close="showRestore = false"
            @restore="restoreBackup"
        />
    </div>
</template>

<style scoped>
.settings-page {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg-color, #0f1117);
    color: var(--text-primary, #e4e4e7);
}

.settings-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid var(--border-color, #2a2b35);
    background: var(--card-bg, #1a1b23);
}

.settings-header h1 {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0;
}

.back-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.5rem;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: var(--text-secondary, #71717a);
    cursor: pointer;
    transition: all 0.2s;
}

.back-btn:hover {
    background: var(--border-color);
    color: var(--text-primary);
}

.settings-content {
    padding: 2rem 1.5rem;
    flex: 1;
    overflow-y: auto;
}

.setting-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.5rem;
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    margin-bottom: 1rem;
}

.setting-info h3 {
    margin: 0 0 0.25rem 0;
    font-size: 1rem;
    font-weight: 500;
    color: var(--text-primary);
}

.setting-info p {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
}

.select-input,
.number-input {
    padding: 0.5rem 1rem;
    font-size: 0.875rem;
    background-color: var(--input-bg);
    color: var(--text-primary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    outline: none;
    transition: border-color 0.2s;
}

.select-input {
    padding-right: 2rem;
    cursor: pointer;
    appearance: none;
    background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
    background-repeat: no-repeat;
    background-position: right 0.5rem center;
    background-size: 1em;
}

.number-input {
    width: 80px;
    text-align: center;
}

.select-input:focus,
.number-input:focus {
    border-color: var(--accent-color);
}

.action-button {
    padding: 0.5rem 1.25rem;
    font-size: 0.85rem;
    font-weight: 600;
    background: var(--accent-color);
    color: #fff;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s, opacity 0.15s;
}

.action-button:hover:not(:disabled) {
    background: var(--accent-hover);
}

.action-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.8em;
    background: var(--badge-bg);
    padding: 0.05rem 0.3rem;
    border-radius: 4px;
}

/* Toggle switch */
.switch {
    position: relative;
    display: inline-flex;
    cursor: pointer;
}

.switch input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
}

.switch-track {
    width: 42px;
    height: 24px;
    background: var(--border-color);
    border-radius: 999px;
    transition: background 0.2s;
    position: relative;
}

.switch-track::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 18px;
    height: 18px;
    background: #fff;
    border-radius: 50%;
    transition: transform 0.2s;
}

.switch input:checked + .switch-track {
    background: var(--accent-color);
}

.switch input:checked + .switch-track::after {
    transform: translateX(18px);
}
</style>
