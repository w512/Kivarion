import { describe, expect, test } from 'bun:test';
import {
    DEFAULT_ENTRY_ICON,
    DEFAULT_GROUP_ICON,
    OPEN_FOLDER_ICON,
    STANDARD_ICONS,
    isStandardIconId,
    standardIconComponent,
    standardIconName,
} from '../src/standardIcons.js';

describe('standard KDBX icons', () => {
    test('covers ids 0–68 exactly once, in order', () => {
        expect(STANDARD_ICONS.map((icon) => icon.id)).toEqual([
            ...Array(69).keys(),
        ]);
    });

    test('gives every id a glyph and a name', () => {
        for (const icon of STANDARD_ICONS) {
            expect(icon.component).toBeTruthy();
            expect(icon.name.length).toBeGreaterThan(0);
        }
    });

    test('pins the ids the app itself depends on', () => {
        // KeePass's defaults. A wrong value here would give every new group or
        // entry the wrong icon in every other KeePass client.
        expect(DEFAULT_ENTRY_ICON).toBe(0);
        expect(standardIconName(DEFAULT_ENTRY_ICON)).toBe('Key');
        expect(DEFAULT_GROUP_ICON).toBe(48);
        expect(standardIconName(DEFAULT_GROUP_ICON)).toBe('Folder');
        expect(OPEN_FOLDER_ICON).toBe(49);
        expect(standardIconName(OPEN_FOLDER_ICON)).toBe('Folder Open');
        // kdbxweb's own `Icons` enum has DriveWindows colliding with Clock at
        // 39; these are the values KeePass actually writes.
        expect(standardIconName(38)).toBe('Drive Windows');
        expect(standardIconName(39)).toBe('Clock');
        expect(standardIconName(43)).toBe('Trash Bin');
    });

    test('falls back for an id no KDBX version defines', () => {
        expect(isStandardIconId(69)).toBe(false);
        expect(isStandardIconId(0)).toBe(true);

        // A file written by another program can hold anything here; rendering
        // nothing at all would leave a hole in the row.
        expect(standardIconComponent(999)).toBe(
            standardIconComponent(DEFAULT_ENTRY_ICON),
        );
        expect(standardIconComponent(null, DEFAULT_GROUP_ICON)).toBe(
            standardIconComponent(DEFAULT_GROUP_ICON),
        );
    });
});
