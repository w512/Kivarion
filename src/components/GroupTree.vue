<template>
    <div
        ref="scrollRef"
        class="group-tree"
        role="tree"
        @scroll="updateViewport"
        @keydown.capture="onTreeKeydown"
    >
        <div class="tree-spacer" :style="{ height: totalHeight + 'px' }">
            <div
                v-for="row in visibleRows"
                :key="row.group.uuid"
                class="group-position"
                :style="{ transform: `translateY(${row.top}px)` }"
            >
                <GroupNode
                    :group="row.group"
                    :selected-group-uuid="selectedGroupUuid"
                    :is-collapsed="isCollapsed(row.group.uuid)"
                    :all-entries-count="allEntriesCount"
                    :refresh-key="refreshKey"
                    :depth="row.depth"
                    @select="emit('select', $event)"
                    @toggle-collapse="toggleCollapse"
                    @add-group="handleAddGroup"
                    @rename-group="emit('rename-group', $event)"
                    @delete-group="emit('delete-group', $event)"
                    @restore-group="emit('restore-group', $event)"
                    @empty-recycle-bin="emit('empty-recycle-bin', $event)"
                    @move-group="handleMoveGroup"
                    @move-entry="emit('move-entry', $event)"
                />
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import GroupNode from './GroupNode.vue';

const props = defineProps({
    groups: { type: Array, default: () => [] },
    selectedGroupUuid: { type: String, default: null },
    depth: { type: Number, default: 0 },
    allEntriesCount: { type: Number, default: 0 },
    refreshKey: { type: Number, default: 0 },
});

// A model rather than a prop this component writes into: the parent owns the
// map (it persists it per database), and mutating its object in place only
// worked because that parent happened to deep-watch a ref.
const collapsedGroups = defineModel('collapsedGroups', {
    type: Object,
    default: () => ({}),
});

const emit = defineEmits([
    'select',
    'add-group',
    'rename-group',
    'delete-group',
    'restore-group',
    'empty-recycle-bin',
    'move-group',
    'move-entry',
]);

const ROW_HEIGHT = 37;
const OVERSCAN = 8;
const scrollRef = ref(null);
const scrollTop = ref(0);
const viewportHeight = ref(600);
let resizeObserver = null;

const allEntriesGroup = computed(() => ({
    uuid: 'all',
    name: 'All Entries',
    entryCount: props.allEntriesCount,
    recursiveEntryCount: props.allEntriesCount,
    children: [],
}));

// Flatten only expanded branches. Besides making virtualization straightforward,
// this removes one Vue component instance per recursion level/node.
const flattenedGroups = computed(() => {
    props.refreshKey;
    const rows = [];
    if (props.depth === 0) {
        rows.push({ group: allEntriesGroup.value, depth: 0 });
    }

    function append(groups, depth) {
        for (const group of groups) {
            rows.push({ group, depth });
            if (group.children?.length && !isCollapsed(group.uuid)) {
                append(group.children, depth + 1);
            }
        }
    }

    append(props.groups, props.depth);
    return rows;
});

const totalHeight = computed(() => flattenedGroups.value.length * ROW_HEIGHT);
const visibleRows = computed(() => {
    const start = Math.max(
        0,
        Math.floor(scrollTop.value / ROW_HEIGHT) - OVERSCAN,
    );
    const count = Math.ceil(viewportHeight.value / ROW_HEIGHT) + OVERSCAN * 2;
    return flattenedGroups.value.slice(start, start + count).map((row, i) => ({
        ...row,
        top: (start + i) * ROW_HEIGHT,
    }));
});

function isCollapsed(uuid) {
    return !!collapsedGroups.value[uuid];
}

// Only collapsed groups are recorded, and expanding one drops its key rather
// than storing `false`. The map is persisted per database, so an entry for
// every group the user ever touched would grow for the life of the vault.
function setCollapsed(uuid, collapsed) {
    const next = { ...collapsedGroups.value };
    if (collapsed) next[uuid] = true;
    else delete next[uuid];
    collapsedGroups.value = next;
}

function toggleCollapse(uuid) {
    setCollapsed(uuid, !isCollapsed(uuid));
}

function handleAddGroup(uuid) {
    setCollapsed(uuid, false);
    emit('add-group', uuid);
}

function handleMoveGroup(payload) {
    if (payload?.position === 'inside' && payload.targetUuid) {
        setCollapsed(payload.targetUuid, false);
    }
    emit('move-group', payload);
}

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

async function focusGroup(uuid) {
    await nextTick();
    const nodes =
        scrollRef.value?.querySelectorAll?.('[data-group-uuid]') || [];
    Array.from(nodes)
        .find((node) => node.dataset.groupUuid === uuid)
        ?.focus();
}

function onTreeKeydown(event) {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const uuid =
        event.target?.closest?.('[data-group-uuid]')?.dataset?.groupUuid;
    const index = flattenedGroups.value.findIndex(
        (row) => row.group.uuid === uuid,
    );
    if (index < 0) return;

    event.preventDefault();
    const nextIndex =
        event.key === 'ArrowDown'
            ? Math.min(index + 1, flattenedGroups.value.length - 1)
            : Math.max(index - 1, 0);
    const next = flattenedGroups.value[nextIndex];
    scrollRowIntoView(nextIndex);
    if (next) void focusGroup(next.group.uuid);
}

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
.group-tree {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
}

.tree-spacer {
    position: relative;
    width: 100%;
}

.group-position {
    position: absolute;
    inset: 0 0 auto;
    height: 37px;
    padding-bottom: 1px;
    box-sizing: border-box;
}

.group-position :deep(.group-node) {
    height: 36px;
    padding-top: 0;
    padding-bottom: 0;
    box-sizing: border-box;
}
</style>
