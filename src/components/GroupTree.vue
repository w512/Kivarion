<template>
    <div class="group-tree">
        <!-- Virtual "All Entries" group -->
        <GroupNode
            v-if="depth === 0"
            :group="{ uuid: 'all', name: 'All Entries', entryCount: allEntriesCount, children: [] }"
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
            />

            <GroupTree
                v-if="group.children?.length && !isCollapsed(group.uuid)"
                :groups="group.children"
                :selected-group-uuid="selectedGroupUuid"
                :all-entries-count="allEntriesCount"
                :refresh-key="refreshKey"
                :depth="depth + 1"
                @select="(uuid) => emit('select', uuid)"
                @add-group="handleAddGroup"
                @rename-group="(uuid) => emit('rename-group', uuid)"
                @delete-group="(uuid) => emit('delete-group', uuid)"
                @empty-recycle-bin="(uuid) => emit('empty-recycle-bin', uuid)"
            />
        </div>
    </div>
</template>

<script setup>
import { ref } from 'vue';
import GroupNode from './GroupNode.vue';

const props = defineProps({
    groups: { type: Array, default: () => [] },
    selectedGroupUuid: { type: String, default: null },
    depth: { type: Number, default: 0 },
    allEntriesCount: { type: Number, default: 0 },
    refreshKey: { type: Number, default: 0 },
});

const emit = defineEmits([
    'select',
    'add-group',
    'rename-group',
    'delete-group',
    'empty-recycle-bin',
]);

const collapsedGroups = ref({});

function isCollapsed(uuid) {
    return !!collapsedGroups.value[uuid];
}

function toggleCollapse(uuid) {
    collapsedGroups.value[uuid] = !collapsedGroups.value[uuid];
}

function handleAddGroup(uuid) {
    // If a subgroup is added to a collapsed parent, expand it immediately so
    // the newly-created child is visible instead of appearing as if nothing happened.
    collapsedGroups.value[uuid] = false;
    emit('add-group', uuid);
}
</script>

<style scoped>
.group-tree {
    display: flex;
    flex-direction: column;
    gap: 1px;
}
</style>
