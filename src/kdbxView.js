import * as kdbxweb from 'kdbxweb';
import { getField, isProtectedValue, STANDARD_FIELDS } from './utils.js';

export const ALL_ENTRIES_UUID = 'all';

export function getObjectUuid(obj) {
    if (typeof obj === 'string') return obj;
    return typeof obj?.uuid === 'string'
        ? obj.uuid
        : obj?.uuid?.id || obj?.id || null;
}

export function getDefaultGroup(db) {
    return db?.getDefaultGroup?.() || null;
}

export function isRecycleBinGroup(db, group) {
    if (!db?.meta?.recycleBinUuid || !group?.uuid) return false;
    return typeof group.uuid.equals === 'function'
        ? group.uuid.equals(db.meta.recycleBinUuid)
        : getObjectUuid(group) === db.meta.recycleBinUuid?.id;
}

export function findGroupByUuid(db, uuid) {
    if (!db || !uuid || uuid === ALL_ENTRIES_UUID) return null;
    return findGroupInTree(getDefaultGroup(db), uuid);
}

function findGroupInTree(group, uuid) {
    if (!group) return null;
    if (getObjectUuid(group) === uuid) return group;

    for (const child of group.groups || []) {
        const found = findGroupInTree(child, uuid);
        if (found) return found;
    }

    return null;
}

export function findEntryByUuid(db, uuid) {
    if (!db || !uuid) return null;
    return findEntryInGroup(getDefaultGroup(db), uuid);
}

function findEntryInGroup(group, uuid) {
    if (!group) return null;

    for (const entry of group.entries || []) {
        if (getObjectUuid(entry) === uuid) return entry;
    }

    for (const child of group.groups || []) {
        const found = findEntryInGroup(child, uuid);
        if (found) return found;
    }

    return null;
}

/**
 * Every group UUID in the database, the Recycle Bin and its contents included.
 *
 * Used to drop per-group UI state (collapsed branches) for groups that no
 * longer exist. Deliberately independent of `buildDatabaseView`: this runs once
 * when a database is opened, before that computed exists.
 */
export function collectGroupUuids(db) {
    const uuids = new Set();
    addGroupUuids(getDefaultGroup(db), uuids);
    return uuids;
}

function addGroupUuids(group, uuids) {
    if (!group) return;
    uuids.add(getObjectUuid(group));
    for (const child of group.groups || []) addGroupUuids(child, uuids);
}

export function groupContainsGroupUuid(group, uuid) {
    if (!group || !uuid) return false;
    if (getObjectUuid(group) === uuid) return true;
    return (group.groups || []).some((child) =>
        groupContainsGroupUuid(child, uuid),
    );
}

export function groupContainsEntryUuid(group, uuid) {
    if (!group || !uuid) return false;
    if ((group.entries || []).some((entry) => getObjectUuid(entry) === uuid))
        return true;
    return (group.groups || []).some((child) =>
        groupContainsEntryUuid(child, uuid),
    );
}

export function normalizeGroupName(name) {
    return (name || '').trim();
}

export function groupNameExistsInParent(
    group,
    name,
    excludeUuid = getObjectUuid(group),
) {
    const parent = group?.parentGroup;
    const normalized = normalizeGroupName(name).toLocaleLowerCase();
    if (!parent || !normalized) return false;

    return (parent.groups || []).some((sibling) => {
        return (
            getObjectUuid(sibling) !== excludeUuid &&
            normalizeGroupName(sibling.name).toLocaleLowerCase() === normalized
        );
    });
}

export function getUniqueGroupName(parentGroup, baseName = 'New group') {
    const base = normalizeGroupName(baseName) || 'New group';
    const names = new Set(
        (parentGroup?.groups || []).map((group) =>
            normalizeGroupName(group.name).toLocaleLowerCase(),
        ),
    );
    if (!names.has(base.toLocaleLowerCase())) return base;

    let i = 2;
    while (names.has(`${base} ${i}`.toLocaleLowerCase())) i++;
    return `${base} ${i}`;
}

export function getAllEntries(db, group = getDefaultGroup(db)) {
    const entries = [];
    collectEntries(db, group, entries);
    return entries;
}

function collectEntries(db, group, entries) {
    if (!group) return;
    if (isRecycleBinGroup(db, group)) return;

    entries.push(...(group.entries || []));

    for (const child of group.groups || []) {
        collectEntries(db, child, entries);
    }
}

// Resolves a drag-and-drop group move into the arguments for `Kdbx.move`, or
// returns null when the move is invalid (self, descendant cycle, root, etc.).
// `position` is 'before' | 'after' | 'inside'. Pure: only reads the tree, never
// mutates — so the index math stays unit-testable.
export function resolveGroupMove(db, draggedUuid, targetUuid, position) {
    if (!db || !draggedUuid || !targetUuid || draggedUuid === targetUuid)
        return null;

    const dragged = findGroupByUuid(db, draggedUuid);
    const target = findGroupByUuid(db, targetUuid);
    if (!dragged || !target) return null;

    // The root group can't be moved.
    if (dragged === getDefaultGroup(db)) return null;

    const toGroup = position === 'inside' ? target : target.parentGroup;
    // before/after the root has no valid parent to land in.
    if (!toGroup) return null;

    // Block dropping a group into itself or any of its descendants.
    if (groupContainsGroupUuid(dragged, getObjectUuid(toGroup))) return null;

    if (position === 'inside') {
        return { group: dragged, toGroup, atIndex: undefined };
    }

    const siblings = toGroup.groups || [];
    let idx = siblings.indexOf(target);
    if (position === 'after') idx += 1;

    // `move` splices the dragged item out before inserting; when reordering
    // within the same parent that shifts later indices down by one.
    if (dragged.parentGroup === toGroup) {
        const fromIdx = siblings.indexOf(dragged);
        if (fromIdx >= 0 && fromIdx < idx) idx -= 1;
    }

    return { group: dragged, toGroup, atIndex: idx };
}

export function getRecycleBinGroup(db) {
    if (!db?.meta?.recycleBinUuid) return null;
    return (
        findGroupInTree(getDefaultGroup(db), db.meta.recycleBinUuid.id) || null
    );
}

export function isObjectInRecycleBin(db, object) {
    const bin = getRecycleBinGroup(db);
    if (!bin || !object) return false;

    const group = object.entries && object.groups ? object : object.parentGroup;
    return !!group && groupContainsGroupUuid(bin, getObjectUuid(group));
}

/**
 * Whether `Kdbx.remove` would move the object to the Recycle Bin instead of
 * deleting it for good. Mirrors kdbxweb's own condition exactly — it needs the
 * setting *and* a `recycleBinUuid` in the metadata — so the confirmation never
 * promises a restorable delete that the library then performs permanently.
 */
export function deleteMovesToRecycleBin(db, object) {
    if (!db?.meta?.recycleBinEnabled || !db.meta.recycleBinUuid) return false;
    return !isObjectInRecycleBin(db, object);
}

export function getRestoreTargetGroup(db, object) {
    const root = getDefaultGroup(db);
    if (!root || !object) return null;

    const previousUuid = getObjectUuid(object.previousParentGroup);
    const previous = findGroupByUuid(db, previousUuid);
    const bin = getRecycleBinGroup(db);

    if (
        !previous ||
        (bin && groupContainsGroupUuid(bin, getObjectUuid(previous))) ||
        (object.groups &&
            groupContainsGroupUuid(object, getObjectUuid(previous)))
    ) {
        return root;
    }
    return previous;
}

export function toGroupTreeNode(group, db, inRecycleBin = false) {
    const isRecycleBin = isRecycleBinGroup(db, group);
    const isInRecycleBin = inRecycleBin || isRecycleBin;
    const children = (group?.groups || []).map((child) =>
        toGroupTreeNode(child, db, isInRecycleBin),
    );
    const childEntryCount = children.reduce(
        (count, child) =>
            count +
            (!isInRecycleBin && child.isRecycleBin
                ? 0
                : child.recursiveEntryCount),
        0,
    );

    return {
        uuid: getObjectUuid(group),
        name: group?.name || '',
        entryCount: group?.entries?.length || 0,
        recursiveEntryCount: (group?.entries?.length || 0) + childEntryCount,
        isRecycleBin,
        isInRecycleBin,
        children,
    };
}

export function toEntryListItem(entry, db, iconDataUrls) {
    return {
        uuid: getObjectUuid(entry),
        title: getField(entry, 'Title') || 'No title',
        createdAt: entry?.times?.creationTime || new Date(0),
        modifiedAt: entry?.times?.lastModTime || new Date(0),
        iconSrc: getEntryIconSrc(entry, db, iconDataUrls),
    };
}

function getEntryIconSrc(entry, db, iconDataUrls) {
    if (!entry?.customIcon || !db?.meta?.customIcons) return null;

    const iconId = entry.customIcon.id || entry.customIcon;
    if (iconDataUrls?.has(iconId)) return iconDataUrls.get(iconId);

    const customIcon = db.meta.customIcons.get(iconId);
    if (!customIcon?.data) return null;

    const b64 = kdbxweb.ByteUtils.bytesToBase64(
        new Uint8Array(customIcon.data),
    );
    const dataUrl = `data:image/png;base64,${b64}`;
    iconDataUrls?.set(iconId, dataUrl);
    return dataUrl;
}

function entrySearchText(entry) {
    if (!entry?.fields) return '';

    const parts = [];
    for (const [key, value] of entry.fields) {
        // Passwords and protected custom fields must never be copied into the
        // plaintext index, even transiently.
        if (isProtectedValue(value) || typeof value !== 'string') continue;
        if (!STANDARD_FIELDS.includes(key)) parts.push(key);
        parts.push(value);
    }
    return parts.join('\n').toLocaleLowerCase();
}

/**
 * Build all immutable list/tree/search view data in one traversal. The caller
 * rebuilds this snapshot only when dbVersion changes, instead of recursively
 * walking the KDBX graph once for counts, again for the list, and once per
 * search keystroke.
 */
export function buildDatabaseView(db, iconDataUrls = new Map()) {
    const entries = [];
    const entriesByGroup = new Map();
    const entryItems = new Map();
    const searchIndex = [];

    function visit(group, inRecycleBin = false) {
        const isRecycleBin = isRecycleBinGroup(db, group);
        const isInRecycleBin = inRecycleBin || isRecycleBin;
        const ownEntries = group?.entries || [];
        entriesByGroup.set(getObjectUuid(group), ownEntries);

        for (const entry of ownEntries) {
            const uuid = getObjectUuid(entry);
            entryItems.set(uuid, toEntryListItem(entry, db, iconDataUrls));
            if (!isInRecycleBin) {
                entries.push(entry);
                searchIndex.push({ entry, text: entrySearchText(entry) });
            }
        }

        const children = (group?.groups || []).map((child) =>
            visit(child, isInRecycleBin),
        );
        const recursiveEntryCount =
            ownEntries.length +
            children.reduce(
                (count, child) =>
                    count +
                    (!isInRecycleBin && child.isRecycleBin
                        ? 0
                        : child.recursiveEntryCount),
                0,
            );

        return {
            uuid: getObjectUuid(group),
            name: group?.name || '',
            entryCount: ownEntries.length,
            recursiveEntryCount,
            isRecycleBin,
            isInRecycleBin,
            children,
        };
    }

    const root = getDefaultGroup(db);
    const groupTree = root ? [visit(root)] : [];
    return {
        entries,
        entriesByGroup,
        entryItems,
        searchIndex,
        groupTree,
    };
}
