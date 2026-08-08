<template>
    <div v-if="historyItems.length" class="history-section">
        <button
            type="button"
            class="section-header"
            :aria-expanded="expanded"
            @click="toggleSection"
        >
            <span class="section-title">History</span>
            <span class="history-summary">
                {{ historyItems.length }} versions
                <ChevronDown
                    :size="15"
                    class="section-chevron"
                    :class="{ expanded }"
                    aria-hidden="true"
                />
            </span>
        </button>

        <div v-if="expanded" class="history-list">
            <div
                v-for="item in historyItems"
                :key="item.index"
                class="history-item"
            >
                <div class="history-row">
                    <div class="history-main">
                        <strong>{{ item.title }}</strong>
                        <span>{{ formatDate(item.modifiedAt) }}</span>
                    </div>
                    <div class="history-actions">
                        <button
                            type="button"
                            :aria-expanded="previewIndex === item.index"
                            @click="togglePreview(item.index)"
                        >
                            {{
                                previewIndex === item.index
                                    ? 'Hide preview'
                                    : 'Preview'
                            }}
                        </button>
                        <button
                            type="button"
                            @click="emit('restore', item.index)"
                        >
                            Restore
                        </button>
                    </div>
                </div>

                <div v-if="previewIndex === item.index" class="history-preview">
                    <div v-if="item.changes.length" class="changes-list">
                        <div class="changes-heading" aria-hidden="true">
                            <span>Field</span>
                            <span>This version</span>
                            <span>Current</span>
                        </div>
                        <div
                            v-for="change in item.changes"
                            :key="change.key"
                            class="change-row"
                        >
                            <strong>{{ change.label }}</strong>
                            <span
                                :class="{
                                    'protected-value': change.protected,
                                }"
                                >{{ change.historicalValue }}</span
                            >
                            <span
                                :class="{
                                    'protected-value': change.protected,
                                }"
                                >{{ change.currentValue }}</span
                            >
                        </div>
                    </div>
                    <p v-else class="no-changes">
                        No field or attachment differences from the current
                        version.
                    </p>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { ChevronDown } from 'lucide-vue-next';
import {
    buildEntryHistoryChanges,
    MAX_ENTRY_HISTORY_ITEMS,
} from '../../entryHistory.js';
import { formatDate, getField } from '../../utils.js';

const props = defineProps({
    entry: { type: Object, required: true },
    refreshKey: { type: Number, default: 0 },
});

const emit = defineEmits(['restore']);
const expanded = ref(false);
const previewIndex = ref(null);

const historyItems = computed(() => {
    props.refreshKey;
    return (props.entry.history || [])
        .map((historyEntry, index) => ({
            historyEntry,
            index,
        }))
        .slice(-MAX_ENTRY_HISTORY_ITEMS)
        .map(({ historyEntry, index }) => ({
            index,
            title: getField(historyEntry, 'Title') || 'No title',
            modifiedAt: historyEntry.times?.lastModTime,
            changes: buildEntryHistoryChanges(historyEntry, props.entry),
        }))
        .reverse();
});

watch(
    () => props.entry,
    () => {
        expanded.value = false;
        previewIndex.value = null;
    },
);

watch(
    () => props.refreshKey,
    () => {
        previewIndex.value = null;
    },
);

function toggleSection() {
    expanded.value = !expanded.value;
    if (!expanded.value) previewIndex.value = null;
}

function togglePreview(index) {
    previewIndex.value = previewIndex.value === index ? null : index;
}
</script>

<style scoped>
.history-section {
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
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.8rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
}

.history-summary {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--text-secondary);
    font-size: 0.75rem;
}

.section-chevron {
    transition: transform 0.15s ease;
}

.section-chevron.expanded {
    transform: rotate(180deg);
}

.history-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-top: 0.65rem;
}

.history-item {
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--input-bg);
}

.history-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.45rem 0.55rem;
}

.history-main {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.15rem;
}

.history-main strong {
    overflow: hidden;
    color: var(--text-primary);
    font-size: 0.85rem;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.history-main span {
    color: var(--text-secondary);
    font-size: 0.75rem;
}

.history-actions {
    display: flex;
    flex-shrink: 0;
    gap: 0.35rem;
}

.history-actions button {
    padding: 0.35rem 0.65rem;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--card-bg);
    color: var(--text-primary);
    cursor: pointer;
    font-size: 0.78rem;
}

.history-actions button:hover {
    border-color: var(--accent-color);
    color: var(--accent-color);
}

.history-preview {
    padding: 0.55rem;
    border-top: 1px solid var(--border-color);
    background: var(--card-bg);
}

.changes-list {
    display: flex;
    flex-direction: column;
}

.changes-heading,
.change-row {
    display: grid;
    grid-template-columns: minmax(5rem, 0.8fr) minmax(0, 1fr) minmax(0, 1fr);
    gap: 0.6rem;
}

.changes-heading {
    padding: 0 0.35rem 0.35rem;
    color: var(--text-secondary);
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
}

.change-row {
    padding: 0.4rem 0.35rem;
    border-top: 1px solid var(--border-color);
    color: var(--text-primary);
    font-size: 0.75rem;
}

.change-row strong {
    overflow-wrap: anywhere;
}

.change-row span {
    overflow-wrap: anywhere;
    white-space: pre-wrap;
}

.protected-value {
    letter-spacing: 0.08em;
}

.no-changes {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.75rem;
}

@media (max-width: 620px) {
    .history-row {
        align-items: flex-start;
        flex-direction: column;
    }

    .changes-heading {
        display: none;
    }

    .change-row {
        grid-template-columns: 1fr;
        gap: 0.25rem;
    }

    .change-row span::before {
        color: var(--text-secondary);
        font-size: 0.65rem;
    }

    .change-row span:nth-child(2)::before {
        content: 'This version: ';
    }

    .change-row span:nth-child(3)::before {
        content: 'Current: ';
    }
}
</style>
