<template>
    <div
        class="group-node"
        :class="{
            active: isSelected,
            nested: depth > 0,
            dragging: isDragging,
            'drag-over-inside': dropClass === 'inside',
            'drag-over-before': dropClass === 'before',
            'drag-over-after': dropClass === 'after',
        }"
        :style="{ paddingLeft: depth * 16 + 10 + 'px' }"
        :draggable="isDraggable"
        role="treeitem"
        tabindex="0"
        :aria-selected="isSelected"
        :aria-expanded="hasChildren ? !isCollapsed : undefined"
        :data-group-uuid="group.uuid"
        @click="$emit('select', group.uuid)"
        @contextmenu.prevent="onRightClick"
        @keydown.enter.prevent="$emit('select', group.uuid)"
        @keydown.space.prevent="$emit('select', group.uuid)"
        @keydown.right.prevent="expand"
        @keydown.left.prevent="collapse"
        @dragstart="onDragStart"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop.prevent="onDrop"
        @dragend="onDragEnd"
    >
        <!-- "All Entries" is a UI row rather than a group in the database, so it
             keeps its own glyph and has nothing to collapse. -->
        <svg
            v-if="isAllEntries"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="collapse-toggle"
        >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <line x1="3" y1="9" x2="21" y2="9" />
            <line x1="9" y1="21" x2="9" y2="9" />
        </svg>
        <!-- The icon doubles as the collapse toggle, so it has to keep the
             class (drag-start skips it) and the handlers. -->
        <ObjectIcon
            v-else
            :src="iconSrc"
            :icon-id="displayIconId"
            :fallback-icon-id="DEFAULT_GROUP_ICON"
            :size="18"
            class="collapse-toggle"
            :class="{ 'has-children': hasChildren }"
            @click.stop="toggleCollapse"
            @mousedown.stop
        />
        <span class="group-label">{{ groupName }}</span>
        <span class="group-badge">{{ entryCount }}</span>

        <!-- Context Menu Portal -->
        <Teleport to="body">
            <div
                v-if="contextMenu.visible"
                ref="contextMenuRef"
                class="context-menu"
                :style="{
                    top: contextMenu.y + 'px',
                    left: contextMenu.x + 'px',
                    // Hidden for the one frame it takes to measure the menu and
                    // pull it back inside the window, so it is never seen in
                    // the wrong place.
                    visibility: contextMenu.placed ? 'visible' : 'hidden',
                }"
                @click.stop
            >
                <div
                    v-if="isInRecycleBin"
                    class="menu-item restore"
                    @click="handleAction('restore')"
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
                    >
                        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                        <path d="M3 3v5h5" />
                    </svg>
                    Restore Group
                </div>
                <div
                    v-if="!isRecycleBin && !isInRecycleBin"
                    class="menu-item"
                    @click="handleAction('add')"
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
                    >
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                    Add Subgroup
                </div>
                <div class="menu-item" @click="handleAction('rename')">
                    <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <path
                            d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"
                        ></path>
                        <path
                            d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
                        ></path>
                    </svg>
                    Rename
                </div>
                <div
                    v-if="!isRecycleBin"
                    class="menu-item"
                    @click="handleAction('change-icon')"
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
                    >
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <circle cx="9" cy="9" r="2" />
                        <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                    </svg>
                    Change Icon…
                </div>
                <div
                    v-if="!isRoot && !isRecycleBin"
                    class="menu-item delete"
                    @click="handleAction('delete')"
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
                    >
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6l-1 14H6L5 6"></path>
                        <path d="M10 11v6"></path>
                        <path d="M14 11v6"></path>
                        <path d="M9 6V4h6v2"></path>
                    </svg>
                    Delete
                </div>
                <div
                    v-if="isRecycleBin"
                    class="menu-item delete"
                    @click="handleAction('empty')"
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
                    >
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6l-1 14H6L5 6"></path>
                        <path d="M8 6V4h8v2"></path>
                    </svg>
                    Empty Recycle Bin
                </div>
            </div>
        </Teleport>
    </div>
</template>

<script setup>
import { computed, nextTick, ref, onMounted, onUnmounted } from 'vue';
import { useGroupDragDrop } from '../composables/useGroupDragDrop.js';
import ObjectIcon from './ObjectIcon.vue';
import { DEFAULT_GROUP_ICON, OPEN_FOLDER_ICON } from '../standardIcons.js';

const props = defineProps({
    group: { type: Object, required: true },
    selectedGroupUuid: { type: String, default: null },
    isCollapsed: { type: Boolean, default: false },
    depth: { type: Number, default: 0 },
    allEntriesCount: { type: Number, default: 0 },
});

const emit = defineEmits([
    'select',
    'toggle-collapse',
    'add-group',
    'rename-group',
    'delete-group',
    'restore-group',
    'empty-recycle-bin',
    'change-icon',
    'move-group',
    'move-entry',
]);

const isAllEntries = computed(() => props.group.uuid === 'all');
const isRecycleBin = computed(() => props.group.isRecycleBin === true);
const isInRecycleBin = computed(
    () => props.group.isInRecycleBin === true && !isRecycleBin.value,
);
const isRoot = computed(() => props.depth === 0 && !isAllEntries.value);
const isSelected = computed(() => props.group.uuid === props.selectedGroupUuid);
// `group` is a plain node from `buildDatabaseView`, rebuilt from scratch on
// every `dbVersion` change — so these track the database without the
// `refreshKey` prop this component used to take and read for its side effect.
// That prop suggested the component reaches into the kdbx graph, which it does
// not: nothing here is read off a live kdbxweb object.
const hasChildren = computed(() => props.group.children?.length > 0);
const groupName = computed(() => props.group.name);
const iconSrc = computed(() => props.group.iconSrc || null);

// A group left on the default folder icon still opens and closes with the
// branch, which is the only cue this row has that it can be expanded — a group
// the user gave an icon of its own keeps that icon in both states.
const displayIconId = computed(() => {
    const id = props.group.iconId ?? DEFAULT_GROUP_ICON;
    if (id !== DEFAULT_GROUP_ICON && id !== OPEN_FOLDER_ICON) return id;
    return hasChildren.value && !props.isCollapsed
        ? OPEN_FOLDER_ICON
        : DEFAULT_GROUP_ICON;
});
const entryCount = computed(() =>
    isAllEntries.value
        ? props.allEntriesCount
        : (props.group.recursiveEntryCount ?? props.group.entryCount ?? 0),
);

const contextMenu = ref({
    visible: false,
    placed: false,
    x: 0,
    y: 0,
});
const contextMenuRef = ref(null);

// Distance kept between the menu and the window edge when it has to be pulled
// back in.
const CONTEXT_MENU_MARGIN = 8;

function toggleCollapse() {
    if (hasChildren.value) {
        emit('toggle-collapse', props.group.uuid);
    }
}

function expand() {
    if (hasChildren.value && props.isCollapsed) {
        emit('toggle-collapse', props.group.uuid);
    }
}

function collapse() {
    if (hasChildren.value && !props.isCollapsed) {
        emit('toggle-collapse', props.group.uuid);
    }
}

/**
 * Keep the menu inside the window.
 *
 * Placed at the pointer alone, a right-click near the bottom or right edge of
 * the window put part of the menu — including whole items — outside it, with
 * nothing to scroll to reach them. The size is only known once it is rendered,
 * so it is measured and then pulled back; `placed` keeps it invisible until it
 * has been.
 */
async function onRightClick(event) {
    if (isAllEntries.value) return;

    contextMenu.value = {
        visible: true,
        placed: false,
        x: event.clientX,
        y: event.clientY,
    };

    await nextTick();
    // The menu can be gone already — a click elsewhere closes it.
    if (!contextMenu.value.visible) return;

    // Without a measurement, show it where the pointer was: a menu that stays
    // invisible is a worse outcome than one near the edge.
    const rect = contextMenuRef.value?.getBoundingClientRect?.();
    const { x, y } = contextMenu.value;
    contextMenu.value = {
        visible: true,
        placed: true,
        x: rect ? clampToViewport(x, rect.width, window.innerWidth) : x,
        y: rect ? clampToViewport(y, rect.height, window.innerHeight) : y,
    };
}

function clampToViewport(position, size, available) {
    // The lower bound wins when the menu is larger than the window, which is
    // the better half to show.
    return Math.max(
        CONTEXT_MENU_MARGIN,
        Math.min(position, available - size - CONTEXT_MENU_MARGIN),
    );
}

function handleAction(action) {
    if (action === 'add') emit('add-group', props.group.uuid);
    else if (action === 'rename') emit('rename-group', props.group.uuid);
    else if (action === 'delete') emit('delete-group', props.group.uuid);
    else if (action === 'restore') emit('restore-group', props.group.uuid);
    else if (action === 'empty') emit('empty-recycle-bin', props.group.uuid);
    else if (action === 'change-icon') emit('change-icon', props.group.uuid);
    contextMenu.value.visible = false;
}

// Drag and drop
const {
    draggingUuid,
    dropTarget,
    startDrag,
    endDrag,
    setDropTarget,
    clearDropTarget,
    isInvalidTarget,
} = useGroupDragDrop();

const isDraggable = computed(
    () => !isAllEntries.value && !isRoot.value && !isRecycleBin.value,
);
const isDragging = computed(() => draggingUuid.value === props.group.uuid);
const entryDropTarget = ref(false);
const dropClass = computed(() => {
    if (entryDropTarget.value) return 'inside';
    return dropTarget.value?.uuid === props.group.uuid
        ? dropTarget.value.position
        : null;
});

const ENTRY_DRAG_TYPE = 'application/x-kivarion-entry';

/**
 * Is an entry being dragged over this row?
 *
 * Only the *types* may be read while a drag is in progress — the drag data
 * store is in protected mode until the drop, and `getData` returns an empty
 * string there. Asking for the value in `dragover` meant the entry branch never
 * ran, so the handler returned without `preventDefault()`, the browser refused
 * the drop, and `onDrop` (with the `move-entry` it emits) never fired at all.
 * Which entry it is does not matter here; that is read on drop.
 */
function isEntryDrag(event) {
    const types = event.dataTransfer?.types;
    // A frozen array per the spec, but a `DOMStringList` in older WebKit, so
    // don't assume it has `includes` of its own.
    return types ? Array.from(types).includes(ENTRY_DRAG_TYPE) : false;
}

function draggedEntryUuid(event) {
    return event.dataTransfer?.getData(ENTRY_DRAG_TYPE) || '';
}

function onDragStart(event) {
    // Don't start a drag from the collapse/expand icon — let its click toggle.
    if (!isDraggable.value || event.target.closest?.('.collapse-toggle')) {
        event.preventDefault();
        return;
    }
    startDrag(props.group);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', props.group.uuid);
}

function onDragOver(event) {
    if (isEntryDrag(event) && !isAllEntries.value) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        entryDropTarget.value = true;
        return;
    }

    if (
        isAllEntries.value ||
        !draggingUuid.value ||
        isInvalidTarget(props.group.uuid)
    )
        return;

    let position = 'inside';
    if (!isRoot.value) {
        const rect = event.currentTarget.getBoundingClientRect();
        const offset = event.clientY - rect.top;
        if (offset < rect.height * 0.3) position = 'before';
        else if (offset > rect.height * 0.7) position = 'after';
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTarget(props.group.uuid, position);
}

function onDragLeave() {
    entryDropTarget.value = false;
    if (dropTarget.value?.uuid === props.group.uuid) clearDropTarget();
}

function onDrop(event) {
    // Decided the same way as in `onDragOver`, so a drop that was allowed for
    // an entry can never be handled as a group move; the uuid is readable now.
    if (isEntryDrag(event) && !isAllEntries.value) {
        entryDropTarget.value = false;
        const entryUuid = draggedEntryUuid(event);
        if (entryUuid) {
            emit('move-entry', {
                entryUuid,
                targetGroupUuid: props.group.uuid,
            });
        }
        return;
    }

    const draggedUuid = draggingUuid.value;
    const position =
        dropTarget.value?.uuid === props.group.uuid
            ? dropTarget.value.position
            : null;
    clearDropTarget();
    if (!draggedUuid || !position) return;
    emit('move-group', { draggedUuid, targetUuid: props.group.uuid, position });
}

function onDragEnd() {
    entryDropTarget.value = false;
    endDrag();
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

/* Drag and drop */
.group-node[draggable='true'] {
    cursor: grab;
}

.group-node.dragging {
    opacity: 0.4;
}

.group-node.drag-over-inside {
    background: rgba(99, 102, 241, 0.15);
    outline: 2px solid var(--accent-color);
    outline-offset: -2px;
}

/* Sibling insert line for before/after drops. The node is positioned so the
   pseudo-element line can sit on its top/bottom edge. */
.group-node.drag-over-before,
.group-node.drag-over-after {
    position: relative;
}

.group-node.drag-over-before::before,
.group-node.drag-over-after::after {
    content: '';
    position: absolute;
    left: 6px;
    right: 6px;
    height: 2px;
    background: var(--accent-color);
    border-radius: 1px;
}

.group-node.drag-over-before::before {
    top: -1px;
}

.group-node.drag-over-after::after {
    bottom: -1px;
}

/* The row's icon — the "All Entries" glyph, a standard icon or a custom image —
   always occupies the same 18px box, or rows drift out of their virtualized
   slots. */
.group-node > .collapse-toggle {
    flex-shrink: 0;
    color: var(--text-secondary);
    transition: transform 0.2s;
}

.group-node > .collapse-toggle.has-children {
    cursor: pointer;
}

.group-node > .collapse-toggle.has-children:hover {
    color: var(--text-primary);
    transform: scale(1.1);
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

.menu-item svg {
    color: var(--text-secondary);
}
.menu-item:hover {
    background: var(--badge-bg);
}
.menu-item:hover svg {
    color: var(--text-primary);
}
.menu-item.restore:hover {
    color: var(--accent-color);
    background: rgba(99, 102, 241, 0.1);
}
.menu-item.restore:hover svg {
    color: var(--accent-color);
}
.menu-item.delete:hover {
    color: var(--error-color);
    background: rgba(239, 68, 68, 0.1);
}
.menu-item.delete:hover svg {
    color: var(--error-color);
}
</style>
