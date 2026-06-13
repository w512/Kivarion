<template>
    <div class="metadata-section">
        <h3>Metadata</h3>
        <div class="metadata-grid">
            <div class="meta-item">
                <label>UUID</label>
                <span>{{ entry.uuid?.id }}</span>
            </div>
            <div class="meta-item">
                <label>Created</label>
                <span>{{ formatDate(entry.times?.creationTime) }}</span>
            </div>
            <div class="meta-item">
                <label>Modified</label>
                <span>{{ formatDate(entry.times?.lastModTime) }}</span>
            </div>
            <div class="meta-item">
                <label>Accessed</label>
                <span>{{ formatDate(entry.times?.lastAccessTime) }}</span>
            </div>
        </div>
    </div>
</template>

<script setup>
import { formatDate } from '../../utils';

defineProps({
    entry: { type: Object, required: true },
});
</script>

<style scoped>
.metadata-section {
    margin-top: 1.5rem;
    border-top: 1px solid var(--border-color);
    padding-top: 1rem;
}

.metadata-section h3 {
    font-size: 0.8rem;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.75rem;
}

.metadata-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 1rem;
}

.meta-item {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
}

.meta-item label {
    font-size: 0.65rem;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
}

.meta-item span {
    font-size: 0.8rem;
    color: var(--text-primary);
    word-break: break-all;
    font-family: var(--font-mono, monospace);
}
</style>
