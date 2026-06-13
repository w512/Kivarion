<template>
    <div class="entry-detail">
        <div class="detail-header">
            <div class="detail-title-row">
                <h2>{{ displayTitle }}</h2>
                <div v-if="!isEditing" class="detail-actions">
                    <button class="edit-btn" @click="startEdit" title="Edit entry">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                    </button>
                    <div class="menu-container">
                        <button class="menu-trigger" @click.stop="showMenu = !showMenu" title="More actions">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />
                            </svg>
                        </button>
                        <transition name="dropdown">
                            <div v-if="showMenu" class="dropdown-menu">
                                <button class="menu-item" @click="downloadIcon(entry); showMenu = false">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                                    </svg>
                                    Update Icon
                                </button>
                                <button class="menu-item delete" @click="emit('delete'); showMenu = false">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
                                    </svg>
                                    Delete
                                </button>
                                <div class="menu-divider"></div>
                                <button class="menu-item" @click="emit('close'); showMenu = false">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                    </svg>
                                    Close
                                </button>
                            </div>
                        </transition>
                    </div>
                </div>
                <div v-else class="detail-actions">
                    <button type="submit" form="entry-edit-form" class="save-btn">Save</button>
                    <button type="button" class="cancel-btn" @click="cancelEdit">Cancel</button>
                </div>
            </div>
        </div>

        <div v-if="!isEditing" class="detail-scroll-content">
            <EntryViewFields :entry="entry" />
            <EntryCustomFields :is-editing="false" :fields="customFields" />
            <EntryAttachments 
                :attachments="attachments" 
                :thumbnails="attachmentThumbnails"
                @preview="openPreview"
                @copy-name="copyAttachmentName"
                @export="exportAttachment"
            />
            <EntryMetadata :entry="entry" />
        </div>

        <form v-else id="entry-edit-form" class="detail-scroll-content" @submit.prevent="saveEdit">
            <EntryEditFields v-model="form" />
            <EntryCustomFields is-editing v-model="form.CustomFields" />
            <p v-if="formError" class="form-error">{{ formError }}</p>
        </form>

        <AttachmentPreviewModal 
            :show="showPreview" 
            :url="previewUrl" 
            :name="previewName"
            @close="closePreview"
        />
    </div>
</template>

<script setup>
import { ref, watch, computed, onMounted, onUnmounted, toRef } from 'vue';
import { type } from '@tauri-apps/plugin-os';
import { useStore } from '../store';

// Sub-components
import EntryViewFields from './entry-detail/EntryViewFields.vue';
import EntryEditFields from './entry-detail/EntryEditFields.vue';
import EntryCustomFields from './entry-detail/EntryCustomFields.vue';
import EntryAttachments from './entry-detail/EntryAttachments.vue';
import EntryMetadata from './entry-detail/EntryMetadata.vue';
import AttachmentPreviewModal from './entry-detail/AttachmentPreviewModal.vue';

// Composables
import { useEntryAttachments } from '../composables/useEntryAttachments';
import { useEntryIcons } from '../composables/useEntryIcons';
import { useEntryForm } from '../composables/useEntryForm';

// Utils
import { getField, isProtectedValue, STANDARD_FIELDS } from '../utils';

const props = defineProps({
    entry: { type: Object, required: true },
});

const emit = defineEmits(['updated', 'close', 'delete']);
const store = useStore();

const showMenu = ref(false);
const isMac = ref(false);

const displayTitle = computed(() => {
    store.dbVersion;
    return getField(props.entry, 'Title') || 'No title';
});

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

// Use Composables
const { downloadIcon } = useEntryIcons(emit);

const {
    isEditing,
    form,
    formError,
    startEdit,
    cancelEdit,
    saveEdit
} = useEntryForm(props, emit, customFields, downloadIcon);

const {
    attachments,
    attachmentThumbnails,
    showPreview,
    previewUrl,
    previewName,
    openPreview,
    closePreview,
    exportAttachment,
    copyAttachmentName
} = useEntryAttachments(toRef(props, 'entry'), isMac);

const handleClickOutside = () => { if (showMenu.value) showMenu.value = false; };
const handleKeyDown = (e) => { 
    if (e.key === 'Escape') { 
        if (showPreview.value) closePreview(); 
        else showMenu.value = false; 
    } 
};

onMounted(async () => {
    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    try { isMac.value = (await type()) === 'macos'; } catch (e) { console.error('Failed to detect OS', e); }
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

@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

.detail-header {
    padding: 0.75rem 0;
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
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.detail-scroll-content {
    flex: 1;
    overflow-y: auto;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
}

.menu-container { position: relative; }

.menu-trigger,
.edit-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 6px;
    border: 1px solid var(--border-color);
    background: var(--card-bg);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s;
}

.menu-trigger:hover,
.edit-btn:hover {
    border-color: var(--accent-color);
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

.menu-item:hover { background: var(--badge-bg); }
.menu-item.delete { color: var(--error-color); }
.menu-item.delete:hover { background: rgba(239, 68, 68, 0.1); }
.menu-divider { height: 1px; background: var(--border-color); margin: 0.4rem 0.25rem; }

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

.dropdown-enter-active, .dropdown-leave-active { transition: all 0.2s ease; }
.dropdown-enter-from, .dropdown-leave-to { opacity: 0; transform: translateY(-8px); }
</style>

