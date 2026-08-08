import { describe, expect, test } from 'bun:test';
import {
    buildEntryHistoryChanges,
    MAX_ENTRY_HISTORY_ITEMS,
    pushEntryHistory,
} from '../src/entryHistory.js';

function protectedValue(text) {
    return { getText: () => text };
}

describe('entry history', () => {
    test('keeps only the ten newest versions after a mutation', () => {
        const entry = {
            history: Array.from({ length: 12 }, (_, index) => index),
            pushHistory() {
                this.history.push(12);
            },
            removeHistory(index, count) {
                this.history.splice(index, count);
            },
        };

        pushEntryHistory(entry);

        expect(entry.history).toHaveLength(MAX_ENTRY_HISTORY_ITEMS);
        expect(entry.history).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    });

    test('previews changed fields and attachments without exposing secrets', () => {
        const historical = {
            fields: new Map([
                ['UserName', 'old-user'],
                ['Password', protectedValue('old-secret')],
            ]),
            binaries: new Map([['old.txt', {}]]),
        };
        const current = {
            fields: new Map([
                ['UserName', 'new-user'],
                ['Password', protectedValue('new-secret')],
            ]),
            binaries: new Map([['new.txt', {}]]),
        };

        const changes = buildEntryHistoryChanges(historical, current);

        expect(changes).toContainEqual({
            key: 'field:UserName',
            label: 'Username',
            historicalValue: 'old-user',
            currentValue: 'new-user',
            protected: false,
        });
        expect(changes).toContainEqual({
            key: 'field:Password',
            label: 'Password',
            historicalValue: '••••••••',
            currentValue: '••••••••',
            protected: true,
        });
        expect(changes.map((change) => change.key)).toContain(
            'attachment:old.txt',
        );
        expect(changes.map((change) => change.key)).toContain(
            'attachment:new.txt',
        );
        expect(JSON.stringify(changes)).not.toContain('secret');
    });
});
