<template>
    <div class="entry-list">
        <div class="list-header">
            <div class="header-left">
                <span class="list-count">
                    {{ entries.length }}
                    {{ entries.length === 1 ? 'entry' : 'entries' }}
                </span>
                <EntrySort v-model="currentSort" />
            </div>
            <button class="add-btn" title="New entry" @click="emit('add')">
                <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
            </button>
        </div>

        <EntryListEmpty v-if="entries.length === 0" />

        <div v-else class="entries-container">
            <EntryItem
                v-for="entry in sortedEntries"
                :key="entry.uuid"
                :entry="entry"
                :selected="isSelected(entry)"
                @select="emit('select', entry.uuid)"
            />
        </div>
    </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import EntryItem from './entry-list/EntryItem.vue';
import EntrySort from './entry-list/EntrySort.vue';
import EntryListEmpty from './entry-list/EntryListEmpty.vue';

const props = defineProps({
    entries: { type: Array, default: () => [] },
    selectedEntryUuid: { type: String, default: null },
});

const emit = defineEmits(['select', 'add', 'delete']);

// Normalize persisted value (legacy 'date' meant last-modified -> 'created' here).
function normalizeSortBy(v) {
    if (v === 'title' || v === 'created' || v === 'modified') return v;
    if (v === 'date') return 'created';
    return 'title';
}

const sortBy = ref(normalizeSortBy(localStorage.getItem('kivarion-sort-by')));
const sortDesc = ref(localStorage.getItem('kivarion-sort-desc') === 'true');

watch([sortBy, sortDesc], () => {
    localStorage.setItem('kivarion-sort-by', sortBy.value);
    localStorage.setItem('kivarion-sort-desc', sortDesc.value);
});

const currentSort = computed({
    get: () => `${sortBy.value}-${sortDesc.value ? 'desc' : 'asc'}`,
    set: (val) => {
        const [field, dir] = val.split('-');
        sortBy.value = field;
        sortDesc.value = dir === 'desc';
    },
});

const sortedEntries = computed(() => {
    const list = [...props.entries];
    return list.sort((a, b) => {
        let valA, valB;
        if (sortBy.value === 'title') {
            valA = (a.title || '').toLowerCase();
            valB = (b.title || '').toLowerCase();
        } else if (sortBy.value === 'modified') {
            valA = a.modifiedAt || new Date(0);
            valB = b.modifiedAt || new Date(0);
        } else {
            valA = a.createdAt || new Date(0);
            valB = b.createdAt || new Date(0);
        }
        if (valA < valB) return sortDesc.value ? 1 : -1;
        if (valA > valB) return sortDesc.value ? -1 : 1;
        return 0;
    });
});

const isSelected = (entry) => entry.uuid === props.selectedEntryUuid;
</script>

<style scoped>
.entry-list {
    display: flex;
    flex-direction: column;
    height: 100%;
}

.list-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 0.5rem 0.75rem 0.5rem;
    border-bottom: 1px solid var(--border-color);
    margin-bottom: 0.5rem;
    flex-shrink: 0;
}

.header-left {
    display: flex;
    align-items: center;
    gap: 1rem;
}

.list-count {
    font-size: 0.7rem;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 600;
}

.entries-container {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.add-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s;
}

.add-btn:hover {
    background: rgba(99, 102, 241, 0.1);
    border-color: var(--accent-color);
    color: var(--accent-color);
}
</style>
