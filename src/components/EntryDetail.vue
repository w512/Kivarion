<template>
    <div class="entry-detail">
        <div class="detail-header">
            <div class="detail-title-row">
                <h2 :title="entryTitle">{{ displayTitle }}</h2>
                <div v-if="!isEditing" class="detail-actions">
                    <transition name="mini-toast">
                        <div
                            v-if="activeCopyField === 'Title'"
                            class="mini-toast"
                        >
                            Copied!
                        </div>
                    </transition>
                    <!-- The primary action of this column, so it is a labelled
                         button: a second pencil icon here only competed with
                         the one the header uses for the database's settings. -->
                    <button
                        class="edit-btn"
                        title="Edit entry"
                        @click="startEdit"
                    >
                        Edit
                    </button>
                    <div class="menu-container">
                        <button
                            class="menu-trigger"
                            title="More actions"
                            aria-haspopup="menu"
                            :aria-expanded="showMenu"
                            @click.stop="showMenu = !showMenu"
                        >
                            <EllipsisVertical :size="18" />
                        </button>
                        <transition name="dropdown">
                            <div v-if="showMenu" class="dropdown-menu">
                                <!-- Copying the title is rare next to the
                                     username and the password, which have their
                                     own buttons in the field rows below. -->
                                <button
                                    v-if="entryTitle"
                                    class="menu-item"
                                    @click="
                                        copyTitle();
                                        showMenu = false;
                                    "
                                >
                                    <Copy :size="14" />
                                    Copy Title
                                </button>
                                <button
                                    class="menu-item"
                                    @click="
                                        emit('change-icon');
                                        showMenu = false;
                                    "
                                >
                                    <ImageIcon :size="14" />
                                    Change Icon…
                                </button>
                                <button
                                    v-if="store.downloadSiteIcons"
                                    class="menu-item"
                                    @click="
                                        downloadIcon(entry);
                                        showMenu = false;
                                    "
                                >
                                    <Download :size="14" />
                                    Update Icon
                                </button>
                                <button
                                    class="menu-item delete"
                                    @click="
                                        emit('delete');
                                        showMenu = false;
                                    "
                                >
                                    <Trash2 :size="14" />
                                    Delete
                                </button>
                                <div class="menu-divider"></div>
                                <button
                                    class="menu-item"
                                    @click="
                                        emit('close');
                                        showMenu = false;
                                    "
                                >
                                    <X :size="14" />
                                    Close
                                </button>
                            </div>
                        </transition>
                    </div>
                </div>
                <div v-else class="detail-actions">
                    <button
                        type="submit"
                        form="entry-edit-form"
                        class="save-btn"
                        :disabled="!isDirty"
                        :title="isDirty ? 'Save changes' : 'No changes to save'"
                    >
                        Save
                    </button>
                    <button
                        type="button"
                        class="cancel-btn"
                        @click="cancelEdit"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>

        <div
            v-if="!isEditing"
            class="detail-scroll-content detail-view-content"
        >
            <EntryViewFields :entry="entry" :email-field="emailField" />
            <EntryCustomFields
                :is-editing="false"
                :fields="otherCustomFields"
            />
            <EntryAttachments
                :attachments="attachments"
                :thumbnails="attachmentThumbnails"
                :total-size="totalAttachmentsSize"
                :adding="isAddingAttachment"
                :error="attachmentError"
                @add="addAttachment"
                @preview="openPreview"
                @copy-name="copyAttachmentName"
                @export="exportAttachment"
                @rename="requestRenameAttachment"
                @delete="requestDeleteAttachment"
            />
            <EntryHistory
                :entry="entry"
                :refresh-key="store.dbVersion"
                @restore="restoreHistoryVersion"
            />
            <EntryMetadata :entry="entry" />
        </div>

        <form
            v-else
            id="entry-edit-form"
            class="detail-scroll-content"
            @submit.prevent="saveEdit"
        >
            <EntryEditFields v-model="form" />
            <EntryCustomFields v-model="form.CustomFields" is-editing />
            <p v-if="formError" class="form-error">{{ formError }}</p>
        </form>

        <AttachmentPreviewModal
            :show="showPreview"
            :url="previewUrl"
            :name="previewName"
            @close="closePreview"
        />

        <InputModal
            v-model="attachmentRenameName"
            :show="showRenameAttachment"
            title="Rename Attachment"
            placeholder="Attachment name"
            confirm-text="Rename"
            :error="attachmentRenameError"
            :confirm-disabled="!attachmentRenameName.trim()"
            @confirm="confirmRenameAttachment"
            @cancel="closeAttachmentDialogs"
        />

        <ConfirmModal
            :show="!!pendingLargeAttachment"
            title="Add this large file?"
            :message="largeAttachmentMessage"
            confirm-text="Add anyway"
            confirm-variant="primary"
            @confirm="confirmLargeAttachment"
            @cancel="cancelLargeAttachment"
        />

        <ConfirmModal
            :show="showDeleteAttachment"
            title="Delete attachment?"
            :message="`“${attachmentToDeleteName}” will be removed from this entry. You can restore it from entry history.`"
            confirm-text="Delete"
            confirm-variant="danger"
            @confirm="confirmDeleteAttachment"
            @cancel="closeAttachmentDialogs"
        />
    </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, toRef, watch } from 'vue';
import {
    Copy,
    Download,
    EllipsisVertical,
    Image as ImageIcon,
    Trash2,
    X,
} from 'lucide-vue-next';
import { useStore } from '../store';

// Sub-components
import EntryViewFields from './entry-detail/EntryViewFields.vue';
import EntryEditFields from './entry-detail/EntryEditFields.vue';
import EntryCustomFields from './entry-detail/EntryCustomFields.vue';
import EntryAttachments from './entry-detail/EntryAttachments.vue';
import EntryMetadata from './entry-detail/EntryMetadata.vue';
import EntryHistory from './entry-detail/EntryHistory.vue';
import AttachmentPreviewModal from './entry-detail/AttachmentPreviewModal.vue';
import InputModal from './InputModal.vue';
import ConfirmModal from './ConfirmModal.vue';

// Composables
import { useEntryAttachments } from '../composables/useEntryAttachments';
import { useEntryIcons } from '../composables/useEntryIcons';
import { useEntryForm } from '../composables/useEntryForm';
import { useClipboard } from '../composables/useClipboard';
import { usePlatform } from '../composables/usePlatform';

// Utils
import {
    formatSize,
    getField,
    isEmailFieldName,
    isProtectedValue,
    STANDARD_FIELDS,
} from '../utils';

const props = defineProps({
    entry: { type: Object, required: true },
});

const emit = defineEmits(['updated', 'close', 'delete', 'change-icon']);
const store = useStore();

const showMenu = ref(false);
const { isMac } = usePlatform();
const showRenameAttachment = ref(false);
const attachmentToRenameName = ref('');
const attachmentRenameName = ref('');
const attachmentRenameError = ref('');
const showDeleteAttachment = ref(false);
const attachmentToDeleteName = ref('');

const { activeCopyField, copy } = useClipboard();

const entryTitle = computed(() => {
    store.dbVersion;
    return getField(props.entry, 'Title');
});

// The heading falls back to a placeholder; the copy button and the tooltip use
// `entryTitle` so an untitled entry neither copies nor advertises "No title".
const displayTitle = computed(() => entryTitle.value || 'No title');

// A title is not a secret, so no clipboard auto-clear (see EntryViewFields).
function copyTitle() {
    return copy(entryTitle.value, 'Title');
}

const customFields = computed(() => {
    store.dbVersion;
    const fields = [];
    if (props.entry?.fields) {
        for (const [key, val] of props.entry.fields) {
            if (!STANDARD_FIELDS.includes(key)) {
                fields.push({
                    key,
                    value: getField(props.entry, key),
                    protected: isProtectedValue(val),
                });
            }
        }
    }
    return fields.sort((a, b) => a.key.localeCompare(b.key));
});

// An e-mail identifies the account like the username does, so the view shows it
// in the main group instead of under "Custom Fields" — but only in the view:
// `customFields` itself still feeds the edit form, where it stays an ordinary
// custom field. A protected one is left where it is, because the masking and
// the reveal button live in the custom-field section.
const emailField = computed(
    () =>
        customFields.value.find(
            (field) =>
                !field.protected && field.value && isEmailFieldName(field.key),
        ) || null,
);

const otherCustomFields = computed(() =>
    emailField.value
        ? customFields.value.filter((field) => field !== emailField.value)
        : customFields.value,
);

// Use Composables
const { downloadIcon } = useEntryIcons(emit);

const { isEditing, isDirty, form, formError, startEdit, cancelEdit, saveEdit } =
    useEntryForm(props, emit, customFields, downloadIcon);

const {
    attachments,
    attachmentThumbnails,
    totalAttachmentsSize,
    showPreview,
    previewUrl,
    previewName,
    isAddingAttachment,
    attachmentError,
    pendingLargeAttachment,
    confirmLargeAttachment,
    cancelLargeAttachment,
    addAttachment,
    renameAttachment,
    deleteAttachment,
    clearAttachmentError,
    openPreview,
    closePreview,
    exportAttachment,
    copyAttachmentName,
} = useEntryAttachments(toRef(props, 'entry'), isMac, emit);

const largeAttachmentMessage = computed(() => {
    const pending = pendingLargeAttachment.value;
    if (!pending) return '';
    return `“${pending.name}” is ${formatSize(pending.size)}. It is stored inside the database, so every later save re-encrypts it and each backup keeps a copy.`;
});

function requestRenameAttachment(attachment) {
    clearAttachmentError();
    attachmentToRenameName.value = attachment.name;
    attachmentRenameName.value = attachment.name;
    attachmentRenameError.value = '';
    showRenameAttachment.value = true;
}

function confirmRenameAttachment() {
    const result = renameAttachment(
        attachmentToRenameName.value,
        attachmentRenameName.value,
    );
    if (!result.ok) {
        attachmentRenameError.value = result.error;
        return;
    }
    closeAttachmentDialogs();
}

function requestDeleteAttachment(attachment) {
    clearAttachmentError();
    attachmentToDeleteName.value = attachment.name;
    showDeleteAttachment.value = true;
}

function confirmDeleteAttachment() {
    deleteAttachment(attachmentToDeleteName.value);
    closeAttachmentDialogs();
}

function closeAttachmentDialogs() {
    showRenameAttachment.value = false;
    attachmentToRenameName.value = '';
    attachmentRenameName.value = '';
    attachmentRenameError.value = '';
    showDeleteAttachment.value = false;
    attachmentToDeleteName.value = '';
}

watch(attachmentRenameName, () => {
    attachmentRenameError.value = '';
});
watch(() => props.entry, closeAttachmentDialogs);

function hasUnsavedChanges() {
    return isDirty.value;
}

function savePendingEdit() {
    return saveEdit();
}

function discardPendingEdit() {
    cancelEdit();
    closeAttachmentDialogs();
}

function restoreHistoryVersion(index) {
    const historyEntry = props.entry.history?.[index];
    if (!historyEntry) return;

    props.entry.pushHistory();
    const history = [...props.entry.history];
    props.entry.copyFrom(historyEntry);
    props.entry.history = history;
    props.entry.times.update();
    emit('updated');
}

defineExpose({
    hasUnsavedChanges,
    savePendingEdit,
    discardPendingEdit,
});

const handleClickOutside = () => {
    if (showMenu.value) showMenu.value = false;
};
const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
        if (showPreview.value) closePreview();
        else showMenu.value = false;
    }
};

onMounted(() => {
    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
    document.removeEventListener('click', handleClickOutside);
    document.removeEventListener('keydown', handleKeyDown);
});
</script>

<style scoped>
.entry-detail {
    height: 100%;
    display: flex;
    flex-direction: column;
    position: relative;
    animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
    from {
        opacity: 0;
    }
    to {
        opacity: 1;
    }
}

.detail-header {
    padding: 0.5rem 0;
    background: var(--bg-color);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
}

.detail-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
}

.detail-title-row h2 {
    font-size: 1.2rem;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.detail-actions {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

/* The field rows hang their toast above the button; here that would land
   outside the top of the detail column, so this one drops below instead. */
.mini-toast {
    position: absolute;
    top: calc(100% + 0.4rem);
    right: 0;
    background: var(--accent-color);
    color: white;
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
    font-size: 0.65rem;
    font-weight: 700;
    white-space: nowrap;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    pointer-events: none;
    z-index: 100;
}

.mini-toast::after {
    content: '';
    position: absolute;
    top: -3px;
    right: 8px;
    border-left: 4px solid transparent;
    border-right: 4px solid transparent;
    border-bottom: 4px solid var(--accent-color);
}

.mini-toast-enter-active,
.mini-toast-leave-active {
    transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.mini-toast-enter-from,
.mini-toast-leave-to {
    opacity: 0;
    transform: translateY(-5px) scale(0.8);
}

.detail-scroll-content {
    flex: 1;
    overflow-y: auto;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
}

.detail-view-content {
    gap: 0.75rem;
}

.menu-container {
    position: relative;
}

.edit-btn {
    padding: 0.35rem 0.9rem;
    border-radius: 6px;
    border: 1px solid var(--border-color);
    background: var(--card-bg);
    color: var(--text-primary);
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
}

.edit-btn:hover {
    border-color: var(--accent-color);
    color: var(--accent-color);
}

/* Borderless, so the secondary action does not read as a second button of the
   same weight as Edit beside it. */
.menu-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition:
        background 0.15s,
        color 0.15s;
}

.menu-trigger:hover {
    background: var(--badge-bg);
    color: var(--accent-color);
}

.dropdown-menu {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 0.5rem;
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
    min-width: 150px;
    z-index: 100;
    padding: 0.4rem;
}

.menu-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.6rem 0.75rem;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-size: 0.85rem;
    cursor: pointer;
    border-radius: 6px;
    transition: all 0.15s;
    text-align: left;
}

.menu-item:hover {
    background: var(--badge-bg);
}
.menu-item.delete {
    color: var(--error-color);
}
.menu-item.delete:hover {
    background: rgba(239, 68, 68, 0.1);
}
.menu-divider {
    height: 1px;
    background: var(--border-color);
    margin: 0.4rem 0.25rem;
}

.save-btn {
    padding: 0.35rem 1rem;
    border-radius: 6px;
    border: none;
    background: var(--accent-color);
    color: #fff;
    font-weight: 600;
    font-size: 0.8rem;
    cursor: pointer;
}

.save-btn:disabled {
    opacity: 0.5;
    cursor: default;
}

.cancel-btn {
    padding: 0.35rem 1rem;
    border-radius: 6px;
    border: 1px solid var(--border-color);
    background: var(--card-bg);
    color: var(--text-secondary);
    font-size: 0.8rem;
    cursor: pointer;
}

.form-error {
    padding: 0.6rem 0.75rem;
    border-radius: 8px;
    background: rgba(239, 68, 68, 0.12);
    color: var(--error-color);
    font-size: 0.85rem;
}

.dropdown-enter-active,
.dropdown-leave-active {
    transition: all 0.2s ease;
}
.dropdown-enter-from,
.dropdown-leave-to {
    opacity: 0;
    transform: translateY(-8px);
}
</style>
