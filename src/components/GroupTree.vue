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
                @add-group="emit('add-group', $event)"
                @rename-group="emit('rename-group', $event)"
                @delete-group="emit('delete-group', $event)"
            />

            <GroupTree
                v-if="group.children?.length && !isCollapsed(group.uuid)"
                :groups="group.children"
                :selected-group-uuid="selectedGroupUuid"
                :all-entries-count="allEntriesCount"
                :refresh-key="refreshKey"
                :depth="depth + 1"
                @select="(uuid) => emit('select', uuid)"
                @add-group="(uuid) => emit('add-group', uuid)"
                @rename-group="(uuid) => emit('rename-group', uuid)"
                @delete-group="(uuid) => emit('delete-group', uuid)"
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
]);

const collapsedGroups = ref({});

function isCollapsed(uuid) {
    return !!collapsedGroups.value[uuid];
}

function toggleCollapse(uuid) {
    collapsedGroups.value[uuid] = !collapsedGroups.value[uuid];
}
</script>

<style scoped>
.group-tree {
    display: flex;
    flex-direction: column;
    gap: 1px;
}
</style>
