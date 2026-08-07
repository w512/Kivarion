// The 69 standard KDBX icons (`IconID`, 0–68), drawn with Lucide.
//
// KDBX stores only the *number* here — every KeePass client draws that number
// with its own artwork, which is why a shared icon looks different in each app
// and why choosing one costs the vault nothing (unlike a custom icon, whose
// bytes are embedded in the file and re-encrypted on every save). The ids and
// their meanings come from KeePass's `PwIcon` enum; the Lucide glyph beside each
// one is the closest match, sometimes loosely (Lucide has no brand icons, so
// Tux is a bird and Wiki a bookmarked book).
//
// The ids are written out here rather than taken from kdbxweb's `Icons`: that
// enum has `DriveWindows: 39`, which collides with `Clock: 39` — the real value
// is 38, and reading a group's icon through it would silently shift the tail of
// the list.

import {
    Apple,
    Archive,
    Award,
    Banknote,
    BatteryWarning,
    Bird,
    BookMarked,
    BookOpen,
    Bookmark,
    CalendarX,
    Camera,
    CircleCheck,
    ClipboardCheck,
    Clock,
    Database,
    Disc,
    Feather,
    FileBadge,
    FileLock,
    FilePlus,
    FileQuestionMark,
    FileText,
    Folder,
    FolderArchive,
    FolderCheck,
    FolderOpen,
    Globe,
    HardDrive,
    House,
    IdCard,
    Image,
    Inbox,
    Info,
    Key,
    KeyRound,
    Landmark,
    LayoutGrid,
    List,
    LockOpen,
    Mail,
    MailSearch,
    MemoryStick,
    MessagesSquare,
    Monitor,
    Network,
    NotebookPen,
    Package,
    Pencil,
    Play,
    Plug,
    Printer,
    Puzzle,
    Radio,
    Save,
    Scan,
    Server,
    Settings,
    Settings2,
    Smartphone,
    SquareTerminal,
    Star,
    StickyNote,
    Terminal,
    Trash2,
    TriangleAlert,
    Tv,
    UserLock,
    Wrench,
    Zap,
} from 'lucide-vue-next';

/** `PwIcon.Key` — what KeePass gives a new entry. */
export const DEFAULT_ENTRY_ICON = 0;
/** `PwIcon.Folder` — what KeePass gives a new group. */
export const DEFAULT_GROUP_ICON = 48;
/** `PwIcon.FolderOpen`, shown for an expanded folder-icon group. */
export const OPEN_FOLDER_ICON = 49;

export const STANDARD_ICONS = [
    { id: 0, name: 'Key', component: Key },
    { id: 1, name: 'World', component: Globe },
    { id: 2, name: 'Warning', component: TriangleAlert },
    { id: 3, name: 'Network Server', component: Server },
    { id: 4, name: 'Marked Directory', component: FolderCheck },
    { id: 5, name: 'User Communication', component: MessagesSquare },
    { id: 6, name: 'Parts', component: Puzzle },
    { id: 7, name: 'Notepad', component: NotebookPen },
    { id: 8, name: 'World Socket', component: Plug },
    { id: 9, name: 'Identity', component: IdCard },
    { id: 10, name: 'Paper Ready', component: FileText },
    { id: 11, name: 'Digicam', component: Camera },
    { id: 12, name: 'IR Communication', component: Radio },
    { id: 13, name: 'Multi Keys', component: KeyRound },
    { id: 14, name: 'Energy', component: Zap },
    { id: 15, name: 'Scanner', component: Scan },
    { id: 16, name: 'World Star', component: Bookmark },
    { id: 17, name: 'CD-ROM', component: Disc },
    { id: 18, name: 'Monitor', component: Monitor },
    { id: 19, name: 'E-Mail', component: Mail },
    { id: 20, name: 'Configuration', component: Settings2 },
    { id: 21, name: 'Clipboard Ready', component: ClipboardCheck },
    { id: 22, name: 'Paper New', component: FilePlus },
    { id: 23, name: 'Screen', component: Tv },
    { id: 24, name: 'Energy Careful', component: BatteryWarning },
    { id: 25, name: 'E-Mail Box', component: Inbox },
    { id: 26, name: 'Disk', component: Save },
    { id: 27, name: 'Drive', component: HardDrive },
    { id: 28, name: 'Paper Q', component: FileQuestionMark },
    { id: 29, name: 'Terminal Encrypted', component: SquareTerminal },
    { id: 30, name: 'Console', component: Terminal },
    { id: 31, name: 'Printer', component: Printer },
    { id: 32, name: 'Program Icons', component: LayoutGrid },
    { id: 33, name: 'Run', component: Play },
    { id: 34, name: 'Settings', component: Settings },
    { id: 35, name: 'World Computer', component: Network },
    { id: 36, name: 'Archive', component: Archive },
    { id: 37, name: 'Homebanking', component: Landmark },
    { id: 38, name: 'Drive Windows', component: Database },
    { id: 39, name: 'Clock', component: Clock },
    { id: 40, name: 'E-Mail Search', component: MailSearch },
    { id: 41, name: 'Paper Flag', component: FileBadge },
    { id: 42, name: 'Memory', component: MemoryStick },
    { id: 43, name: 'Trash Bin', component: Trash2 },
    { id: 44, name: 'Note', component: StickyNote },
    { id: 45, name: 'Expired', component: CalendarX },
    { id: 46, name: 'Info', component: Info },
    { id: 47, name: 'Package', component: Package },
    { id: 48, name: 'Folder', component: Folder },
    { id: 49, name: 'Folder Open', component: FolderOpen },
    { id: 50, name: 'Folder Package', component: FolderArchive },
    { id: 51, name: 'Lock Open', component: LockOpen },
    { id: 52, name: 'Paper Locked', component: FileLock },
    { id: 53, name: 'Checked', component: CircleCheck },
    { id: 54, name: 'Pen', component: Pencil },
    { id: 55, name: 'Thumbnail', component: Image },
    { id: 56, name: 'Book', component: BookOpen },
    { id: 57, name: 'List', component: List },
    { id: 58, name: 'User Key', component: UserLock },
    { id: 59, name: 'Tool', component: Wrench },
    { id: 60, name: 'Home', component: House },
    { id: 61, name: 'Star', component: Star },
    { id: 62, name: 'Tux', component: Bird },
    { id: 63, name: 'Feather', component: Feather },
    { id: 64, name: 'Apple', component: Apple },
    { id: 65, name: 'Wiki', component: BookMarked },
    { id: 66, name: 'Money', component: Banknote },
    { id: 67, name: 'Certificate', component: Award },
    { id: 68, name: 'BlackBerry', component: Smartphone },
];

const ICONS_BY_ID = new Map(STANDARD_ICONS.map((icon) => [icon.id, icon]));

/** Whether `id` is one of the ids KDBX defines. */
export function isStandardIconId(id) {
    return ICONS_BY_ID.has(id);
}

/**
 * The Lucide component for a standard icon id. A file written by another program
 * may hold an id outside the standard range, so an unknown one falls back rather
 * than rendering nothing at all.
 */
export function standardIconComponent(id, fallbackId = DEFAULT_ENTRY_ICON) {
    return (
        ICONS_BY_ID.get(id) ??
        ICONS_BY_ID.get(fallbackId) ??
        STANDARD_ICONS[0]
    ).component;
}

export function standardIconName(id) {
    return ICONS_BY_ID.get(id)?.name || '';
}
