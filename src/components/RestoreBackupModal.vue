<template>
    <BaseModal
        :show="show"
        width="420px"
        labelledby="restore-backup-title"
        :close-on-backdrop="!busy"
        :close-on-esc="!busy"
        @close="$emit('close')"
    >
        <div class="restore-backup">
            <h3 id="restore-backup-title">Restore from backup</h3>
            <p class="hint">
                Restoring replaces the current database with an earlier copy.
                Any unsaved changes will be lost.
            </p>

            <p v-if="error" class="restore-error">{{ error }}</p>

            <div v-if="backups.length === 0" class="empty">
                No backups found for this database yet.
            </div>
            <ul v-else class="backup-list">
                <li v-for="b in backups" :key="b.path" class="backup-row">
                    <div class="backup-info">
                        <span class="backup-name">{{ fileName(b.path) }}</span>
                        <span class="backup-meta"
                            >{{ formatDate(b.mtime) }} ·
                            {{ formatSize(b.size) }}</span
                        >
                    </div>
                    <button
                        class="restore-btn"
                        :disabled="busy"
                        @click="$emit('restore', b)"
                    >
                        Restore
                    </button>
                </li>
            </ul>

            <div class="modal-actions">
                <button
                    class="cancel-btn"
                    :disabled="busy"
                    @click="$emit('close')"
                >
                    Close
                </button>
            </div>
        </div>
    </BaseModal>
</template>

<script setup>
import BaseModal from './BaseModal.vue';

defineProps({
    show: { type: Boolean, default: false },
    backups: { type: Array, default: () => [] },
    busy: { type: Boolean, default: false },
    error: { type: String, default: '' },
});

defineEmits(['close', 'restore']);

function fileName(path) {
    return path.split(/[\\/]/).pop();
}

function formatDate(mtime) {
    if (!mtime) return 'unknown date';
    return new Date(mtime).toLocaleString();
}

function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
</script>

<style scoped>
.restore-backup h3 {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0 0 0.5rem;
}

.hint {
    font-size: 0.8rem;
    color: var(--text-secondary);
    margin: 0 0 1rem;
    line-height: 1.4;
}

.restore-error {
    font-size: 0.8rem;
    color: var(--error-color);
    background: rgba(239, 68, 68, 0.1);
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    margin: 0 0 1rem;
}

.empty {
    font-size: 0.85rem;
    color: var(--text-secondary);
    text-align: center;
    padding: 1.5rem 0;
}

.backup-list {
    list-style: none;
    margin: 0 0 1rem;
    padding: 0;
    max-height: 320px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
}

.backup-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.6rem 0.75rem;
    background: var(--badge-bg);
    border-radius: 8px;
}

.backup-info {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    overflow: hidden;
}

.backup-name {
    font-size: 0.85rem;
    color: var(--text-primary);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.backup-meta {
    font-size: 0.72rem;
    color: var(--text-secondary);
}

.restore-btn {
    flex-shrink: 0;
    padding: 0.4rem 0.9rem;
    border-radius: 6px;
    border: 1px solid var(--accent-color);
    background: transparent;
    color: var(--accent-color);
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
}

.restore-btn:hover:not(:disabled) {
    background: var(--accent-color);
    color: #fff;
}

.restore-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.modal-actions {
    display: flex;
    justify-content: flex-end;
}

.cancel-btn {
    padding: 0.5rem 1.25rem;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: var(--card-bg);
    color: var(--text-secondary);
    font-size: 0.85rem;
    cursor: pointer;
    transition: all 0.15s;
}

.cancel-btn:hover {
    border-color: var(--text-secondary);
    color: var(--text-primary);
}
</style>
