<template>
    <div
        class="group-node"
        :class="{ active: isSelected, nested: depth > 0 }"
        :style="{ paddingLeft: depth * 16 + 10 + 'px' }"
        @click="$emit('select', group.uuid)"
        @contextmenu.prevent="onRightClick"
    >
        <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            @click.stop="toggleCollapse"
            :class="{
                'has-children': hasChildren,
                collapsed: isCollapsed,
            }"
        >
            <!-- All Entries Icon -->
            <template v-if="isAllEntries">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="9" y1="21" x2="9" y2="9" />
            </template>
            <!-- Group Icon -->
            <template v-else>
                <path
                    v-if="hasChildren && !isCollapsed"
                    d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-3.21 8a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20"
                />
                <path
                    v-else
                    d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
                />
            </template>
        </svg>
        <span class="group-label">{{ groupName }}</span>
        <span class="group-badge">{{ entryCount }}</span>

        <!-- Context Menu Portal -->
        <Teleport to="body">
            <div
                v-if="contextMenu.visible"
                class="context-menu"
                :style="{
                    top: contextMenu.y + 'px',
                    left: contextMenu.x + 'px',
                }"
                @click.stop
            >
                <div class="menu-item" @click="handleAction('add')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                    Add Subgroup
                </div>
                <div class="menu-item" @click="handleAction('rename')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                    Rename
                </div>
                <div class="menu-item delete" @click="handleAction('delete')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6l-1 14H6L5 6"></path>
                        <path d="M10 11v6"></path>
                        <path d="M14 11v6"></path>
                        <path d="M9 6V4h6v2"></path>
                    </svg>
                    Delete
                </div>
            </div>
        </Teleport>
    </div>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue';

const props = defineProps({
    group: { type: Object, required: true },
    selectedGroupUuid: { type: String, default: null },
    isCollapsed: { type: Boolean, default: false },
    depth: { type: Number, default: 0 },
    allEntriesCount: { type: Number, default: 0 },
    refreshKey: { type: Number, default: 0 },
});

const emit = defineEmits([
    'select',
    'toggle-collapse',
    'add-group',
    'rename-group',
    'delete-group',
]);

const isAllEntries = computed(() => props.group.uuid === 'all');
const isSelected = computed(() => props.group.uuid === props.selectedGroupUuid);
const hasChildren = computed(() => {
    props.refreshKey;
    return props.group.children?.length > 0;
});
const groupName = computed(() => {
    props.refreshKey;
    return props.group.name;
});
const entryCount = computed(() => {
    props.refreshKey;
    return isAllEntries.value ? props.allEntriesCount : (props.group.entryCount || 0);
});

const contextMenu = ref({
    visible: false,
    x: 0,
    y: 0,
});

function toggleCollapse() {
    if (hasChildren.value) {
        emit('toggle-collapse', props.group.uuid);
    }
}

function onRightClick(event) {
    if (isAllEntries.value) return;
    
    contextMenu.value = {
        visible: true,
        x: event.clientX,
        y: event.clientY,
    };
}

function handleAction(action) {
    if (action === 'add') emit('add-group', props.group.uuid);
    else if (action === 'rename') emit('rename-group', props.group.uuid);
    else if (action === 'delete') emit('delete-group', props.group.uuid);
    contextMenu.value.visible = false;
}

function onGlobalClick() {
    if (contextMenu.value.visible) contextMenu.value.visible = false;
}

onMounted(() => document.addEventListener('click', onGlobalClick));
onUnmounted(() => document.removeEventListener('click', onGlobalClick));
</script>

<style scoped>
.group-node {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.6rem;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
    color: var(--text-secondary);
    font-size: 0.85rem;
    user-select: none;
}

.group-node:hover {
    background: var(--border-color);
    color: var(--text-primary);
}

.group-node.active {
    background: rgba(99, 102, 241, 0.15);
    color: var(--accent-color);
}

.group-node.active svg {
    color: var(--accent-color);
}

.group-node svg {
    flex-shrink: 0;
    color: var(--text-secondary);
    transition: transform 0.2s, fill 0.2s;
}

.group-node svg.has-children {
    cursor: pointer;
}

.group-node svg.has-children:hover {
    color: var(--text-primary);
    transform: scale(1.1);
}

.group-node svg.collapsed {
    fill: var(--text-secondary);
    fill-opacity: 0.1;
}

.group-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
}

.group-badge {
    font-size: 0.7rem;
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
    background: var(--badge-bg);
    color: var(--text-secondary);
    min-width: 18px;
    text-align: center;
}

.group-node.active .group-badge {
    background: rgba(99, 102, 241, 0.2);
    color: var(--accent-color);
}

/* Context Menu */
.context-menu {
    position: fixed;
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 0.4rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    z-index: 1000;
    min-width: 140px;
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.menu-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.6rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.8rem;
    color: var(--text-primary);
    transition: background 0.15s;
}

.menu-item svg { color: var(--text-secondary); }
.menu-item:hover { background: var(--badge-bg); }
.menu-item:hover svg { color: var(--text-primary); }
.menu-item.delete:hover {
    color: var(--error-color);
    background: rgba(239, 68, 68, 0.1);
}
.menu-item.delete:hover svg { color: var(--error-color); }
</style>
