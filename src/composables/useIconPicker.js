import { computed, ref, toValue } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import * as kdbxweb from 'kdbxweb';
import {
    addCustomIcon,
    getIconId,
    MAX_CUSTOM_ICON_BYTES,
    removeUnusedCustomIcon,
} from '../customIcons.js';
import {
    customIconDataUrl,
    findEntryByUuid,
    findGroupByUuid,
    getObjectUuid,
} from '../kdbxView.js';
import { DEFAULT_ENTRY_ICON, DEFAULT_GROUP_ICON } from '../standardIcons.js';
import {
    getField,
    normalizeHttpUrl,
    sniffImageMimeType,
    toExactArrayBuffer,
} from '../utils.js';
import { withSystemInteraction } from './useSystemInteraction.js';

/** Kept as a named re-export: this is where the picker's callers look for it. */
export const MAX_ICON_FILE_SIZE = MAX_CUSTOM_ICON_BYTES;

/**
 * The icon picker shared by groups and entries.
 *
 * A group and an entry differ in exactly three things — which lookup finds them,
 * which standard icon "default" means (`Folder` vs `Key`), and whether a favicon
 * can be downloaded for them — so they share one dialog rather than two that
 * would drift apart.
 *
 * @param {object} store - the Pinia store.
 * @param {object} deps
 * @param {import('vue').Ref|(() => object)} deps.databaseView - the view model.
 * @param {object} deps.actions - `useDatabaseActions`.
 * @param {Map} deps.iconDataUrls - the page's custom-icon data-URL cache.
 * @param {(entry: object) => Promise<boolean>} deps.downloadIcon - from
 *   `useEntryIcons`; the "Find Favicon" button.
 */
export function useIconPicker(
    store,
    { databaseView, actions, iconDataUrls, downloadIcon },
) {
    const view = () => toValue(databaseView);

    const showIconPicker = ref(false);
    const iconTargetKind = ref(null); // 'group' | 'entry'
    const iconTargetUuid = ref(null);
    const iconPickerError = ref('');
    const iconPickerBusy = ref(false);

    // Resolved on every read rather than held: an object can be deleted, or the
    // whole database replaced, while the dialog is open.
    const iconTarget = computed(() => {
        store.dbVersion;
        if (!iconTargetUuid.value) return null;
        return iconTargetKind.value === 'group'
            ? findGroupByUuid(view(), iconTargetUuid.value)
            : findEntryByUuid(view(), iconTargetUuid.value);
    });

    const iconTargetName = computed(() => {
        const object = iconTarget.value;
        if (!object) return '';
        return iconTargetKind.value === 'group'
            ? object.name || ''
            : getField(object, 'Title') || 'No title';
    });

    const defaultIconId = computed(() =>
        iconTargetKind.value === 'group'
            ? DEFAULT_GROUP_ICON
            : DEFAULT_ENTRY_ICON,
    );

    const pickerCustomIcons = computed(() => {
        store.dbVersion;
        const db = store.db;
        if (!db?.meta?.customIcons) return [];

        return [...db.meta.customIcons.entries()]
            .map(([id, icon]) => ({
                id,
                name: icon?.name || '',
                src: customIconDataUrl(db, id, iconDataUrls),
            }))
            .filter((icon) => !!icon.src);
    });

    const selectedIconId = computed(
        () => iconTarget.value?.icon ?? defaultIconId.value,
    );
    const selectedCustomIconId = computed(
        () => getIconId(iconTarget.value?.customIcon) || null,
    );

    // A group has no URL to derive a domain from, and sending one to a third
    // party is opt-out everywhere else in the app.
    const canDownloadFavicon = computed(() => {
        if (iconTargetKind.value !== 'entry' || !iconTarget.value) return false;
        if (store.downloadSiteIcons === false) return false;
        return !!normalizeHttpUrl(getField(iconTarget.value, 'URL'));
    });

    // `object` may be the live group/entry or just its uuid — the group tree
    // hands its rows' uuids up, the detail column has the entry itself.
    function openIconPicker(kind, object) {
        const uuid = getObjectUuid(object);
        if (!store.db || !uuid) return;

        iconTargetKind.value = kind;
        iconTargetUuid.value = uuid;
        if (!iconTarget.value) {
            closeIconPicker();
            return;
        }

        iconPickerError.value = '';
        iconPickerBusy.value = false;
        showIconPicker.value = true;
    }

    const openGroupIconPicker = (group) => openIconPicker('group', group);
    const openEntryIconPicker = (entry) => openIconPicker('entry', entry);

    function closeIconPicker() {
        showIconPicker.value = false;
        iconTargetKind.value = null;
        iconTargetUuid.value = null;
        iconPickerError.value = '';
    }

    /**
     * Apply a change to the object the dialog was opened for, and drop the
     * custom icon it was using if that was its last reference. The mutation runs
     * against the object passed in, not `iconTarget` re-read afterwards: an
     * async caller has already checked that this is still the right one.
     */
    function applyIconChange(object, mutate) {
        if (!store.db || !object) return;

        const previousCustomIcon = getIconId(object.customIcon);
        mutate(object);
        if (previousCustomIcon !== getIconId(object.customIcon)) {
            removeUnusedCustomIcon(store.db, previousCustomIcon);
        }

        object.times?.update?.();
        store.touchDb();
        actions.saveDatabaseChanges({ debounce: true });
        closeIconPicker();
    }

    function chooseStandardIcon(id) {
        applyIconChange(iconTarget.value, (object) => {
            object.icon = id;
            // A custom icon wins over the id wherever an icon is drawn, so
            // choosing a built-in one has to clear it.
            object.customIcon = undefined;
        });
    }

    function chooseCustomIcon(iconId) {
        if (!store.db?.meta?.customIcons?.has(iconId)) return;
        applyIconChange(iconTarget.value, (object) => {
            object.customIcon = new kdbxweb.KdbxUuid(iconId);
        });
    }

    function useDefaultIcon() {
        const fallback = defaultIconId.value;
        applyIconChange(iconTarget.value, (object) => {
            object.icon = fallback;
            object.customIcon = undefined;
        });
    }

    async function pickIconFile() {
        const db = store.db;
        const object = iconTarget.value;
        if (!db || !object) return;

        iconPickerError.value = '';
        iconPickerBusy.value = true;
        try {
            // Only the picker takes the screen away from the app; the read runs
            // with the window focused again.
            const picked = await withSystemInteraction(() =>
                invoke('pick_attachment_file'),
            );
            if (!picked) return;
            // Every await is a window in which auto-lock can drop the database
            // or the user can move on to another object.
            if (!isStillCurrent(db, object)) return;

            if (picked.size > MAX_ICON_FILE_SIZE) {
                iconPickerError.value = tooLargeMessage(picked.size);
                return;
            }

            const bytes = await invoke('read_database', { path: picked.path });
            if (!isStillCurrent(db, object)) return;

            const data = toExactArrayBuffer(bytes);
            if (data.byteLength > MAX_ICON_FILE_SIZE) {
                iconPickerError.value = tooLargeMessage(data.byteLength);
                return;
            }
            // Strict: unrecognized bytes are not an icon. Labelling them as PNG
            // the way the renderer does would store a file that shows as broken.
            if (!sniffImageMimeType(new Uint8Array(data))) {
                iconPickerError.value =
                    'That file is not a supported image (PNG, JPEG, GIF, WebP, BMP, ICO or SVG).';
                return;
            }

            const uuid = addCustomIcon(db, data, picked.fileName);
            applyIconChange(object, (target) => {
                target.customIcon = uuid;
            });
        } catch (e) {
            console.error('Failed to set the icon from a file', e);
            iconPickerError.value = e?.message || String(e);
        } finally {
            iconPickerBusy.value = false;
        }
    }

    async function downloadFavicon() {
        const db = store.db;
        const entry = iconTarget.value;
        if (!db || !entry || iconTargetKind.value !== 'entry') return;

        iconPickerError.value = '';
        iconPickerBusy.value = true;
        try {
            // `downloadIcon` stores the icon and reports the save itself; it
            // also cleans up the icon that was replaced.
            const updated = await downloadIcon(entry);
            if (!isStillCurrent(db, entry)) return;

            if (updated) closeIconPicker();
            else {
                iconPickerError.value =
                    'No icon could be downloaded for this entry.';
            }
        } catch (e) {
            console.error('Failed to download the icon', e);
            iconPickerError.value = e?.message || String(e);
        } finally {
            iconPickerBusy.value = false;
        }
    }

    function isStillCurrent(db, object) {
        return (
            store.db === db &&
            showIconPicker.value &&
            iconTarget.value === object
        );
    }

    return {
        showIconPicker,
        iconTargetName,
        pickerCustomIcons,
        selectedIconId,
        selectedCustomIconId,
        canDownloadFavicon,
        iconPickerError,
        iconPickerBusy,
        openGroupIconPicker,
        openEntryIconPicker,
        chooseStandardIcon,
        chooseCustomIcon,
        useDefaultIcon,
        pickIconFile,
        downloadFavicon,
        // Cancel, and what a forced lock calls to take the dialog down.
        closeIconPicker,
    };
}

function tooLargeMessage(size) {
    const kb = Math.round(size / 1024);
    return `That image is ${kb} KB. An icon is stored inside the database, so pick one under ${MAX_ICON_FILE_SIZE / 1024} KB.`;
}
