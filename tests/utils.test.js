import { describe, test, expect } from 'bun:test';
import {
    formatDate,
    formatSize,
    getField,
    isImage,
    getMimeType,
    isViewableInBrowser,
    generatePassword,
} from '../src/utils.js';

// `generatePassword` reads `window.crypto`. Bun exposes Web Crypto on globalThis
// but not a `window`, so provide a minimal shim.
globalThis.window = globalThis.window || { crypto: globalThis.crypto };

// Build a fake kdbxweb entry: `fields` is a Map; protected values expose getText().
function makeEntry(fields) {
    return { fields: new Map(Object.entries(fields)) };
}
function protectedValue(text) {
    return { getText: () => text };
}

describe('formatSize', () => {
    test('zero bytes', () => {
        expect(formatSize(0)).toBe('0 B');
    });
    test('kilobytes', () => {
        expect(formatSize(1024)).toBe('1 KB');
        expect(formatSize(1536)).toBe('1.5 KB');
    });
    test('megabytes', () => {
        expect(formatSize(1048576)).toBe('1 MB');
    });
});

describe('formatDate', () => {
    test('returns dash for empty input', () => {
        expect(formatDate(null)).toBe('—');
        expect(formatDate(undefined)).toBe('—');
    });
    test('returns a non-empty string for a date', () => {
        const out = formatDate(new Date('2024-01-15T10:30:00Z'));
        expect(typeof out).toBe('string');
        expect(out.length).toBeGreaterThan(0);
    });
});

describe('getField', () => {
    test('reads a plain string field', () => {
        const e = makeEntry({ Title: 'Hello' });
        expect(getField(e, 'Title')).toBe('Hello');
    });
    test('reads a protected field via getText()', () => {
        const e = makeEntry({ Password: protectedValue('s3cret') });
        expect(getField(e, 'Password')).toBe('s3cret');
    });
    test('returns empty string for a missing field', () => {
        const e = makeEntry({ Title: 'Hello' });
        expect(getField(e, 'UserName')).toBe('');
    });
    test('returns empty string for a null entry', () => {
        expect(getField(null, 'Title')).toBe('');
        expect(getField(undefined, 'Title')).toBe('');
    });
});

describe('isImage', () => {
    test('recognizes image extensions, case-insensitive', () => {
        expect(isImage('photo.png')).toBe(true);
        expect(isImage('PIC.JPEG')).toBe(true);
        expect(isImage('icon.svg')).toBe(true);
    });
    test('rejects non-images and extensionless names', () => {
        expect(isImage('doc.pdf')).toBe(false);
        expect(isImage('archive.zip')).toBe(false);
        expect(isImage('README')).toBe(false);
    });
});

describe('getMimeType', () => {
    test('maps known extensions', () => {
        expect(getMimeType('a.pdf')).toBe('application/pdf');
        expect(getMimeType('a.png')).toBe('image/png');
        expect(getMimeType('a.json')).toBe('application/json');
    });
    test('is case-insensitive', () => {
        expect(getMimeType('SCRIPT.JS')).toBe('text/javascript');
    });
    test('falls back to octet-stream for unknown types', () => {
        expect(getMimeType('a.xyz')).toBe('application/octet-stream');
        expect(getMimeType('noext')).toBe('application/octet-stream');
    });
});

describe('isViewableInBrowser', () => {
    test('true for viewable docs, media and images', () => {
        expect(isViewableInBrowser('a.pdf')).toBe(true);
        expect(isViewableInBrowser('a.mp4')).toBe(true);
        expect(isViewableInBrowser('a.png')).toBe(true);
    });
    test('false for unknown / binary types', () => {
        expect(isViewableInBrowser('a.exe')).toBe(false);
        expect(isViewableInBrowser('a.zip')).toBe(false);
    });
});

describe('generatePassword', () => {
    test('uses the default length of 20', () => {
        expect(generatePassword().length).toBe(20);
    });
    test('honors a custom length', () => {
        expect(generatePassword({ length: 8 }).length).toBe(8);
    });
    test('returns empty string when no character set is selected', () => {
        const pw = generatePassword({ upper: false, lower: false, numbers: false, symbols: false });
        expect(pw).toBe('');
    });
    test('lowercase-only with excludeSimilar omits the ambiguous "l"', () => {
        const pw = generatePassword({ length: 300, upper: false, lower: true, numbers: false, symbols: false, excludeSimilar: true });
        expect(pw).toMatch(/^[a-z]+$/);
        expect(pw).not.toContain('l');
    });
    test('uppercase-only with excludeSimilar omits I and O', () => {
        const pw = generatePassword({ length: 300, upper: true, lower: false, numbers: false, symbols: false, excludeSimilar: true });
        expect(pw).toMatch(/^[A-Z]+$/);
        expect(pw).not.toMatch(/[IO]/);
    });
    test('numbers-only with excludeSimilar omits 0 and 1', () => {
        const pw = generatePassword({ length: 300, upper: false, lower: false, numbers: true, symbols: false, excludeSimilar: true });
        expect(pw).toMatch(/^[2-9]+$/);
    });
});
