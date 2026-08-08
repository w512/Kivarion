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
            @settings="router.push({ name: 'settings' })"
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
                    @select="selectGroup"
                    @add-group="addGroup"
                    @rename-group="requestRenameGroup"
                    @delete-group="requestDeleteGroup"
                    @restore-group="restoreGroup"
                    @empty-recycle-bin="requestEmptyRecycleBin"
                    @change-icon="openGroupIconPicker"
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
                    @change-icon="openEntryIconPicker(selectedEntry)"
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

        <!-- Icon Picker — one dialog for both groups and entries -->
        <IconPickerModal
            :show="showIconPicker"
            :target-name="iconTargetName"
            :custom-icons="pickerCustomIcons"
            :selected-icon-id="selectedIconId"
            :selected-custom-icon-id="selectedCustomIconId"
            :can-download-favicon="canDownloadFavicon"
            :busy="iconPickerBusy"
            :error="iconPickerError"
            @select-standard="chooseStandardIcon"
            @select-custom="chooseCustomIcon"
            @pick-file="pickIconFile"
            @download-favicon="downloadFavicon"
            @use-default="useDefaultIcon"
            @cancel="closeIconPicker"
        />
    </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useStore } from '../store.js';
import { homeDir } from '@tauri-apps/api/path';
import { getField } from '../utils';
import { isAnyModalOpen } from '../modalState.js';
import { buildDatabaseView, getObjectUuid } from '../kdbxView.js';

// Components
import GroupTree from '../components/GroupTree.vue';
import EntryList from '../components/EntryList.vue';
import EntryDetail from '../components/EntryDetail.vue';
import DatabaseHeader from '../components/DatabaseHeader.vue';
import ConfirmModal from '../components/ConfirmModal.vue';
import InputModal from '../components/InputModal.vue';
import DatabaseSettingsModal from '../components/DatabaseSettingsModal.vue';
import IconPickerModal from '../components/IconPickerModal.vue';

// Composables
import { useResizable } from '../composables/useResizable.js';
import { useDatabaseActions } from '../composables/useDatabaseActions.js';
import { useClipboard } from '../composables/useClipboard.js';
import { useEntrySelection } from '../composables/useEntrySelection.js';
import { useCollapsedGroups } from '../composables/useCollapsedGroups.js';
import { useGroupActions } from '../composables/useGroupActions.js';
import { useEntryActions } from '../composables/useEntryActions.js';
import { useDatabaseSettings } from '../composables/useDatabaseSettings.js';
import { useDatabaseTeardown } from '../composables/useDatabaseTeardown.js';
import { useEntryIcons } from '../composables/useEntryIcons.js';
import { useIconPicker } from '../composables/useIconPicker.js';

const router = useRouter();
const store = useStore();

// Data URLs are expensive to build for large custom icons. Keep one cache for
// the lifetime of this open database and explicitly discard it on lock/reload.
const customIconDataUrls = new Map();

const databaseView = computed(() => {
    // KDBX objects retain their identity across edits, so dbVersion is the
    // explicit invalidation key for the whole lightweight view/search index.
    store.dbVersion;
    return buildDatabaseView(store.db, customIconDataUrls);
});

// The parts of the page, in dependency order. `databaseView` has to be declared
// before them: several read it during setup. `selection` is the one they share —
// nearly every action moves what the user is looking at, and each such move has
// to pass the entry-edit draft guard that lives with it.
const actions = useDatabaseActions(store);
const {
    saveDatabaseChanges,
    flushPendingSave,
    isSaving,
    isReloading,
    saveError,
    saveConflict,
} = actions;

const selection = useEntrySelection(store, databaseView);
const {
    selectedEntryUuid,
    entryDetailRef,
    searchQuery,
    selectedEntry,
    selectedGroupIsInRecycleBin,
    filteredEntries,
    showUnsavedEditConfirm,
    selectGroup,
    selectEntry,
    requestCloseEntryDetail,
    saveUnsavedEditAndContinue,
    discardUnsavedEditAndContinue,
    continueEditing,
} = selection;

const collapsedGroups = useCollapsedGroups(store, () =>
    store.db ? databaseView.value.groupsByUuid : null,
);

const {
    showRenameModal,
    newGroupName,
    groupNameError,
    showDeleteGroupConfirm,
    showEmptyRecycleBinConfirm,
    groupDeleteIsPermanent,
    groupDeleteMessage,
    addGroup,
    requestRenameGroup,
    confirmRenameGroup,
    requestDeleteGroup,
    confirmDeleteGroup,
    restoreGroup,
    moveGroup,
    requestEmptyRecycleBin,
    confirmEmptyRecycleBin,
    cancelGroupAction,
} = useGroupActions(store, { databaseView, selection, actions });

const {
    showDeleteConfirm,
    entryDeleteIsPermanent,
    entryDeleteMessage,
    addEntry,
    requestDelete,
    confirmDelete,
    cancelDelete,
    restoreEntry,
    moveEntry,
    onEntryUpdated,
} = useEntryActions(store, { databaseView, selection, actions });

// `useEntryIcons` reports a stored icon the way a child component would, so the
// page's own save handler is what its `emit('updated')` lands on.
const { downloadIcon } = useEntryIcons(() => onEntryUpdated());

const {
    showIconPicker,
    iconTargetName,
    pickerCustomIcons,
    selectedIconId,
    selectedCustomIconId,
    canDownloadFavicon,
    iconPickerError,
    iconPickerBusy,
    openGroupIconPicker,
    openEntryIconPicker,
    chooseStandardIcon,
    chooseCustomIcon,
    useDefaultIcon,
    pickIconFile,
    downloadFavicon,
    closeIconPicker,
} = useIconPicker(store, {
    databaseView,
    actions,
    iconDataUrls: customIconDataUrls,
    downloadIcon,
});

const {
    showSettingsModal,
    settingsBusy,
    settingsError,
    currentKeyFilePath,
    openDatabaseSettings,
    closeDatabaseSettings,
    confirmDatabaseSettings,
    reset: resetDatabaseSettings,
} = useDatabaseSettings(store, { actions });

const {
    showClosingSaveModal,
    showCloseAfterSaveErrorConfirm,
    conflictDiskTime,
    confirmCloseWithoutWaiting,
    cancelClosingSave,
    lockDatabaseFromHeader,
    closeAndForgetDatabase,
    forceCloseDatabase,
    cancelCloseAfterSaveError,
    overwriteOnConflict,
    reloadFromConflict,
    dismissConflict,
    reset: resetTeardown,
} = useDatabaseTeardown({ store, router, actions, selection });

const headerRef = ref(null);
const homeDirPath = ref('');
const { copy: copyToClipboard } = useClipboard();

onMounted(() => {
    if (!store.db) {
        router.replace({ name: 'home' });
        return;
    }
    // Select root group by default
    const root = databaseView.value.rootGroup;
    if (root) {
        store.selectedGroupUuid = getObjectUuid(root);
    }

    // Get home directory for path display
    homeDir().then((dir) => {
        homeDirPath.value = dir;
    });

    window.addEventListener('kivarion:before-lock', prepareForForcedLock);
    window.addEventListener('keydown', onGlobalShortcut);
});

onUnmounted(() => {
    window.removeEventListener('kivarion:before-lock', prepareForForcedLock);
    window.removeEventListener('keydown', onGlobalShortcut);
    customIconDataUrls.clear();
});

function prepareForForcedLock() {
    // Runs synchronously from the `kivarion:before-lock` dispatch, i.e. while
    // `store.db` is still set: a debounced auto-save must be started here or
    // auto-lock silently loses the mutation that was waiting for it.
    void flushPendingSave();
    selection.reset();
    resetTeardown();
    cancelGroupAction();
    cancelDelete();
    resetDatabaseSettings();
    closeIconPicker();
    customIconDataUrls.clear();
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

const groupTree = computed(() => databaseView.value.groupTree);
const totalEntriesCount = computed(() => databaseView.value.entries.length);

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
    // `isAnyModalOpen` covers `EntryDetail`'s attachment dialogs too; this
    // page's own two overlays are plain elements rather than `BaseModal`s and
    // so are checked by hand — Cmd+L over the unsaved-changes one used to
    // replace the navigation it was asking about and put the same modal back up.
    if (
        isAnyModalOpen() ||
        saveConflict.value ||
        showUnsavedEditConfirm.value
    ) {
        return;
    }

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
