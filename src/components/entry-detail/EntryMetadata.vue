<template>
    <div class="metadata-section">
        <button
            type="button"
            class="section-header"
            :aria-expanded="expanded"
            @click="expanded = !expanded"
        >
            <span class="section-title">Metadata</span>
            <ChevronDown
                :size="15"
                class="section-chevron"
                :class="{ expanded }"
                aria-hidden="true"
            />
        </button>

        <div v-if="expanded" class="metadata-grid">
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
import { ref, watch } from 'vue';
import { ChevronDown } from 'lucide-vue-next';
import { formatDate } from '../../utils';

const props = defineProps({
    entry: { type: Object, required: true },
});

const expanded = ref(false);

watch(
    () => props.entry,
    () => {
        expanded.value = false;
    },
);
</script>

<style scoped>
.metadata-section {
    margin-top: 0;
    padding: 0.75rem;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--card-bg);
}

.section-header {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: space-between;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    text-align: left;
}

.section-title {
    color: var(--text-secondary);
    font-size: 0.8rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
}

.section-chevron {
    color: var(--text-secondary);
    transition: transform 0.15s ease;
}

.section-chevron.expanded {
    transform: rotate(180deg);
}

.metadata-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 0.6rem;
    margin-top: 0.65rem;
}

.meta-item {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
}

.meta-item label {
    color: var(--text-secondary);
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
}

.meta-item span {
    color: var(--text-primary);
    font-family: var(--font-mono, monospace);
    font-size: 0.8rem;
    word-break: break-all;
}
</style>
