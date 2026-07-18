<template>
    <div class="group-tree" @keydown.capture="onTreeKeydown">
        <!-- Virtual "All Entries" group -->
        <GroupNode
            v-if="depth === 0"
            :group="{
                uuid: 'all',
                name: 'All Entries',
                entryCount: allEntriesCount,
                children: [],
            }"
            :selected-group-uuid="selectedGroupUuid"
            :all-entries-count="allEntriesCount"
            :refresh-key="refreshKey"
            :depth="0"
            @select="emit('select', $event)"
        />

        <!-- Regular groups -->
        <div v-for="group in groups" :key="group.uuid">
            <GroupNode
                :group="group"
                :selected-group-uuid="selectedGroupUuid"
                :is-collapsed="isCollapsed(group.uuid)"
                :refresh-key="refreshKey"
                :depth="depth"
                @select="emit('select', $event)"
                @toggle-collapse="toggleCollapse"
                @add-group="handleAddGroup"
                @rename-group="emit('rename-group', $event)"
                @delete-group="emit('delete-group', $event)"
                @empty-recycle-bin="emit('empty-recycle-bin', $event)"
                @move-group="handleMoveGroup"
                @move-entry="handleMoveEntry"
            />

            <GroupTree
                v-if="group.children?.length && !isCollapsed(group.uuid)"
                :groups="group.children"
                :selected-group-uuid="selectedGroupUuid"
                :all-entries-count="allEntriesCount"
                :refresh-key="refreshKey"
                :collapsed-groups="collapsedGroups"
                :depth="depth + 1"
                @select="(uuid) => emit('select', uuid)"
                @add-group="handleAddGroup"
                @rename-group="(uuid) => emit('rename-group', uuid)"
                @delete-group="(uuid) => emit('delete-group', uuid)"
                @empty-recycle-bin="(uuid) => emit('empty-recycle-bin', uuid)"
                @move-group="handleMoveGroup"
                @move-entry="handleMoveEntry"
            />
        </div>
    </div>
</template>

<script setup>
import GroupNode from './GroupNode.vue';

const props = defineProps({
    groups: { type: Array, default: () => [] },
    selectedGroupUuid: { type: String, default: null },
    depth: { type: Number, default: 0 },
    allEntriesCount: { type: Number, default: 0 },
    refreshKey: { type: Number, default: 0 },
    collapsedGroups: { type: Object, default: () => ({}) },
});

const emit = defineEmits([
    'select',
    'add-group',
    'rename-group',
    'delete-group',
    'empty-recycle-bin',
    'move-group',
    'move-entry',
]);

function isCollapsed(uuid) {
    return !!props.collapsedGroups[uuid];
}

function toggleCollapse(uuid) {
    props.collapsedGroups[uuid] = !props.collapsedGroups[uuid];
}

function handleAddGroup(uuid) {
    // If a subgroup is added to a collapsed parent, expand it immediately so
    // the newly-created child is visible instead of appearing as if nothing happened.
    props.collapsedGroups[uuid] = false;
    emit('add-group', uuid);
}

function handleMoveGroup(payload) {
    // When nesting a group into a collapsed target, expand it so the moved group
    // is visible instead of seeming to vanish.
    if (payload?.position === 'inside' && payload.targetUuid) {
        props.collapsedGroups[payload.targetUuid] = false;
    }
    emit('move-group', payload);
}

function handleMoveEntry(payload) {
    emit('move-entry', payload);
}

function onTreeKeydown(event) {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const nodes = Array.from(
        event.currentTarget.querySelectorAll('.group-node[tabindex="0"]'),
    );
    const index = nodes.indexOf(document.activeElement);
    if (index < 0) return;

    event.preventDefault();
    const nextIndex =
        event.key === 'ArrowDown'
            ? Math.min(index + 1, nodes.length - 1)
            : Math.max(index - 1, 0);
    nodes[nextIndex]?.focus();
}
</script>

<style scoped>
.group-tree {
    display: flex;
    flex-direction: column;
    gap: 1px;
}
</style>
