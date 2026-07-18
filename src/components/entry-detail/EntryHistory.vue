<template>
    <div v-if="historyItems.length" class="history-section">
        <div class="section-header">
            <h3>History</h3>
            <span>{{ historyItems.length }} versions</span>
        </div>
        <div class="history-list">
            <div
                v-for="item in historyItems"
                :key="item.index"
                class="history-item"
            >
                <div class="history-main">
                    <strong>{{ item.title }}</strong>
                    <span>{{ formatDate(item.modifiedAt) }}</span>
                </div>
                <button type="button" @click="emit('restore', item.index)">
                    Restore
                </button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed } from 'vue';
import { formatDate, getField } from '../../utils.js';

const props = defineProps({
    entry: { type: Object, required: true },
    refreshKey: { type: Number, default: 0 },
});

const emit = defineEmits(['restore']);

const historyItems = computed(() => {
    props.refreshKey;
    return (props.entry.history || [])
        .map((historyEntry, index) => ({
            index,
            title: getField(historyEntry, 'Title') || 'No title',
            modifiedAt: historyEntry.times?.lastModTime,
        }))
        .reverse();
});
</script>

<style scoped>
.history-section {
    margin-top: 1.5rem;
    border-top: 1px solid var(--border-color);
    padding-top: 1rem;
}

.section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.75rem;
}

.section-header h3 {
    font-size: 0.8rem;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

.section-header span {
    font-size: 0.75rem;
    color: var(--text-secondary);
}

.history-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
}

.history-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.55rem 0.65rem;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--input-bg);
}

.history-main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
}

.history-main strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.85rem;
    color: var(--text-primary);
}

.history-main span {
    font-size: 0.75rem;
    color: var(--text-secondary);
}

.history-item button {
    padding: 0.35rem 0.65rem;
    border-radius: 6px;
    border: 1px solid var(--border-color);
    background: var(--card-bg);
    color: var(--text-primary);
    cursor: pointer;
    font-size: 0.78rem;
}

.history-item button:hover {
    border-color: var(--accent-color);
    color: var(--accent-color);
}
</style>
