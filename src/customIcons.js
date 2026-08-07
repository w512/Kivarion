// Reading and mutating the file-wide custom-icon list (`Meta/CustomIcons`).
//
// Groups, entries *and* the history versions of an entry all point into that one
// list through their `CustomIconUUID`, which is what makes these shared: an icon
// is only garbage once nothing of the three refers to it. The icon-download path
// used to answer that question by walking entries alone — enough while entries
// were the only things that could carry an icon, and wrong the moment groups
// could: choosing an icon for one entry would delete the icon a group was using.

import * as kdbxweb from 'kdbxweb';

export function getIconId(icon) {
    return icon?.id || icon || null;
}

export function arrayBuffersEqual(a, b) {
    const left = new Uint8Array(a);
    const right = new Uint8Array(b);
    if (left.byteLength !== right.byteLength) return false;

    for (let i = 0; i < left.byteLength; i++) {
        if (left[i] !== right[i]) return false;
    }
    return true;
}

/** The id of the custom icon already holding these bytes, or `null`. */
export function findCustomIconByData(db, data) {
    for (const [id, icon] of db?.meta?.customIcons || []) {
        if (icon?.data && arrayBuffersEqual(icon.data, data)) return id;
    }
    return null;
}

/**
 * Store icon bytes and return the uuid to assign. Identical bytes already in the
 * file are reused instead of stored twice — an icon lives inside the `.kdbx`, so
 * every copy is re-encrypted on each save and duplicated into each `.bak`.
 *
 * @returns {kdbxweb.KdbxUuid}
 */
export function addCustomIcon(db, data, name = '') {
    const existingId = findCustomIconByData(db, data);
    if (existingId) return new kdbxweb.KdbxUuid(existingId);

    const uuid = kdbxweb.KdbxUuid.random();
    // `name`/`lastModified` are KDBX 4.1 fields; kdbxweb drops them when writing
    // an older file, so they are always set and never conditionally.
    db.meta.customIcons.set(uuid.id, {
        data,
        name: name || undefined,
        lastModified: new Date(),
    });
    return uuid;
}

/** Whether anything in the database still points at this custom icon. */
export function isCustomIconUsed(db, iconId) {
    if (!iconId) return false;
    return walkObjects(db).some(
        (object) => getIconId(object.customIcon) === iconId,
    );
}

/**
 * Drop a custom icon once nothing refers to it any more. The uuid is recorded as
 * a deleted object, as kdbxweb's own `cleanup` does: without that tombstone a
 * merge from another copy of a synced vault brings the icon back.
 */
export function removeUnusedCustomIcon(db, iconId) {
    if (!iconId || !db?.meta?.customIcons?.has(iconId)) return false;
    if (isCustomIconUsed(db, iconId)) return false;

    db.meta.customIcons.delete(iconId);
    db.addDeletedObject?.(new kdbxweb.KdbxUuid(iconId), new Date());
    return true;
}

// Every group and entry in the file, history versions included. Written out
// rather than taken from kdbxweb's `allGroupsAndEntries()` because it also has
// to walk the plain objects the tests build.
function walkObjects(db) {
    const out = [];
    visit(db?.getDefaultGroup?.(), out);
    return out;
}

function visit(group, out) {
    if (!group) return;
    out.push(group);

    for (const entry of group.entries || []) {
        out.push(entry, ...(entry.history || []));
    }
    for (const child of group.groups || []) {
        visit(child, out);
    }
}
