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
            <button
                v-if="!canRestore"
                class="add-btn"
                title="New entry"
                @click="emit('add')"
            >
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

        <div
            v-else
            ref="scrollRef"
            class="entries-container"
            @scroll="updateViewport"
            @keydown.capture="onListKeydown"
        >
            <div class="entries-spacer" :style="{ height: totalHeight + 'px' }">
                <div
                    v-for="row in visibleRows"
                    :key="row.entry.uuid"
                    class="entry-position"
                    :style="{ transform: `translateY(${row.top}px)` }"
                >
                    <EntryItem
                        :entry="row.entry"
                        :selected="isSelected(row.entry)"
                        :can-restore="canRestore"
                        @select="emit('select', row.entry.uuid)"
                        @restore="emit('restore', row.entry.uuid)"
                    />
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import EntryItem from './entry-list/EntryItem.vue';
import EntrySort from './entry-list/EntrySort.vue';
import EntryListEmpty from './entry-list/EntryListEmpty.vue';

const props = defineProps({
    entries: { type: Array, default: () => [] },
    selectedEntryUuid: { type: String, default: null },
    canRestore: { type: Boolean, default: false },
});

// Deleting an entry is offered by `EntryDetail`, not by a list row: there is no
// per-row delete button to emit from. Dragging an entry onto a group travels
// through the drag event's own `application/x-kivarion-entry` payload (set in
// `EntryItem`, read in `GroupNode`), so it needs no emit either.
const emit = defineEmits(['select', 'add', 'restore']);

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

const ROW_HEIGHT = 44;
const OVERSCAN = 6;
const scrollRef = ref(null);
const scrollTop = ref(0);
const viewportHeight = ref(600);
let resizeObserver = null;

const totalHeight = computed(() => sortedEntries.value.length * ROW_HEIGHT);
const visibleRows = computed(() => {
    const start = Math.max(
        0,
        Math.floor(scrollTop.value / ROW_HEIGHT) - OVERSCAN,
    );
    const count = Math.ceil(viewportHeight.value / ROW_HEIGHT) + OVERSCAN * 2;
    return sortedEntries.value.slice(start, start + count).map((entry, i) => ({
        entry,
        top: (start + i) * ROW_HEIGHT,
    }));
});

const isSelected = (entry) => entry.uuid === props.selectedEntryUuid;

function updateViewport() {
    const element = scrollRef.value;
    if (!element) return;
    scrollTop.value = element.scrollTop || 0;
    viewportHeight.value = element.clientHeight || 600;
}

function scrollRowIntoView(index) {
    const element = scrollRef.value;
    if (!element || index < 0) return;
    const top = index * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (bottom > element.scrollTop + element.clientHeight) {
        element.scrollTop = bottom - element.clientHeight;
    }
    updateViewport();
}

async function focusEntry(uuid) {
    await nextTick();
    const rows = scrollRef.value?.querySelectorAll?.('[data-entry-uuid]') || [];
    Array.from(rows)
        .find((row) => row.dataset.entryUuid === uuid)
        ?.focus();
}

function onListKeydown(event) {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const uuid =
        event.target?.closest?.('[data-entry-uuid]')?.dataset?.entryUuid;
    const index = sortedEntries.value.findIndex((entry) => entry.uuid === uuid);
    if (index < 0) return;

    event.preventDefault();
    const nextIndex =
        event.key === 'ArrowDown'
            ? Math.min(index + 1, sortedEntries.value.length - 1)
            : Math.max(index - 1, 0);
    const next = sortedEntries.value[nextIndex];
    scrollRowIntoView(nextIndex);
    if (next) void focusEntry(next.uuid);
}

watch(
    () => props.selectedEntryUuid,
    (uuid) => {
        const index = sortedEntries.value.findIndex(
            (entry) => entry.uuid === uuid,
        );
        scrollRowIntoView(index);
    },
);

onMounted(() => {
    updateViewport();
    if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(updateViewport);
        if (scrollRef.value) resizeObserver.observe(scrollRef.value);
    }
});

onUnmounted(() => resizeObserver?.disconnect());
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
    min-height: 0;
    overflow-y: auto;
}

.entries-spacer {
    position: relative;
    width: 100%;
}

.entry-position {
    position: absolute;
    inset: 0 0 auto;
    height: 44px;
    padding-bottom: 2px;
    box-sizing: border-box;
}

.entry-position :deep(.entry-row) {
    height: 42px;
    box-sizing: border-box;
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
