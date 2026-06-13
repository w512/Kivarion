<template>
    <div class="database-page" v-if="store.db">
        <DatabaseHeader
            :db-name="dbName"
            :file-path="displayPath"
            v-model:search="searchQuery"
            @lock="closeDatabase"
            @close="closeDatabase"
            @edit-db="showSettingsModal = true"
        />

        <!-- Save failure banner — never let a failed save go unnoticed -->
        <div v-if="saveError" class="save-error-banner" role="alert">
            <svg class="save-error-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span class="save-error-text">
                Changes could not be saved: {{ saveError }}
            </span>
            <button class="save-error-retry" @click="saveDatabaseChanges" :disabled="isSaving">
                {{ isSaving ? 'Saving…' : 'Retry' }}
            </button>
            <button class="save-error-dismiss" @click="saveError = null" title="Dismiss" aria-label="Dismiss">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
            </button>
        </div>

        <!-- Main Layout — three columns -->
        <div class="main-layout" :style="{'--sidebar-width': sidebarWidth + 'px', '--entries-width': entriesWidth + 'px'}" :class="{ 'is-resizing': isResizingSidebar || isResizingEntries }">
            <!-- Column 1: Sidebar -->
            <aside class="sidebar">
                <div class="sidebar-title">Groups</div>
                <GroupTree
                    :groups="groupTree"
                    :selected-group-uuid="store.selectedGroupUuid"
                    :all-entries-count="totalEntriesCount"
                    :refresh-key="store.dbVersion"
                    @select="selectGroup"
                    @add-group="addGroup"
                    @rename-group="requestRenameGroup"
                    @delete-group="requestDeleteGroup"
                />
            </aside>

            <!-- Resizer for Sidebar -->
            <div class="resizer" @mousedown.prevent="startResizeSidebar"></div>

            <!-- Column 2: Entry list -->
            <main class="entries-column">
                <EntryList
                    :entries="filteredEntries"
                    :selected-entry-uuid="selectedEntryUuid"
                    @select="selectEntry"
                    @add="addEntry"
                    @delete="requestDelete"
                />
            </main>

            <!-- Resizer for Entries -->
            <div class="resizer" v-if="selectedEntry" @mousedown.prevent="startResizeEntries"></div>

            <!-- Column 3: Entry detail -->
            <aside class="detail-column" v-if="selectedEntry">
                <EntryDetail
                    :entry="selectedEntry"
                    @updated="onEntryUpdated"
                    @delete="requestDelete(selectedEntry)"
                    @close="selectedEntryUuid = null"
                />
            </aside>
        </div>

        <!-- Save Error Close Confirmation -->
        <ConfirmModal
            :show="showCloseAfterSaveErrorConfirm"
            title="Close without saving?"
            :message="`The latest changes could not be saved${saveError ? ': ' + saveError : ''}. Closing now will discard unsaved changes.`"
            confirm-text="Close without saving"
            confirm-variant="danger"
            @confirm="forceCloseDatabase"
            @cancel="cancelCloseAfterSaveError"
        />

        <!-- Delete Entry Confirmation -->
        <ConfirmModal
            :show="showDeleteConfirm"
            title="Delete entry?"
            :message="`“${getEntryTitle(entryToDelete)}” will be deleted. This action cannot be undone.`"
            confirm-text="Delete"
            confirm-variant="danger"
            @confirm="confirmDelete"
            @cancel="cancelDelete"
        />

        <!-- Rename Group Modal -->
        <InputModal
            :show="showRenameModal"
            title="Rename Group"
            v-model="newGroupName"
            placeholder="Group name"
            confirm-text="Save"
            @confirm="confirmRenameGroup"
            @cancel="cancelGroupAction"
        />

        <!-- Delete Group Confirmation -->
        <ConfirmModal
            :show="showDeleteGroupConfirm"
            title="Delete group?"
            :message="`“${groupToDeleteName}” and all its entries will be deleted. This action cannot be undone.`"
            confirm-text="Delete"
            confirm-variant="danger"
            @confirm="confirmDeleteGroup"
            @cancel="cancelGroupAction"
        />

        <!-- Database Settings Modal -->
        <DatabaseSettingsModal
            :show="showSettingsModal"
            :db-name="dbName"
            @confirm="confirmDatabaseSettings"
            @cancel="showSettingsModal = false"
        />
    </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import * as kdbxweb from 'kdbxweb';
import { useStore } from '../store.js';
import { homeDir } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { getField, isProtectedValue, STANDARD_FIELDS } from '../utils';
import {
    ALL_ENTRIES_UUID,
    findEntryByUuid,
    findGroupByUuid,
    getAllEntries,
    getDefaultGroup,
    getObjectUuid,
    groupContainsEntryUuid,
    groupContainsGroupUuid,
    toEntryListItem,
    toGroupTreeNode,
} from '../kdbxView.js';

// Components
import GroupTree from '../components/GroupTree.vue';
import EntryList from '../components/EntryList.vue';
import EntryDetail from '../components/EntryDetail.vue';
import DatabaseHeader from '../components/DatabaseHeader.vue';
import ConfirmModal from '../components/ConfirmModal.vue';
import InputModal from '../components/InputModal.vue';
import DatabaseSettingsModal from '../components/DatabaseSettingsModal.vue';

// Composables
import { useResizable } from '../composables/useResizable.js';
import { useDatabaseActions } from '../composables/useDatabaseActions.js';

const router = useRouter();
const store = useStore();

onMounted(() => {
    if (!store.db) {
        router.replace({ name: 'home' });
        return;
    }
    // Select root group by default
    const root = getDefaultGroup(store.db);
    if (root) {
        store.selectedGroupUuid = getObjectUuid(root);
    }

    // Get home directory for path display
    homeDir().then(dir => {
        homeDirPath.value = dir;
    });

    // Auto-lock init
    resetLockTimer();
    window.addEventListener('mousemove', onActivity);
    window.addEventListener('keydown', onActivity);
    window.addEventListener('mousedown', onActivity);
});

onUnmounted(() => {
    if (lockTimer) clearTimeout(lockTimer);
    window.removeEventListener('mousemove', onActivity);
    window.removeEventListener('keydown', onActivity);
    window.removeEventListener('mousedown', onActivity);
});

const selectedEntryUuid = ref(null);
const searchQuery = ref('');
const showDeleteConfirm = ref(false);
const entryToDeleteUuid = ref(null);

// Group management state
const showRenameModal = ref(false);
const groupToRenameUuid = ref(null);
const newGroupName = ref('');

const showDeleteGroupConfirm = ref(false);
const groupToDeleteUuid = ref(null);
const groupToDeleteName = computed(() => getGroupName(groupToDeleteUuid.value));
const homeDirPath = ref('');

const showSettingsModal = ref(false);
const showCloseAfterSaveErrorConfirm = ref(false);

let lockTimer = null;
function resetLockTimer() {
    if (lockTimer) clearTimeout(lockTimer);
    if (store.autoLockTimeout > 0) {
        lockTimer = setTimeout(() => {
            closeDatabase();
        }, store.autoLockTimeout * 60 * 1000);
    }
}

// Throttle activity so we don't tear down and recreate the timer on every
// single mousemove. Resetting once every few seconds is plenty for an
// inactivity timeout measured in minutes.
const ACTIVITY_THROTTLE_MS = 2000;
let lastActivity = 0;
function onActivity() {
    const now = Date.now();
    if (now - lastActivity < ACTIVITY_THROTTLE_MS) return;
    lastActivity = now;
    resetLockTimer();
}

watch(() => store.autoLockTimeout, resetLockTimer);

// Column widths logic
const { width: sidebarWidth, isResizing: isResizingSidebar, startResize: startResizeSidebar } = 
    useResizable('kivarion_sidebarWidth', 220, 150, 600);

const { width: entriesWidth, isResizing: isResizingEntries, startResize: startResizeEntries } = 
    useResizable('kivarion_entriesWidth', 300, 200, 800, sidebarWidth);

// Database Actions logic
const { saveDatabaseChanges, addEntry: performAddEntry, addGroup: performAddGroup, isSaving, saveError, hasUnsavedChanges } =
    useDatabaseActions(store);

const dbName = computed(() => {
    store.dbVersion;
    return store.db?.meta?.name || 'Unnamed';
});

const displayPath = computed(() => {
    const fp = store.filePath;
    if (!fp) return '';
    const hd = homeDirPath.value;
    if (hd && fp.startsWith(hd)) {
        return '~' + fp.slice(hd.length);
    }
    return fp;
});

const rootGroup = computed(() => {
    store.dbVersion;
    return getDefaultGroup(store.db);
});

const groupTree = computed(() => {
    const root = rootGroup.value;
    return root ? [toGroupTreeNode(root)] : [];
});

const selectedGroup = computed(() => {
    store.dbVersion;
    if (!store.db || !store.selectedGroupUuid) return null;
    if (store.selectedGroupUuid === ALL_ENTRIES_UUID) return { uuid: ALL_ENTRIES_UUID };
    return findGroupByUuid(store.db, store.selectedGroupUuid);
});

const selectedEntry = computed(() => {
    store.dbVersion;
    return findEntryByUuid(store.db, selectedEntryUuid.value);
});

const entryToDelete = computed(() => {
    store.dbVersion;
    return findEntryByUuid(store.db, entryToDeleteUuid.value);
});

const totalEntriesCount = computed(() => {
    store.dbVersion;
    if (!store.db) return 0;
    return getAllEntries(store.db).length;
});

const currentRawEntries = computed(() => {
    store.dbVersion;
    if (!store.db || !selectedGroup.value) return [];

    if (store.selectedGroupUuid === ALL_ENTRIES_UUID) {
        return getAllEntries(store.db);
    }

    return selectedGroup.value.entries || [];
});

function entryMatches(entry, q) {
    if (!entry?.fields) return false;
    for (const [key, val] of entry.fields) {
        // Skip protected fields entirely (Password and any protected custom field).
        if (isProtectedValue(val)) continue;
        if (typeof val !== 'string') continue;
        // For custom fields the field name itself is user content — match it too.
        if (!STANDARD_FIELDS.includes(key) && key.toLowerCase().includes(q)) return true;
        if (val.toLowerCase().includes(q)) return true;
    }
    return false;
}

const filteredEntries = computed(() => {
    store.dbVersion;
    const q = searchQuery.value.trim().toLowerCase();
    const rawEntries = q
        ? getAllEntries(store.db).filter((entry) => entryMatches(entry, q))
        : currentRawEntries.value;

    return rawEntries.map(entry => toEntryListItem(entry, store.db));
});

function selectGroup(groupUuid) {
    store.selectedGroupUuid = groupUuid;
    selectedEntryUuid.value = null;
    searchQuery.value = '';
}

function selectEntry(entryUuid) {
    selectedEntryUuid.value = entryUuid;
}

function addEntry() {
    const entryUuid = performAddEntry(store.selectedGroupUuid);
    if (entryUuid) selectedEntryUuid.value = entryUuid;
}

function addGroup(parentGroupUuid) {
    const groupUuid = performAddGroup(parentGroupUuid);
    if (groupUuid) store.selectedGroupUuid = groupUuid;
}

function requestDelete(entryOrUuid) {
    const uuid = typeof entryOrUuid === 'string' ? entryOrUuid : getObjectUuid(entryOrUuid);
    if (!uuid) return;
    entryToDeleteUuid.value = uuid;
    showDeleteConfirm.value = true;
}

function confirmDelete() {
    const entry = entryToDelete.value;
    if (!store.db || !entry) return;

    store.db.remove(entry);
    if (selectedEntryUuid.value === entryToDeleteUuid.value) {
        selectedEntryUuid.value = null;
    }
    entryToDeleteUuid.value = null;
    showDeleteConfirm.value = false;
    store.touchDb();
    saveDatabaseChanges();
}

function cancelDelete() {
    entryToDeleteUuid.value = null;
    showDeleteConfirm.value = false;
}

function onEntryUpdated() {
    store.touchDb();
    saveDatabaseChanges();
}

async function closeDatabase() {
    if (!await ensureSavedBeforeClose()) {
        showCloseAfterSaveErrorConfirm.value = true;
        return;
    }

    forceCloseDatabase();
}

function forceCloseDatabase() {
    showCloseAfterSaveErrorConfirm.value = false;
    store.db = null;
    store.fileName = '';
    store.selectedGroupUuid = null;
    selectedEntryUuid.value = null;
    router.push({ name: 'home' });
}

function cancelCloseAfterSaveError() {
    showCloseAfterSaveErrorConfirm.value = false;
}

async function ensureSavedBeforeClose() {
    if (!store.db) return true;
    if (!isSaving.value && !hasUnsavedChanges.value) return true;

    const saved = await saveDatabaseChanges();
    return saved && !hasUnsavedChanges.value;
}

function getEntryTitle(entry) {
    return getField(entry, 'Title') || 'No title';
}

// Group Actions
function requestRenameGroup(groupUuid) {
    const group = findGroupByUuid(store.db, groupUuid);
    if (!group) return;

    groupToRenameUuid.value = groupUuid;
    newGroupName.value = group.name || '';
    showRenameModal.value = true;
}

function confirmRenameGroup() {
    const group = findGroupByUuid(store.db, groupToRenameUuid.value);
    if (!group) return;

    group.name = newGroupName.value;
    if (group.times) group.times.update();
    store.touchDb();
    groupToRenameUuid.value = null;
    showRenameModal.value = false;
    saveDatabaseChanges();
}

function requestDeleteGroup(groupUuid) {
    const root = rootGroup.value;
    if (!store.db || !groupUuid || groupUuid === getObjectUuid(root)) return;

    groupToDeleteUuid.value = groupUuid;
    showDeleteGroupConfirm.value = true;
}

function confirmDeleteGroup() {
    const group = findGroupByUuid(store.db, groupToDeleteUuid.value);
    if (!store.db || !group) return;

    if (groupContainsGroupUuid(group, store.selectedGroupUuid)) {
        const root = rootGroup.value;
        store.selectedGroupUuid = getObjectUuid(root);
    }
    if (groupContainsEntryUuid(group, selectedEntryUuid.value)) {
        selectedEntryUuid.value = null;
    }

    store.db.remove(group);
    groupToDeleteUuid.value = null;
    showDeleteGroupConfirm.value = false;
    store.touchDb();
    saveDatabaseChanges();
}

function cancelGroupAction() {
    showRenameModal.value = false;
    groupToRenameUuid.value = null;
    showDeleteGroupConfirm.value = false;
    groupToDeleteUuid.value = null;
}

function getGroupName(groupUuid) {
    if (!groupUuid) return '';
    if (groupUuid === ALL_ENTRIES_UUID) return 'All Entries';
    return findGroupByUuid(store.db, groupUuid)?.name || '';
}

async function confirmDatabaseSettings({ name, password }) {
    if (!store.db) return;

    if (name !== undefined) store.db.meta.name = name;
    if (password) {
        store.db.credentials.setPassword(kdbxweb.ProtectedValue.fromString(password));
    }

    store.touchDb();
    showSettingsModal.value = false;
    const saved = await saveDatabaseChanges();

    // If the master password changed, the stored biometric secret is now stale.
    // Update it (or drop it) so Touch ID doesn't keep unlocking with the old password.
    if (saved && password && store.filePath &&
        localStorage.getItem(`kivarion-biometrics-${store.filePath}`) === 'true') {
        try {
            await invoke('save_biometric_password', { id: store.filePath, pass: password });
        } catch (e) {
            console.error('Failed to update biometric password, removing it:', e);
            try { await invoke('delete_biometric_password', { id: store.filePath }); } catch {}
            localStorage.removeItem(`kivarion-biometrics-${store.filePath}`);
        }
    }
}
</script>


<style scoped>
.database-page {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
}

/* Save failure banner */
.save-error-banner {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.6rem 0.9rem;
    background: rgba(239, 68, 68, 0.12);
    border-bottom: 1px solid var(--error-color);
    color: var(--error-color);
    font-size: 0.85rem;
    flex-shrink: 0;
}

.save-error-icon {
    flex-shrink: 0;
}

.save-error-text {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
}

.save-error-retry {
    padding: 0.3rem 0.8rem;
    border-radius: 6px;
    border: none;
    background: var(--error-color);
    color: #fff;
    font-weight: 600;
    font-size: 0.8rem;
    cursor: pointer;
    flex-shrink: 0;
}

.save-error-retry:disabled {
    opacity: 0.6;
    cursor: default;
}

.save-error-dismiss {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.25rem;
    border: none;
    background: transparent;
    color: var(--error-color);
    cursor: pointer;
    border-radius: 4px;
    flex-shrink: 0;
}

.save-error-dismiss:hover {
    background: rgba(239, 68, 68, 0.18);
}

/* Main layout */
.main-layout {
    display: flex;
    flex: 1;
    overflow: hidden;
}

.main-layout.is-resizing {
    user-select: none;
    cursor: col-resize;
}

.resizer {
    width: 4px;
    cursor: col-resize;
    background: transparent;
    transition: background 0.2s;
    z-index: 10;
    margin: 0 -2px; /* Overlap borders to make target bigger */
    position: relative;
}

.resizer:hover, .resizer:active {
    background: var(--accent-color);
}

/* Sidebar */
.sidebar {
    width: var(--sidebar-width, 220px);
    min-width: 150px;
    border-right: 1px solid var(--border-color);
    background: var(--card-bg);
    overflow-y: auto;
    padding: 0.75rem 0.5rem;
}

.sidebar-title {
    font-size: 0.65rem;
    font-weight: 700;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 0.25rem 0.6rem;
    margin-bottom: 0.25rem;
}

/* Entries column */
.entries-column {
    width: var(--entries-width, 300px);
    min-width: 200px;
    border-right: 1px solid var(--border-color);
    background: var(--card-bg);
    overflow-y: auto;
    padding: 0.5rem;
}

/* Detail column */
.detail-column {
    flex: 1;
    overflow-y: auto;
    padding: 0 0.75rem 1rem;
}
</style>