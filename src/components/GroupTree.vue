<template>
    <div class="group-tree">
        <!-- Virtual "All Entries" group -->
        <GroupNode
            v-if="depth === 0"
            :group="{ uuid: { id: 'all' }, name: 'All Entries' }"
            :selected-group-uuid="selectedGroupUuid"
            :all-entries-count="allEntriesCount"
            :refresh-key="refreshKey"
            :depth="0"
            @select="emit('select', $event)"
        />

        <!-- Regular groups -->
        <div v-for="group in groups" :key="group.uuid?.id">
            <GroupNode
                :group="group"
                :selected-group-uuid="selectedGroupUuid"
                :is-collapsed="isCollapsed(group)"
                :refresh-key="refreshKey"
                :depth="depth"
                @select="emit('select', $event)"
                @toggle-collapse="toggleCollapse"
                @add-group="emit('add-group', $event)"
                @rename-group="emit('rename-group', $event)"
                @delete-group="emit('delete-group', $event)"
            />

            <GroupTree
                v-if="group.groups?.length && !isCollapsed(group)"
                :groups="group.groups"
                :selected-group-uuid="selectedGroupUuid"
                :all-entries-count="allEntriesCount"
                :refresh-key="refreshKey"
                :depth="depth + 1"
                @select="(g) => emit('select', g)"
                @add-group="(g) => emit('add-group', g)"
                @rename-group="(g) => emit('rename-group', g)"
                @delete-group="(g) => emit('delete-group', g)"
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

function isCollapsed(group) {
    return !!collapsedGroups.value[group.uuid?.id];
}

function toggleCollapse(group) {
    const id = group.uuid?.id;
    collapsedGroups.value[id] = !collapsedGroups.value[id];
}
</script>

<style scoped>
.group-tree {
    display: flex;
    flex-direction: column;
    gap: 1px;
}
</style>

