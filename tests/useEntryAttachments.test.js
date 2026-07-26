import { describe, expect, mock, test } from 'bun:test';
import {
    addEntryAttachment,
    deleteEntryAttachment,
    getAttachmentBytes,
    getUniqueAttachmentName,
    renameEntryAttachment,
    validateAttachmentName,
} from '../src/composables/useEntryAttachments.js';

function makeEntry() {
    const snapshots = [];
    const update = mock(() => {});
    const entry = {
        binaries: new Map([
            ['report.pdf', { hash: 'one', value: new Uint8Array([1]) }],
            ['photo.png', { hash: 'two', value: new Uint8Array([2]) }],
        ]),
        pushHistory: mock(() => snapshots.push([...entry.binaries.keys()])),
        times: { update },
    };
    return { entry, snapshots, update };
}

describe('entry attachment helpers', () => {
    test('reads runtime KDBX binary representations', () => {
        const buffer = new Uint8Array([1, 2, 3]).buffer;

        expect([...getAttachmentBytes(buffer)]).toEqual([1, 2, 3]);
        expect([
            ...getAttachmentBytes({ hash: 'hash', value: buffer }),
        ]).toEqual([1, 2, 3]);
        expect([
            ...getAttachmentBytes({
                value: new Uint8Array([9, 9, 9]),
                getBinary: () => buffer,
            }),
        ]).toEqual([1, 2, 3]);
    });

    test('validates names and generates a non-destructive duplicate name', () => {
        expect(validateAttachmentName('')).toBe(
            'Attachment name cannot be empty.',
        );
        expect(validateAttachmentName('../secret')).toContain('slashes');
        expect(validateAttachmentName('REPORT.PDF', ['report.pdf'])).toContain(
            'already exists',
        );
        expect(
            getUniqueAttachmentName('report.pdf', [
                'report.pdf',
                'report (2).pdf',
            ]),
        ).toBe('report (3).pdf');
    });

    test('adds an attachment under a unique name with history', () => {
        const { entry, snapshots, update } = makeEntry();
        const binary = { hash: 'three', value: new Uint8Array([3]) };

        const result = addEntryAttachment(entry, 'report.pdf', binary);

        expect(result).toEqual({ ok: true, name: 'report (2).pdf' });
        expect(entry.binaries.get('report (2).pdf')).toBe(binary);
        expect(snapshots).toEqual([['report.pdf', 'photo.png']]);
        expect(update).toHaveBeenCalledTimes(1);
    });

    test('renames an attachment with history and timestamp updates', () => {
        const { entry, snapshots, update } = makeEntry();
        const binary = entry.binaries.get('report.pdf');

        const result = renameEntryAttachment(
            entry,
            'report.pdf',
            'summary.pdf',
        );

        expect(result).toEqual({
            ok: true,
            changed: true,
            name: 'summary.pdf',
        });
        expect(entry.binaries.has('report.pdf')).toBe(false);
        expect(entry.binaries.get('summary.pdf')).toBe(binary);
        expect(snapshots).toEqual([['report.pdf', 'photo.png']]);
        expect(update).toHaveBeenCalledTimes(1);
    });

    test('refuses a rename collision without mutating history', () => {
        const { entry } = makeEntry();

        const result = renameEntryAttachment(entry, 'report.pdf', 'photo.png');

        expect(result.ok).toBe(false);
        expect(result.error).toContain('already exists');
        expect(entry.pushHistory).not.toHaveBeenCalled();
    });

    test('deletes an attachment with a restorable history snapshot', () => {
        const { entry, snapshots, update } = makeEntry();

        expect(deleteEntryAttachment(entry, 'photo.png')).toBe(true);
        expect(entry.binaries.has('photo.png')).toBe(false);
        expect(snapshots).toEqual([['report.pdf', 'photo.png']]);
        expect(update).toHaveBeenCalledTimes(1);
    });
});
