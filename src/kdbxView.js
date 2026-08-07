import * as kdbxweb from 'kdbxweb';
import { getIconId } from './customIcons.js';
import { DEFAULT_ENTRY_ICON, DEFAULT_GROUP_ICON } from './standardIcons.js';
import {
    detectImageMimeType,
    getField,
    isProtectedValue,
    STANDARD_FIELDS,
} from './utils.js';

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

/** A kdbxweb group rather than an entry: only groups hold both collections. */
function isGroupObject(object) {
    return !!object?.entries && !!object?.groups;
}

/**
 * The live group with this uuid, or `null`.
 *
 * Served from the index `buildDatabaseView` builds during its single walk. This
 * used to recurse through the whole vault on every call, and it is called from
 * computeds — so a database of any size was walked several times over on each
 * `dbVersion` change, on top of the walk the view itself had just done.
 */
export function findGroupByUuid(view, uuid) {
    if (!uuid || uuid === ALL_ENTRIES_UUID) return null;
    return view?.groupsByUuid.get(uuid) ?? null;
}

/** The live entry with this uuid, or `null`. Recycle Bin included. */
export function findEntryByUuid(view, uuid) {
    if (!uuid) return null;
    return view?.entriesByUuid.get(uuid) ?? null;
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

// Resolves a drag-and-drop group move into the arguments for `Kdbx.move`, or
// returns null when the move is invalid (self, descendant cycle, root, etc.).
// `position` is 'before' | 'after' | 'inside'. Pure: only reads the tree, never
// mutates — so the index math stays unit-testable.
export function resolveGroupMove(view, draggedUuid, targetUuid, position) {
    if (!view || !draggedUuid || !targetUuid || draggedUuid === targetUuid)
        return null;

    const dragged = findGroupByUuid(view, draggedUuid);
    const target = findGroupByUuid(view, targetUuid);
    if (!dragged || !target) return null;

    // The root group can't be moved.
    if (dragged === view.rootGroup) return null;

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

/**
 * Whether an object sits inside the Recycle Bin, the bin group itself included.
 *
 * `view.recycleBinUuids` holds every group uuid in that subtree, collected on
 * the same walk, so this is a set lookup rather than two nested searches.
 */
export function isObjectInRecycleBin(view, object) {
    if (!object || !view?.recycleBinUuids.size) return false;

    const group = isGroupObject(object) ? object : object.parentGroup;
    return !!group && view.recycleBinUuids.has(getObjectUuid(group));
}

/**
 * Whether `Kdbx.remove` would move the object to the Recycle Bin instead of
 * deleting it for good. `view.recycleBinEnabled` mirrors kdbxweb's own
 * condition exactly — it needs the setting *and* a `recycleBinUuid` in the
 * metadata — so the confirmation never promises a restorable delete that the
 * library then performs permanently.
 */
export function deleteMovesToRecycleBin(view, object) {
    if (!view?.recycleBinEnabled) return false;
    return !isObjectInRecycleBin(view, object);
}

export function getRestoreTargetGroup(view, object) {
    const root = view?.rootGroup;
    if (!root || !object) return null;

    const previous = findGroupByUuid(
        view,
        getObjectUuid(object.previousParentGroup),
    );

    // Nowhere to go back to, back into the bin, or into the group being
    // restored: the root is the only answer left.
    if (
        !previous ||
        view.recycleBinUuids.has(getObjectUuid(previous)) ||
        (object.groups &&
            groupContainsGroupUuid(object, getObjectUuid(previous)))
    ) {
        return root;
    }
    return previous;
}

function toEntryListItem(entry, db, iconDataUrls) {
    return {
        uuid: getObjectUuid(entry),
        title: getField(entry, 'Title') || 'No title',
        createdAt: entry?.times?.creationTime || new Date(0),
        modifiedAt: entry?.times?.lastModTime || new Date(0),
        iconSrc: getCustomIconSrc(entry, db, iconDataUrls),
        iconId: entry?.icon ?? DEFAULT_ENTRY_ICON,
    };
}

/**
 * The data URL of a custom icon by its uuid, or `null`. Cached by that uuid, so
 * the same icon used by a group, ten entries and the picker's own grid is
 * encoded once — building these is the expensive part of a list row.
 */
export function customIconDataUrl(db, iconId, iconDataUrls) {
    if (!iconId || !db?.meta?.customIcons) return null;
    if (iconDataUrls?.has(iconId)) return iconDataUrls.get(iconId);

    const customIcon = db.meta.customIcons.get(iconId);
    if (!customIcon?.data) return null;

    // The type is not recorded in the file, so it is sniffed from the bytes:
    // KDBX does not require a PNG, and an SVG icon labelled `image/png` renders
    // as nothing. Rendering it through `<img>` (never inline) is what keeps an
    // SVG inert — no scripts, no external references.
    const bytes = new Uint8Array(customIcon.data);
    const b64 = kdbxweb.ByteUtils.bytesToBase64(bytes);
    const dataUrl = `data:${detectImageMimeType(bytes)};base64,${b64}`;
    iconDataUrls?.set(iconId, dataUrl);
    return dataUrl;
}

/**
 * The data URL of an object's custom icon, or `null`. Groups and entries carry
 * the same `CustomIconUUID` field pointing into the file-wide `Meta/CustomIcons`
 * list, so both go through here.
 */
function getCustomIconSrc(object, db, iconDataUrls) {
    return customIconDataUrl(db, getIconId(object?.customIcon), iconDataUrls);
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
 * Build all immutable list/tree/search view data in one traversal, plus the
 * lookup index every other helper here reads. The caller rebuilds this snapshot
 * only when dbVersion changes, instead of recursively walking the KDBX graph
 * once for counts, again for the list, once per search keystroke, and once more
 * for every `findGroupByUuid` / `findEntryByUuid` / `isObjectInRecycleBin` a
 * computed happens to call.
 *
 * The maps hold the **live** kdbxweb objects, not copies — mutating what comes
 * out of them mutates the database, which is what the callers want. Only the
 * tree nodes and list rows are plain snapshots.
 */
export function buildDatabaseView(db, iconDataUrls = new Map()) {
    const entries = [];
    const entriesByGroup = new Map();
    const entryItems = new Map();
    const searchIndex = [];
    const groupsByUuid = new Map();
    const entriesByUuid = new Map();
    const recycleBinUuids = new Set();
    let recycleBinGroup = null;

    function visit(group, inRecycleBin = false) {
        const isRecycleBin = isRecycleBinGroup(db, group);
        const isInRecycleBin = inRecycleBin || isRecycleBin;
        const ownEntries = group?.entries || [];
        const groupUuid = getObjectUuid(group);

        entriesByGroup.set(groupUuid, ownEntries);
        if (group) groupsByUuid.set(groupUuid, group);
        if (isRecycleBin) recycleBinGroup = group;
        if (isInRecycleBin) recycleBinUuids.add(groupUuid);

        for (const entry of ownEntries) {
            const uuid = getObjectUuid(entry);
            entriesByUuid.set(uuid, entry);
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
            iconSrc: getCustomIconSrc(group, db, iconDataUrls),
            iconId: group?.icon ?? DEFAULT_GROUP_ICON,
            entryCount: ownEntries.length,
            recursiveEntryCount,
            isRecycleBin,
            isInRecycleBin,
            children,
        };
    }

    const rootGroup = getDefaultGroup(db);
    const groupTree = rootGroup ? [visit(rootGroup)] : [];
    return {
        rootGroup,
        entries,
        entriesByGroup,
        entryItems,
        searchIndex,
        groupTree,
        groupsByUuid,
        entriesByUuid,
        // The bin's own uuid is in here too, so "is this in the bin" is one
        // question rather than "is it the bin, or under it".
        recycleBinUuids,
        recycleBinGroup,
        // kdbxweb recycles only when both are set; kept as a flag so
        // `deleteMovesToRecycleBin` does not need the database itself.
        recycleBinEnabled: !!(
            db?.meta?.recycleBinEnabled && db?.meta?.recycleBinUuid
        ),
    };
}
