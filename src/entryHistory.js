import { isProtectedValue, STANDARD_FIELDS } from './utils';

export const MAX_ENTRY_HISTORY_ITEMS = 10;

const FIELD_LABELS = {
    Title: 'Title',
    UserName: 'Username',
    Password: 'Password',
    URL: 'URL',
    Notes: 'Notes',
};

/**
 * Save the current entry as a history version, then keep only the newest
 * versions. KDBX exposes history limits in its metadata, but kdbxweb's ordinary
 * save path does not apply them, so mutations must enforce Kivarion's limit.
 */
export function pushEntryHistory(entry, maxItems = MAX_ENTRY_HISTORY_ITEMS) {
    entry?.pushHistory?.();
    if (!entry?.history || entry.history.length <= maxItems) return;

    const excess = entry.history.length - maxItems;
    if (typeof entry.removeHistory === 'function') {
        entry.removeHistory(0, excess);
    } else {
        // Test doubles and older compatible entry implementations may not carry
        // removeHistory. Splicing still preserves the user-facing limit.
        entry.history.splice(0, excess);
    }
}

function readField(entry, key) {
    const stored = entry?.fields?.get(key);
    if (stored == null) return { text: '', protected: key === 'Password' };
    if (isProtectedValue(stored)) {
        return { text: stored.getText(), protected: true };
    }
    return { text: String(stored), protected: key === 'Password' };
}

function displayValue(field) {
    if (!field.text) return '—';
    return field.protected ? '••••••••' : field.text;
}

function orderedFieldKeys(historicalEntry, currentEntry) {
    const keys = new Set([
        ...(historicalEntry?.fields?.keys?.() || []),
        ...(currentEntry?.fields?.keys?.() || []),
    ]);
    const standard = STANDARD_FIELDS.filter((key) => keys.delete(key));
    return [...standard, ...[...keys].sort((a, b) => a.localeCompare(b))];
}

function binaryNames(entry) {
    return new Set(entry?.binaries?.keys?.() || []);
}

/**
 * Build a safe preview of what restoring a historical version would change.
 * Protected values are compared so a change is detected, but their plaintext
 * is never returned to the renderer.
 */
export function buildEntryHistoryChanges(historicalEntry, currentEntry) {
    const changes = [];

    for (const key of orderedFieldKeys(historicalEntry, currentEntry)) {
        const historical = readField(historicalEntry, key);
        const current = readField(currentEntry, key);
        if (historical.text === current.text) continue;

        changes.push({
            key: `field:${key}`,
            label: FIELD_LABELS[key] || key,
            historicalValue: displayValue(historical),
            currentValue: displayValue(current),
            protected: historical.protected || current.protected,
        });
    }

    const historicalBinaries = binaryNames(historicalEntry);
    const currentBinaries = binaryNames(currentEntry);
    const names = new Set([...historicalBinaries, ...currentBinaries]);
    for (const name of [...names].sort((a, b) => a.localeCompare(b))) {
        const wasPresent = historicalBinaries.has(name);
        const isPresent = currentBinaries.has(name);
        if (wasPresent === isPresent) continue;

        changes.push({
            key: `attachment:${name}`,
            label: `Attachment: ${name}`,
            historicalValue: wasPresent ? 'Present' : '—',
            currentValue: isPresent ? 'Present' : '—',
            protected: false,
        });
    }

    return changes;
}
