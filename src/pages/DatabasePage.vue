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
                    :groups="allGroups"
                    :selected-group-uuid="store.selectedGroupUuid"
                    :all-entries-count="totalEntriesCount"
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
                    :selected-entry-uuid="selectedEntry?.uuid?.id"
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
                    @delete="requestDelete"
                    @close="selectedEntry = null"
                />
            </aside>
        </div>

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
            :message="`“${groupToDelete?.name}” and all its entries will be deleted. This action cannot be undone.`"
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
import { getField } from '../utils';

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
    const root = store.db.getDefaultGroup();
    if (root) {
        selectedGroup.value = root;
        store.selectedGroupUuid = root.uuid?.id;
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

const selectedGroup = ref(null);
const selectedEntry = ref(null);
const searchQuery = ref('');
const showDeleteConfirm = ref(false);
const entryToDelete = ref(null);

// Group management state
const showRenameModal = ref(false);
const groupToRename = ref(null);
const newGroupName = ref('');

const showDeleteGroupConfirm = ref(false);
const groupToDelete = ref(null);
const homeDirPath = ref('');

const showSettingsModal = ref(false);

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
const { saveDatabaseChanges, addEntry: performAddEntry, addGroup: performAddGroup, isSaving, saveError } =
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

const allGroups = computed(() => {
    store.dbVersion;
    if (!store.db) return [];
    const root = store.db.getDefaultGroup();
    return root ? [root] : [];
});

const totalEntriesCount = computed(() => {
    store.dbVersion;
    if (!store.db) return 0;
    return getAllEntries(store.db.getDefaultGroup()).length;
});

const currentEntries = computed(() => {
    store.dbVersion;
    if (!selectedGroup.value) return [];

    if (selectedGroup.value.uuid?.id === 'all') {
        return getAllEntries(store.db.getDefaultGroup());
    }

    return selectedGroup.value.entries || [];
});

const STANDARD_FIELDS = ['Title', 'UserName', 'Password', 'URL', 'Notes'];

function entryMatches(entry, q) {
    if (!entry?.fields) return false;
    for (const [key, val] of entry.fields) {
        // Skip protected fields entirely (Password and any protected custom field).
        // Protected values are ProtectedValue objects; plain fields are strings.
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
    if (!q) return currentEntries.value;
    // While searching, look across the whole database, not just the selected group.
    const scope = store.db ? getAllEntries(store.db.getDefaultGroup()) : [];
    return scope.filter((entry) => entryMatches(entry, q));
});

function getAllEntries(group) {
    let entries = [];
    if (!group) return entries;

    if (store.db.meta.recycleBinUuid && group.uuid.equals(store.db.meta.recycleBinUuid)) {
        return entries;
    }

    if (group.entries) entries.push(...group.entries);
    if (group.groups) {
        for (const subgroup of group.groups) {
            entries.push(...getAllEntries(subgroup));
        }
    }
    return entries;
}

function selectGroup(group) {
    selectedGroup.value = group;
    store.selectedGroupUuid = group.uuid?.id === 'all' ? 'all' : group.uuid?.id;
    selectedEntry.value = null;
    searchQuery.value = '';
}

function selectEntry(entry) {
    selectedEntry.value = entry;
}

function addEntry() {
    performAddEntry(selectedGroup, selectedEntry);
}

function addGroup(parentGroup) {
    performAddGroup(parentGroup);
}

function requestDelete(entry) {
    entryToDelete.value = entry;
    showDeleteConfirm.value = true;
}

function confirmDelete() {
    if (!store.db || !entryToDelete.value) return;
    store.db.remove(entryToDelete.value);
    if (selectedEntry.value?.uuid?.id === entryToDelete.value.uuid?.id) {
        selectedEntry.value = null;
    }
    entryToDelete.value = null;
    showDeleteConfirm.value = false;
    store.touchDb();
    saveDatabaseChanges();
}

function cancelDelete() {
    entryToDelete.value = null;
    showDeleteConfirm.value = false;
}

function onEntryUpdated() {
    store.touchDb();
    saveDatabaseChanges();
}

function closeDatabase() {
    store.db = null;
    store.fileName = '';
    store.selectedGroupUuid = null;
    router.push({ name: 'home' });
}

function getEntryTitle(entry) {
    return getField(entry, 'Title') || 'No title';
}

// Group Actions
function requestRenameGroup(group) {
    groupToRename.value = group;
    newGroupName.value = group.name || '';
    showRenameModal.value = true;
}

function confirmRenameGroup() {
    if (!groupToRename.value) return;
    groupToRename.value.name = newGroupName.value;
    if (groupToRename.value.times) groupToRename.value.times.update();
    groupToRename.value = null;
    showRenameModal.value = false;
    saveDatabaseChanges();
}

function requestDeleteGroup(group) {
    if (group === store.db.getDefaultGroup()) return;
    groupToDelete.value = group;
    showDeleteGroupConfirm.value = true;
}

function confirmDeleteGroup() {
    if (!store.db || !groupToDelete.value) return;

    if (selectedGroup.value?.uuid?.id === groupToDelete.value.uuid?.id) {
        const root = store.db.getDefaultGroup();
        if (root) selectGroup(root);
        else {
            selectedGroup.value = null;
            store.selectedGroupUuid = null;
        }
    }

    store.db.remove(groupToDelete.value);
    groupToDelete.value = null;
    showDeleteGroupConfirm.value = false;
    store.touchDb();
    saveDatabaseChanges();
}

function cancelGroupAction() {
    showRenameModal.value = false;
    groupToRename.value = null;
    showDeleteGroupConfirm.value = false;
    groupToDelete.value = null;
}

async function confirmDatabaseSettings({ name, password }) {
    if (!store.db) return;

    if (name !== undefined) store.db.meta.name = name;
    if (password) {
        store.db.credentials.setPassword(kdbxweb.ProtectedValue.fromString(password));
    }

    showSettingsModal.value = false;
    const saved = await saveDatabaseChanges();
    store.touchDb();

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