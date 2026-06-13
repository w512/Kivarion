import * as kdbxweb from 'kdbxweb';
import { getField } from './utils.js';

export const ALL_ENTRIES_UUID = 'all';

export function getObjectUuid(obj) {
    return typeof obj?.uuid === 'string' ? obj.uuid : obj?.uuid?.id || null;
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

export function groupContainsGroupUuid(group, uuid) {
    if (!group || !uuid) return false;
    if (getObjectUuid(group) === uuid) return true;
    return (group.groups || []).some(child => groupContainsGroupUuid(child, uuid));
}

export function groupContainsEntryUuid(group, uuid) {
    if (!group || !uuid) return false;
    if ((group.entries || []).some(entry => getObjectUuid(entry) === uuid)) return true;
    return (group.groups || []).some(child => groupContainsEntryUuid(child, uuid));
}

export function normalizeGroupName(name) {
    return (name || '').trim();
}

export function groupNameExistsInParent(group, name, excludeUuid = getObjectUuid(group)) {
    const parent = group?.parentGroup;
    const normalized = normalizeGroupName(name).toLocaleLowerCase();
    if (!parent || !normalized) return false;

    return (parent.groups || []).some(sibling => {
        return getObjectUuid(sibling) !== excludeUuid &&
            normalizeGroupName(sibling.name).toLocaleLowerCase() === normalized;
    });
}

export function getUniqueGroupName(parentGroup, baseName = 'New group') {
    const base = normalizeGroupName(baseName) || 'New group';
    const names = new Set((parentGroup?.groups || []).map(group => normalizeGroupName(group.name).toLocaleLowerCase()));
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

export function toGroupTreeNode(group) {
    return {
        uuid: getObjectUuid(group),
        name: group?.name || '',
        entryCount: group?.entries?.length || 0,
        children: (group?.groups || []).map(toGroupTreeNode),
    };
}

export function toEntryListItem(entry, db) {
    return {
        uuid: getObjectUuid(entry),
        title: getField(entry, 'Title') || 'No title',
        createdAt: entry?.times?.creationTime || new Date(0),
        modifiedAt: entry?.times?.lastModTime || new Date(0),
        iconSrc: getEntryIconSrc(entry, db),
    };
}

function getEntryIconSrc(entry, db) {
    if (!entry?.customIcon || !db?.meta?.customIcons) return null;

    const iconId = entry.customIcon.id || entry.customIcon;
    const customIcon = db.meta.customIcons.get(iconId);
    if (!customIcon?.data) return null;

    const b64 = kdbxweb.ByteUtils.bytesToBase64(new Uint8Array(customIcon.data));
    return `data:image/png;base64,${b64}`;
}
