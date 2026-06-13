import { ref } from 'vue';

// Singleton drag state shared across the recursively-rendered group tree, so a
// drag started in one GroupNode is visible to every other node without prop
// drilling. There is only ever one tree on screen, so module-level refs are fine.
const draggingUuid = ref(null);
const draggingDescendants = ref(new Set());
const dropTarget = ref(null); // { uuid, position } | null

function collectUuids(node, set) {
    if (!node?.uuid) return;
    set.add(node.uuid);
    for (const child of node.children || []) collectUuids(child, set);
}

function startDrag(node) {
    draggingUuid.value = node?.uuid || null;
    const set = new Set();
    collectUuids(node, set);
    draggingDescendants.value = set;
}

function endDrag() {
    draggingUuid.value = null;
    draggingDescendants.value = new Set();
    dropTarget.value = null;
}

function setDropTarget(uuid, position) {
    dropTarget.value = { uuid, position };
}

function clearDropTarget() {
    dropTarget.value = null;
}

// A node is an invalid target if it's the dragged group itself or one of its
// descendants (would create a cycle).
function isInvalidTarget(uuid) {
    return draggingDescendants.value.has(uuid);
}

export function useGroupDragDrop() {
    return {
        draggingUuid,
        dropTarget,
        startDrag,
        endDrag,
        setDropTarget,
        clearDropTarget,
        isInvalidTarget,
    };
}
