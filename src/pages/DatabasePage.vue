<template>
    <div v-if="store.db" class="database-page">
        <DatabaseHeader
            ref="headerRef"
            v-model:search="searchQuery"
            :db-name="dbName"
            :file-path="displayPath"
            @lock="lockDatabaseFromHeader"
            @close="closeAndForgetDatabase"
            @edit-db="openDatabaseSettings"
        />

        <!-- Save failure banner — never let a failed save go unnoticed -->
        <div v-if="saveError" class="save-error-banner" role="alert">
            <svg
                class="save-error-icon"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
            >
                <path
                    d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
                />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span class="save-error-text">
                Changes could not be saved: {{ saveError }}
            </span>
            <button
                class="save-error-retry"
                :disabled="isSaving"
                @click="saveDatabaseChanges"
            >
                {{ isSaving ? 'Saving…' : 'Retry' }}
            </button>
            <button
                class="save-error-dismiss"
                title="Dismiss"
                aria-label="Dismiss"
                @click="saveError = null"
            >
                <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
            </button>
        </div>

        <!-- Main Layout — three columns -->
        <div
            class="main-layout"
            :style="{
                '--sidebar-width': sidebarWidth + 'px',
                '--entries-width': entriesWidth + 'px',
            }"
            :class="{ 'is-resizing': isResizingSidebar || isResizingEntries }"
        >
            <!-- Column 1: Sidebar -->
            <aside class="sidebar">
                <div class="sidebar-title">Groups</div>
                <GroupTree
                    v-model:collapsed-groups="collapsedGroups"
                    :groups="groupTree"
                    :selected-group-uuid="store.selectedGroupUuid"
                    :all-entries-count="totalEntriesCount"
                    :refresh-key="store.dbVersion"
                    @select="selectGroup"
                    @add-group="addGroup"
                    @rename-group="requestRenameGroup"
                    @delete-group="requestDeleteGroup"
                    @restore-group="restoreGroup"
                    @empty-recycle-bin="requestEmptyRecycleBin"
                    @move-group="moveGroup"
                    @move-entry="moveEntry"
                />
            </aside>

            <!-- Resizer for Sidebar -->
            <div
                class="resizer"
                @pointerdown.prevent="startResizeSidebar"
            ></div>

            <!-- Column 2: Entry list -->
            <main class="entries-column">
                <EntryList
                    :entries="filteredEntries"
                    :selected-entry-uuid="selectedEntryUuid"
                    :can-restore="selectedGroupIsInRecycleBin"
                    @select="selectEntry"
                    @add="addEntry"
                    @restore="restoreEntry"
                />
            </main>

            <!-- Resizer for Entries -->
            <div
                v-if="selectedEntry"
                class="resizer"
                @pointerdown.prevent="startResizeEntries"
            ></div>

            <!-- Column 3: Entry detail -->
            <aside v-if="selectedEntry" class="detail-column">
                <EntryDetail
                    ref="entryDetailRef"
                    :entry="selectedEntry"
                    @updated="onEntryUpdated"
                    @delete="requestDelete(selectedEntry)"
                    @close="requestCloseEntryDetail"
                />
            </aside>
        </div>

        <!-- Unsaved Edit Confirmation -->
        <div
            v-if="showUnsavedEditConfirm"
            class="modal-overlay"
            @click="continueEditing"
        >
            <div class="modal-card unsaved-modal" @click.stop>
                <h3>Unsaved changes</h3>
                <p>
                    You have unsaved changes in the current entry. What would
                    you like to do?
                </p>
                <div class="modal-actions modal-actions--stacked">
                    <button
                        class="confirm-btn"
                        @click="saveUnsavedEditAndContinue"
                    >
                        Save and continue
                    </button>
                    <button
                        class="danger-btn"
                        @click="discardUnsavedEditAndContinue"
                    >
                        Discard changes
                    </button>
                    <button class="cancel-btn" @click="continueEditing">
                        Continue editing
                    </button>
                </div>
            </div>
        </div>

        <!-- Closing while an auto-save is still writing to disk -->
        <ConfirmModal
            :show="showClosingSaveModal"
            title="Saving changes…"
            message="The latest changes are still being written to the database file. The window will close automatically once saving finishes."
            confirm-text="Close anyway"
            confirm-variant="danger"
            cancel-text="Keep open"
            @confirm="confirmCloseWithoutWaiting"
            @cancel="cancelClosingSave"
        />

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
            :title="
                entryDeleteIsPermanent
                    ? 'Delete entry?'
                    : 'Move entry to Recycle Bin?'
            "
            :message="entryDeleteMessage"
            :confirm-text="
                entryDeleteIsPermanent ? 'Delete' : 'Move to Recycle Bin'
            "
            confirm-variant="danger"
            @confirm="confirmDelete"
            @cancel="cancelDelete"
        />

        <!-- Rename Group Modal -->
        <InputModal
            v-model="newGroupName"
            :show="showRenameModal"
            title="Rename Group"
            placeholder="Group name"
            confirm-text="Save"
            :error="groupNameError"
            :confirm-disabled="!newGroupName.trim()"
            @confirm="confirmRenameGroup"
            @cancel="cancelGroupAction"
        />

        <!-- Delete Group Confirmation -->
        <ConfirmModal
            :show="showDeleteGroupConfirm"
            :title="
                groupDeleteIsPermanent
                    ? 'Delete group?'
                    : 'Move group to Recycle Bin?'
            "
            :message="groupDeleteMessage"
            :confirm-text="
                groupDeleteIsPermanent ? 'Delete' : 'Move to Recycle Bin'
            "
            confirm-variant="danger"
            @confirm="confirmDeleteGroup"
            @cancel="cancelGroupAction"
        />

        <!-- Empty Recycle Bin Confirmation -->
        <ConfirmModal
            :show="showEmptyRecycleBinConfirm"
            title="Empty Recycle Bin?"
            message="All items in the Recycle Bin will be permanently deleted. This action cannot be undone."
            confirm-text="Empty"
            confirm-variant="danger"
            @confirm="confirmEmptyRecycleBin"
            @cancel="cancelGroupAction"
        />

        <!-- External Modification Conflict -->
        <div v-if="saveConflict" class="modal-overlay" @click="dismissConflict">
            <div class="modal-card unsaved-modal" @click.stop>
                <h3>File changed on disk</h3>
                <p>
                    This database was modified by another program (or another
                    Kivarion window) since you opened it. Keeping your version
                    overwrites those changes; keeping the file discards
                    everything you changed here since the last successful save.
                </p>
                <p v-if="conflictDiskTime" class="conflict-meta">
                    Version on disk was written {{ conflictDiskTime }}.
                </p>
                <div class="modal-actions modal-actions--stacked">
                    <button
                        class="danger-btn"
                        :disabled="isReloading"
                        @click="overwriteOnConflict"
                    >
                        Keep my version (overwrite the file)
                    </button>
                    <button
                        class="danger-btn"
                        :disabled="isReloading"
                        @click="reloadFromConflict"
                    >
                        {{
                            isReloading
                                ? 'Reloading…'
                                : 'Keep the file (discard my changes)'
                        }}
                    </button>
                    <button
                        class="cancel-btn"
                        :disabled="isReloading"
                        @click="dismissConflict"
                    >
                        Decide later
                    </button>
                </div>
            </div>
        </div>

        <!-- Database Settings Modal -->
        <DatabaseSettingsModal
            :show="showSettingsModal"
            :db-name="dbName"
            :key-file-path="currentKeyFilePath"
            :busy="settingsBusy"
            :error="settingsError"
            @confirm="confirmDatabaseSettings"
            @clear-error="settingsError = ''"
            @cancel="closeDatabaseSettings"
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
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { formatDate, getField, toExactArrayBuffer } from '../utils';
import { buildUpdatedCredentials } from '../dbHelper.js';
import { isAnyModalOpen } from '../modalState.js';
import {
    biometricPreferenceKey,
    collapsedGroupsPreferenceKey,
    pruneCollapsedGroups,
} from '../databasePreferences.js';
import {
    ALL_ENTRIES_UUID,
    buildDatabaseView,
    collectGroupUuids,
    deleteMovesToRecycleBin,
    findEntryByUuid,
    findGroupByUuid,
    getDefaultGroup,
    getObjectUuid,
    getRecycleBinGroup,
    getRestoreTargetGroup,
    groupContainsEntryUuid,
    groupContainsGroupUuid,
    groupNameExistsInParent,
    isObjectInRecycleBin,
    isRecycleBinGroup,
    normalizeGroupName,
    resolveGroupMove,
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
import { lockDatabase } from '../composables/useDatabaseLock.js';
import {
    readKeyFilePreference,
    writeKeyFilePreference,
} from '../composables/useDatabaseAuth.js';
import { useClipboard } from '../composables/useClipboard.js';
import { withSystemInteraction } from '../composables/useSystemInteraction.js';

const router = useRouter();
const store = useStore();

// Data URLs are expensive to build for large custom icons. Keep one cache for
// the lifetime of this open database and explicitly discard it on lock/reload.
const customIconDataUrls = new Map();

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
    homeDir().then((dir) => {
        homeDirPath.value = dir;
    });

    window.addEventListener('kivarion:before-lock', prepareForForcedLock);
    window.addEventListener('keydown', onGlobalShortcut);
    void setupTeardownGuards();
});

onUnmounted(() => {
    window.removeEventListener('kivarion:before-lock', prepareForForcedLock);
    window.removeEventListener('keydown', onGlobalShortcut);
    unlistenCloseRequested?.();
    unlistenCloseRequested = null;
    unlistenQuitRequested?.();
    unlistenQuitRequested = null;
    clearTimeout(searchDebounceTimer);
    customIconDataUrls.clear();
});

// Native teardown guards: a window close (red button / Cmd+W) or an app quit
// (Cmd+Q — surfaced by the backend as `kivarion:quit-requested`, since it
// bypasses close-requested) would otherwise kill the process while an
// auto-save is still in flight or an entry edit is pending — the same data
// the in-app Close button already guards against losing.
//
// While this listener exists, Tauri no longer closes the window itself: the
// API wrapper finalizes an unprevented close by calling `destroy()`, so the
// capability must grant `core:window:allow-destroy` or the close button
// silently stops working.
let pendingTeardownFinish = null;
let unlistenCloseRequested = null;
let unlistenQuitRequested = null;

async function setupTeardownGuards() {
    unlistenCloseRequested = await getCurrentWindow().onCloseRequested(
        (event) => {
            if (guardTeardown(closeGuardedWindow)) event.preventDefault();
        },
    );
    unlistenQuitRequested = await listen('kivarion:quit-requested', () => {
        if (!guardTeardown(quitApp)) quitApp();
    });
}

// Flush pending work, then run `finish` (close the window or exit the app).
// Returns false when nothing needed guarding and `finish` was not called.
function guardTeardown(finish) {
    const hasDraft = entryDetailRef.value?.hasUnsavedChanges?.() ?? false;
    if (!hasDraft && !isSaving.value && !hasUnsavedChanges.value) {
        return false;
    }
    requestNavigation(() => finishAfterFlush(finish));
    return true;
}

// Wait for the save queue to drain behind a visible "Saving changes…" modal —
// a silent wait looks like a frozen app (saving a large vault takes seconds).
// Runs `finish` when the flush succeeds (or immediately if nothing is
// pending); a failed flush falls through to the save-error confirmation.
function finishAfterFlush(finish) {
    if (!isSaving.value && !hasUnsavedChanges.value) {
        finish();
        return;
    }
    pendingTeardownFinish = finish;
    showClosingSaveModal.value = true;
    void saveDatabaseChanges().then((saved) => {
        // The user may have clicked "Close anyway" / "Keep open" meanwhile.
        if (pendingTeardownFinish !== finish || !showClosingSaveModal.value) {
            return;
        }
        showClosingSaveModal.value = false;
        if (saved) {
            pendingTeardownFinish = null;
            finish();
        } else if (!saveConflict.value) {
            // On a conflict the dedicated modal is already up and offers the
            // real choices; stacking "Close without saving?" on top of it would
            // hide the cause behind a message that never names it. That modal
            // resumes the teardown through `resumePendingTeardown`.
            showCloseAfterSaveErrorConfirm.value = true;
        }
    });
}

// Continue a close/quit that was parked while the user resolved a conflict.
// Routed back through `finishAfterFlush` so a still-unsaved database gets the
// same treatment it would have had, instead of closing with changes pending.
function resumePendingTeardown() {
    const finish = pendingTeardownFinish;
    if (!finish) return;
    pendingTeardownFinish = null;
    finishAfterFlush(finish);
}

function confirmCloseWithoutWaiting() {
    const finish = pendingTeardownFinish;
    pendingTeardownFinish = null;
    showClosingSaveModal.value = false;
    finish?.();
}

function cancelClosingSave() {
    pendingTeardownFinish = null;
    showClosingSaveModal.value = false;
}

function closeGuardedWindow() {
    // destroy() rather than close(): the flush already ran, and close() would
    // re-enter the close-requested guard above.
    void getCurrentWindow().destroy();
}

function quitApp() {
    void invoke('quit_app');
}

const selectedEntryUuid = ref(null);
const entryDetailRef = ref(null);
const headerRef = ref(null);
const searchQuery = ref('');
const debouncedSearchQuery = ref('');
let searchDebounceTimer = null;
const showDeleteConfirm = ref(false);
const entryToDeleteUuid = ref(null);

// Group management state
const showRenameModal = ref(false);
const groupToRenameUuid = ref(null);
const newGroupName = ref('');
const groupNameError = ref('');

const showDeleteGroupConfirm = ref(false);
const showEmptyRecycleBinConfirm = ref(false);
const groupToDeleteUuid = ref(null);
const groupToDeleteName = computed(() => getGroupName(groupToDeleteUuid.value));
const groupDeleteIsPermanent = computed(() => {
    const group = findGroupByUuid(store.db, groupToDeleteUuid.value);
    return !deleteMovesToRecycleBin(store.db, group);
});
const groupDeleteMessage = computed(() =>
    groupDeleteIsPermanent.value
        ? `“${groupToDeleteName.value}” and all its contents will be permanently deleted. This action cannot be undone.`
        : `“${groupToDeleteName.value}” and all its contents will be moved to the Recycle Bin. You can restore the group later.`,
);
const homeDirPath = ref('');

const showSettingsModal = ref(false);
const settingsBusy = ref(false);
const settingsError = ref('');
const showCloseAfterSaveErrorConfirm = ref(false);
const showClosingSaveModal = ref(false);
const showUnsavedEditConfirm = ref(false);
const pendingNavigation = ref(null);
const pendingForceCloseForgetFile = ref(false);
const collapsedGroups = ref({});
const { copy: copyToClipboard } = useClipboard();

function prepareForForcedLock() {
    // Runs synchronously from the `kivarion:before-lock` dispatch, i.e. while
    // `store.db` is still set: a debounced auto-save must be started here or
    // auto-lock silently loses the mutation that was waiting for it.
    void flushPendingSave();
    entryDetailRef.value?.discardPendingEdit?.();
    pendingNavigation.value = null;
    pendingTeardownFinish = null;
    showUnsavedEditConfirm.value = false;
    showCloseAfterSaveErrorConfirm.value = false;
    showClosingSaveModal.value = false;
    showDeleteConfirm.value = false;
    showRenameModal.value = false;
    showDeleteGroupConfirm.value = false;
    showEmptyRecycleBinConfirm.value = false;
    showSettingsModal.value = false;
    settingsBusy.value = false;
    settingsError.value = '';
    selectedEntryUuid.value = null;
    customIconDataUrls.clear();
}

function isEditableTarget(target) {
    const tag = target?.tagName?.toLowerCase();
    return tag === 'input' || tag === 'textarea' || target?.isContentEditable;
}

// Whether the user has text selected on the page. Detail fields (notes, URL,
// custom fields) are plain selectable text, so hijacking Cmd+C there would both
// break an ordinary copy and silently put the password in the clipboard when
// the user meant to copy something else entirely.
function hasTextSelection() {
    return !!window.getSelection?.()?.toString();
}

function onGlobalShortcut(event) {
    // `key` is absent on some IME and synthetic events, and `.toLowerCase()` on
    // undefined throws — inside a `keydown` listener, which swallows nothing.
    const key =
        typeof event.key === 'string' ? event.key.toLowerCase() : undefined;
    if (!key) return;

    // A dialog is a decision the user is in the middle of: firing a shortcut
    // now acts on the page behind it, where the result is not even visible.
    // `isAnyModalOpen` covers `EntryDetail`'s attachment dialogs too, and the
    // conflict overlay is its own check because it is not a `BaseModal`.
    if (isAnyModalOpen() || saveConflict.value) return;

    const mod = event.metaKey || event.ctrlKey;
    if (!mod && key !== 'escape') return;

    if (mod && key === 'f') {
        event.preventDefault();
        headerRef.value?.focusSearch?.();
    } else if (mod && key === 'n' && !isEditableTarget(event.target)) {
        event.preventDefault();
        addEntry();
    } else if (mod && key === 'l') {
        event.preventDefault();
        lockDatabaseFromHeader();
    } else if (
        mod &&
        key === 'b' &&
        selectedEntry.value &&
        !isEditableTarget(event.target)
    ) {
        event.preventDefault();
        copyToClipboard(
            getField(selectedEntry.value, 'UserName'),
            'shortcut-username',
        );
    } else if (
        mod &&
        key === 'c' &&
        selectedEntry.value &&
        !isEditableTarget(event.target) &&
        !hasTextSelection()
    ) {
        event.preventDefault();
        copyToClipboard(
            getField(selectedEntry.value, 'Password'),
            'shortcut-password',
            {
                autoClear: true,
            },
        );
    } else if (key === 'escape') {
        if (searchQuery.value) searchQuery.value = '';
        else if (selectedEntryUuid.value) requestCloseEntryDetail();
    }
}

watch(newGroupName, () => {
    groupNameError.value = '';
});

// Keep typing responsive: the input updates immediately, while the full-vault
// search runs only after a short pause. Clearing remains instant.
watch(searchQuery, (value) => {
    clearTimeout(searchDebounceTimer);
    if (!value.trim()) {
        debouncedSearchQuery.value = '';
        return;
    }
    searchDebounceTimer = setTimeout(() => {
        debouncedSearchQuery.value = value;
    }, 150);
});

watch(
    () => store.db,
    () => customIconDataUrls.clear(),
);

function collapsedGroupsStorageKey(path = store.filePath) {
    return path ? collapsedGroupsPreferenceKey(path) : null;
}

function loadCollapsedGroups() {
    const key = collapsedGroupsStorageKey();
    if (!key) {
        collapsedGroups.value = {};
        return;
    }

    let stored;
    try {
        stored = JSON.parse(localStorage.getItem(key) || '{}');
    } catch {
        stored = null;
    }

    // Groups deleted since the last session would otherwise keep their entry
    // forever. Only prune against the tree when there is one to check: this
    // also runs while a database is being closed, and an empty tree must not
    // be read as "every group is gone". The pruned map is written straight
    // back by the watcher below.
    collapsedGroups.value = pruneCollapsedGroups(
        stored,
        store.db ? collectGroupUuids(store.db) : null,
    );
}

watch(() => store.filePath, loadCollapsedGroups, { immediate: true });
// Not `deep`: GroupTree replaces the map instead of mutating it, so the ref
// itself changes on every toggle.
watch(collapsedGroups, (value) => {
    const key = collapsedGroupsStorageKey();
    if (key) localStorage.setItem(key, JSON.stringify(value));
});

// Column widths logic.
//
// The `reserve` values are what the columns to the right of each divider need
// at minimum (the CSS min-widths below, plus the 4px dividers), so dragging one
// column wide in a narrow window cannot push the others off screen.
const RESIZER_WIDTH = 4;
const ENTRIES_MIN_WIDTH = 200;
const DETAIL_MIN_WIDTH = 260;

const {
    width: sidebarWidth,
    isResizing: isResizingSidebar,
    startResize: startResizeSidebar,
} = useResizable('kivarion-sidebar-width', 220, {
    minWidth: 150,
    maxWidth: 600,
    legacyKeys: ['kivarion_sidebarWidth'],
    reserve: ENTRIES_MIN_WIDTH + DETAIL_MIN_WIDTH + RESIZER_WIDTH * 2,
});

const {
    width: entriesWidth,
    isResizing: isResizingEntries,
    startResize: startResizeEntries,
} = useResizable('kivarion-entries-width', 300, {
    minWidth: ENTRIES_MIN_WIDTH,
    maxWidth: 800,
    offsetSource: sidebarWidth,
    legacyKeys: ['kivarion_entriesWidth'],
    reserve: DETAIL_MIN_WIDTH + RESIZER_WIDTH,
});

// Database Actions logic
const {
    saveDatabaseChanges,
    flushPendingSave,
    reloadDatabaseFromDisk,
    rememberCredentialsOnDisk,
    addEntry: performAddEntry,
    addGroup: performAddGroup,
    isSaving,
    isReloading,
    saveError,
    saveConflict,
    conflictDiskMtime,
    hasUnsavedChanges,
} = useDatabaseActions(store);

const conflictDiskTime = computed(() =>
    conflictDiskMtime.value
        ? formatDate(new Date(conflictDiskMtime.value))
        : '',
);

// The conflict modal is a decision point that a close/quit can be waiting on,
// so each of its outcomes has to either resume that teardown or cancel it.
async function overwriteOnConflict() {
    saveConflict.value = false;
    await saveDatabaseChanges({ force: true });
    resumePendingTeardown();
}

async function reloadFromConflict() {
    // The reload swaps the entire object graph; a half-typed entry draft would
    // otherwise be written back onto the freshly loaded entry.
    entryDetailRef.value?.discardPendingEdit?.();

    if (!(await reloadDatabaseFromDisk())) {
        // The reason is on the error banner — leave the choice on screen.
        return;
    }

    restoreSelectionAfterReload();
    resumePendingTeardown();
}

function dismissConflict() {
    saveConflict.value = false;
    // A close/quit that was waiting on this decision is cancelled with it.
    pendingTeardownFinish = null;
}

// UUIDs survive a reload, but the selected group or entry may not exist in the
// version that was on disk.
function restoreSelectionAfterReload() {
    if (
        store.selectedGroupUuid !== ALL_ENTRIES_UUID &&
        !findGroupByUuid(store.db, store.selectedGroupUuid)
    ) {
        store.selectedGroupUuid = getObjectUuid(rootGroup.value);
    }
    if (!findEntryByUuid(store.db, selectedEntryUuid.value)) {
        selectedEntryUuid.value = null;
    }
}

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

// The key file associated with the open database. Lives in the backend (it is
// tied to a filesystem grant), so it is loaded once per file instead of being
// read synchronously in a computed.
const currentKeyFilePath = ref(null);

watch(
    () => store.filePath,
    async (path) => {
        currentKeyFilePath.value = path
            ? await readKeyFilePreference(path)
            : null;
    },
    { immediate: true },
);

const rootGroup = computed(() => {
    store.dbVersion;
    return getDefaultGroup(store.db);
});

const databaseView = computed(() => {
    // KDBX objects retain their identity across edits, so dbVersion is the
    // explicit invalidation key for the whole lightweight view/search index.
    store.dbVersion;
    return buildDatabaseView(store.db, customIconDataUrls);
});

const groupTree = computed(() => databaseView.value.groupTree);

const selectedGroup = computed(() => {
    store.dbVersion;
    if (!store.db || !store.selectedGroupUuid) return null;
    if (store.selectedGroupUuid === ALL_ENTRIES_UUID)
        return { uuid: ALL_ENTRIES_UUID };
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

const entryDeleteIsPermanent = computed(
    () => !deleteMovesToRecycleBin(store.db, entryToDelete.value),
);

const entryDeleteMessage = computed(() => {
    const title = getEntryTitle(entryToDelete.value);
    return entryDeleteIsPermanent.value
        ? `“${title}” will be permanently deleted. This action cannot be undone.`
        : `“${title}” will be moved to the Recycle Bin. You can restore it later.`;
});

const totalEntriesCount = computed(() => databaseView.value.entries.length);

const selectedGroupIsInRecycleBin = computed(() =>
    isObjectInRecycleBin(store.db, selectedGroup.value),
);

const filteredEntries = computed(() => {
    const view = databaseView.value;
    const q = debouncedSearchQuery.value.trim().toLocaleLowerCase();
    if (q) {
        return view.searchIndex
            .filter((row) => row.text.includes(q))
            .map((row) => view.entryItems.get(getObjectUuid(row.entry)));
    }

    const rawEntries =
        store.selectedGroupUuid === ALL_ENTRIES_UUID
            ? view.entries
            : view.entriesByGroup.get(store.selectedGroupUuid) || [];
    return rawEntries.map((entry) => view.entryItems.get(getObjectUuid(entry)));
});

function selectGroup(groupUuid) {
    requestNavigation(() => {
        store.selectedGroupUuid = groupUuid;
        selectedEntryUuid.value = null;
        searchQuery.value = '';
    });
}

function selectEntry(entryUuid) {
    if (entryUuid === selectedEntryUuid.value) return;
    requestNavigation(() => {
        selectedEntryUuid.value = entryUuid;
    });
}

function requestCloseEntryDetail() {
    requestNavigation(() => {
        selectedEntryUuid.value = null;
    });
}

function addEntry() {
    const entryUuid = performAddEntry(store.selectedGroupUuid);
    if (entryUuid) selectedEntryUuid.value = entryUuid;
}

function addGroup(parentGroupUuid) {
    requestNavigation(() => {
        const groupUuid = performAddGroup(parentGroupUuid);
        if (groupUuid) {
            store.selectedGroupUuid = groupUuid;
            selectedEntryUuid.value = null;
        }
    });
}

function requestDelete(entry) {
    const uuid = getObjectUuid(entry);
    if (!uuid) return;
    entryToDeleteUuid.value = uuid;
    showDeleteConfirm.value = true;
}

function confirmDelete() {
    const entry = entryToDelete.value;
    if (!store.db || !entry) return;

    if (isObjectInRecycleBin(store.db, entry)) store.db.move(entry, null);
    else store.db.remove(entry);
    if (selectedEntryUuid.value === entryToDeleteUuid.value) {
        selectedEntryUuid.value = null;
    }
    entryToDeleteUuid.value = null;
    showDeleteConfirm.value = false;
    store.touchDb();
    saveDatabaseChanges({ debounce: true });
}

function cancelDelete() {
    entryToDeleteUuid.value = null;
    showDeleteConfirm.value = false;
}

function restoreEntry(entryUuid) {
    const entry = findEntryByUuid(store.db, entryUuid);
    if (!entry || !isObjectInRecycleBin(store.db, entry)) return;

    const target = getRestoreTargetGroup(store.db, entry);
    if (!target) return;
    store.db.move(entry, target);
    if (selectedEntryUuid.value === entryUuid) selectedEntryUuid.value = null;
    store.touchDb();
    saveDatabaseChanges({ debounce: true });
}

function onEntryUpdated() {
    store.touchDb();
    saveDatabaseChanges({ debounce: true });
}

function closeDatabase({ forgetFile = false } = {}) {
    requestNavigation(() =>
        finishAfterFlush(() => forceCloseDatabase({ forgetFile })),
    );
}

function lockDatabaseFromHeader() {
    closeDatabase();
}

function closeAndForgetDatabase() {
    closeDatabase({ forgetFile: true });
}

function requestNavigation(action) {
    if (entryDetailRef.value?.hasUnsavedChanges?.()) {
        pendingNavigation.value = action;
        showUnsavedEditConfirm.value = true;
        return false;
    }

    action();
    return true;
}

async function saveUnsavedEditAndContinue() {
    const action = pendingNavigation.value;
    if (!entryDetailRef.value?.savePendingEdit?.()) {
        // Validation failed; return to the edit form so its inline error is visible.
        pendingNavigation.value = null;
        showUnsavedEditConfirm.value = false;
        return;
    }

    pendingNavigation.value = null;
    showUnsavedEditConfirm.value = false;
    await action?.();
}

async function discardUnsavedEditAndContinue() {
    const action = pendingNavigation.value;
    entryDetailRef.value?.discardPendingEdit?.();

    pendingNavigation.value = null;
    showUnsavedEditConfirm.value = false;
    await action?.();
}

function continueEditing() {
    pendingNavigation.value = null;
    showUnsavedEditConfirm.value = false;
}

function forceCloseDatabase(options = null) {
    const forgetFile = options?.forgetFile ?? pendingForceCloseForgetFile.value;
    // Set when the confirmation was triggered by a native window close or an
    // app quit: confirming must finish that teardown, not lock to HomePage.
    const finishTeardown = pendingTeardownFinish;
    pendingTeardownFinish = null;
    pendingForceCloseForgetFile.value = false;
    showCloseAfterSaveErrorConfirm.value = false;
    if (finishTeardown) {
        finishTeardown();
        return;
    }
    void lockDatabase(router, { forgetFile });
}

function cancelCloseAfterSaveError() {
    pendingTeardownFinish = null;
    pendingForceCloseForgetFile.value = false;
    showCloseAfterSaveErrorConfirm.value = false;
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
    groupNameError.value = '';
    showRenameModal.value = true;
}

function confirmRenameGroup() {
    const group = findGroupByUuid(store.db, groupToRenameUuid.value);
    if (!group) return;

    const normalizedName = normalizeGroupName(newGroupName.value);
    if (!normalizedName) {
        groupNameError.value = 'Group name cannot be empty.';
        return;
    }
    if (groupNameExistsInParent(group, normalizedName)) {
        groupNameError.value = 'A group with this name already exists here.';
        return;
    }

    group.name = normalizedName;
    if (group.times) group.times.update();
    store.touchDb();
    groupToRenameUuid.value = null;
    groupNameError.value = '';
    showRenameModal.value = false;
    saveDatabaseChanges({ debounce: true });
}

function requestDeleteGroup(groupUuid) {
    const root = rootGroup.value;
    const group = findGroupByUuid(store.db, groupUuid);
    if (
        !store.db ||
        !group ||
        groupUuid === getObjectUuid(root) ||
        isRecycleBinGroup(store.db, group)
    ) {
        return;
    }

    groupToDeleteUuid.value = groupUuid;
    showDeleteGroupConfirm.value = true;
}

function confirmDeleteGroup() {
    requestNavigation(deleteConfirmedGroup);
}

function deleteConfirmedGroup() {
    const group = findGroupByUuid(store.db, groupToDeleteUuid.value);
    if (!store.db || !group) return;

    if (groupContainsGroupUuid(group, store.selectedGroupUuid)) {
        const root = rootGroup.value;
        store.selectedGroupUuid = getObjectUuid(root);
    }
    if (groupContainsEntryUuid(group, selectedEntryUuid.value)) {
        selectedEntryUuid.value = null;
    }

    if (isObjectInRecycleBin(store.db, group)) store.db.move(group, null);
    else store.db.remove(group);
    groupToDeleteUuid.value = null;
    showDeleteGroupConfirm.value = false;
    store.touchDb();
    saveDatabaseChanges({ debounce: true });
}

function restoreGroup(groupUuid) {
    const group = findGroupByUuid(store.db, groupUuid);
    if (!group || !isObjectInRecycleBin(store.db, group)) return;

    const target = getRestoreTargetGroup(store.db, group);
    if (!target) return;
    store.db.move(group, target);
    store.touchDb();
    saveDatabaseChanges({ debounce: true });
}

function moveGroup({ draggedUuid, targetUuid, position }) {
    const plan = resolveGroupMove(store.db, draggedUuid, targetUuid, position);
    if (!plan) return;

    store.db.move(plan.group, plan.toGroup, plan.atIndex);
    store.touchDb();
    saveDatabaseChanges({ debounce: true });
}

function moveEntry({ entryUuid, targetGroupUuid }) {
    const entry = findEntryByUuid(store.db, entryUuid);
    const targetGroup = findGroupByUuid(store.db, targetGroupUuid);
    if (!entry || !targetGroup || entry.parentGroup === targetGroup) return;

    store.db.move(entry, targetGroup);
    store.selectedGroupUuid = targetGroupUuid;
    selectedEntryUuid.value = entryUuid;
    store.touchDb();
    saveDatabaseChanges({ debounce: true });
}

function requestEmptyRecycleBin() {
    const bin = getRecycleBinGroup(store.db);
    if (!bin || (!bin.entries?.length && !bin.groups?.length)) return;
    showEmptyRecycleBinConfirm.value = true;
}

function confirmEmptyRecycleBin() {
    requestNavigation(emptyConfirmedRecycleBin);
}

function emptyConfirmedRecycleBin() {
    const bin = getRecycleBinGroup(store.db);
    if (!store.db || !bin) return;

    // If the current selection lives inside the bin, fall back to the root.
    if (groupContainsGroupUuid(bin, store.selectedGroupUuid)) {
        store.selectedGroupUuid = getObjectUuid(rootGroup.value);
    }
    if (groupContainsEntryUuid(bin, selectedEntryUuid.value)) {
        selectedEntryUuid.value = null;
    }

    // Permanently delete everything in the bin (move to null records tombstones).
    for (const entry of [...(bin.entries || [])]) store.db.move(entry, null);
    for (const child of [...(bin.groups || [])]) store.db.move(child, null);

    showEmptyRecycleBinConfirm.value = false;
    store.touchDb();
    saveDatabaseChanges({ debounce: true });
}

function cancelGroupAction() {
    showRenameModal.value = false;
    groupToRenameUuid.value = null;
    groupNameError.value = '';
    showDeleteGroupConfirm.value = false;
    showEmptyRecycleBinConfirm.value = false;
    groupToDeleteUuid.value = null;
}

function getGroupName(groupUuid) {
    if (!groupUuid) return '';
    if (groupUuid === ALL_ENTRIES_UUID) return 'All Entries';
    return findGroupByUuid(store.db, groupUuid)?.name || '';
}

async function readKeyFileBuffer(path) {
    if (!path) return null;
    const bytes = await invoke('read_database', { path });
    return toExactArrayBuffer(bytes);
}

function openDatabaseSettings() {
    settingsError.value = '';
    showSettingsModal.value = true;
}

function closeDatabaseSettings() {
    if (settingsBusy.value) return;
    settingsError.value = '';
    showSettingsModal.value = false;
}

async function verifyCurrentCredentials(currentPassword, keyFilePath) {
    if (!store.filePath) return true;
    const passwordValue = currentPassword
        ? kdbxweb.ProtectedValue.fromString(currentPassword)
        : null;
    const keyFileBuffer = await readKeyFileBuffer(keyFilePath);
    const credentials = new kdbxweb.Credentials(passwordValue, keyFileBuffer);
    await credentials.ready;
    const bytes = await invoke('read_database', { path: store.filePath });
    await kdbxweb.Kdbx.load(toExactArrayBuffer(bytes), credentials);
    return true;
}

async function confirmDatabaseSettings({
    name,
    password,
    currentPassword,
    keyFilePath,
    keyFileChanged,
}) {
    const db = store.db;
    if (!db || settingsBusy.value) return;

    const normalizedName = (name || '').trim();
    if (!normalizedName) return;

    settingsError.value = '';
    settingsBusy.value = true;

    if (password || keyFileChanged) {
        try {
            await verifyCurrentCredentials(
                currentPassword,
                currentKeyFilePath.value,
            );
        } catch (error) {
            console.error('Current credentials verification failed:', error);
            settingsError.value = 'Current password or key file is incorrect.';
            settingsBusy.value = false;
            return;
        }
    }

    // The database may have been locked while the asynchronous KDF was
    // running. Never apply the submitted credentials to a different session.
    if (store.db !== db || !showSettingsModal.value) {
        settingsBusy.value = false;
        return;
    }

    try {
        const keyFileBuffer = keyFileChanged
            ? await readKeyFileBuffer(keyFilePath)
            : null;
        if (store.db !== db || !showSettingsModal.value) {
            settingsBusy.value = false;
            return;
        }
        if (password || keyFileChanged) {
            // Prepare the complete new credentials before touching the database,
            // then swap them in with a single assignment (see
            // `buildUpdatedCredentials`).
            const updated = await buildUpdatedCredentials(db.credentials, {
                password,
                keyFileBuffer,
                keyFileChanged,
            });
            if (store.db !== db || !showSettingsModal.value) {
                settingsBusy.value = false;
                return;
            }

            // The file on disk keeps the old credentials until the save below
            // succeeds; remember them so "keep the file" can still read it if
            // that save fails.
            rememberCredentialsOnDisk(db.credentials);
            db.credentials = updated;
        }
        db.meta.name = normalizedName;
    } catch (error) {
        console.error('Database settings update failed:', error);
        settingsError.value = 'Could not update the database credentials.';
        settingsBusy.value = false;
        return;
    }

    store.touchDb();
    showSettingsModal.value = false;
    settingsBusy.value = false;
    const saved = await saveDatabaseChanges();

    if (saved && keyFileChanged && store.filePath) {
        await writeKeyFilePreference(store.filePath, keyFilePath);
        currentKeyFilePath.value = keyFilePath || null;
    }

    // If the master password changed, the stored biometric secret is now stale.
    // Update it (or drop it) so Touch ID doesn't keep unlocking with the old password.
    if (
        saved &&
        password &&
        store.filePath &&
        localStorage.getItem(biometricPreferenceKey(store.filePath)) === 'true'
    ) {
        try {
            // Saving the secret triggers a Touch ID prompt, which blurs the
            // window — that must not be mistaken for the user leaving the app.
            await withSystemInteraction(() =>
                invoke('save_biometric_password', {
                    id: store.filePath,
                    pass: password,
                }),
            );
        } catch (e) {
            console.error(
                'Failed to update biometric password, removing it:',
                e,
            );
            try {
                await invoke('delete_biometric_password', {
                    id: store.filePath,
                });
            } catch {}
            localStorage.removeItem(biometricPreferenceKey(store.filePath));
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

/* Unsaved edit modal */
.modal-overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.6);
    z-index: 120;
}

.modal-card {
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: 14px;
    padding: 1.5rem;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.3);
}

.unsaved-modal {
    width: 380px;
}

.unsaved-modal h3 {
    margin: 0 0 0.5rem;
    color: var(--text-primary);
    font-size: 1.1rem;
}

.unsaved-modal p {
    margin: 0 0 1rem;
    color: var(--text-secondary);
    font-size: 0.85rem;
    line-height: 1.45;
}

.conflict-meta {
    margin: -0.5rem 0 1rem;
    color: var(--text-secondary);
    font-size: 0.78rem;
}

.modal-actions {
    display: flex;
    gap: 0.5rem;
}

.modal-actions--stacked {
    flex-direction: column;
}

.confirm-btn,
.danger-btn,
.cancel-btn {
    padding: 0.65rem;
    border-radius: 8px;
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
}

.confirm-btn {
    border: none;
    background: var(--accent-color);
    color: #fff;
}

.confirm-btn:hover {
    background: var(--accent-hover);
}

.danger-btn {
    border: none;
    background: var(--error-color);
    color: #fff;
}

.cancel-btn {
    border: 1px solid var(--border-color);
    background: var(--card-bg);
    color: var(--text-secondary);
}

.cancel-btn:hover {
    border-color: var(--text-secondary);
    color: var(--text-primary);
}

.danger-btn:disabled,
.cancel-btn:disabled {
    opacity: 0.6;
    cursor: default;
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
    /* Pointer events only: without this a touch drag scrolls the page instead
       of resizing, and the browser cancels the pointer stream mid-drag. */
    touch-action: none;
}

.resizer:hover,
.resizer:active {
    background: var(--accent-color);
}

/* Sidebar */
.sidebar {
    width: var(--sidebar-width, 220px);
    min-width: 150px;
    border-right: 1px solid var(--border-color);
    background: var(--card-bg);
    display: flex;
    flex-direction: column;
    overflow: hidden;
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
    overflow: hidden;
    padding: 0.5rem;
}

/* Detail column */
.detail-column {
    flex: 1;
    /* Kept in sync with DETAIL_MIN_WIDTH, which reserves this much room when
       the other columns are dragged. */
    min-width: 260px;
    overflow-y: auto;
    padding: 0 0.75rem 1rem;
}
</style>
