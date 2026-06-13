import { describe, test, expect } from 'bun:test';
import {
    formatDate,
    formatSize,
    getField,
    isImage,
    getMimeType,
    isViewableInBrowser,
    estimatePasswordEntropy,
    generatePassword,
    isProtectedValue,
    passwordStrengthLabel,
    isUnsafeAttachmentPreview,
    isStandardFieldName,
    normalizeHttpUrl,
    STANDARD_FIELDS,
    toExactArrayBuffer,
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

describe('field helpers', () => {
    test('exports the standard KeePass fields', () => {
        expect(STANDARD_FIELDS).toEqual(['Title', 'UserName', 'Password', 'URL', 'Notes']);
    });

    test('detects protected values', () => {
        expect(isProtectedValue(protectedValue('s3cret'))).toBe(true);
        expect(isProtectedValue('plain')).toBe(false);
        expect(isProtectedValue(null)).toBe(false);
    });

    test('detects standard field names case-insensitively after trim', () => {
        expect(isStandardFieldName(' Password ')).toBe(true);
        expect(isStandardFieldName('password')).toBe(true);
        expect(isStandardFieldName('ApiKey')).toBe(false);
    });
});

describe('normalizeHttpUrl', () => {
    test('adds https to hostnames without a protocol', () => {
        expect(normalizeHttpUrl('example.com/path')).toBe('https://example.com/path');
    });

    test('keeps http and https URLs', () => {
        expect(normalizeHttpUrl('http://example.com')).toBe('http://example.com/');
        expect(normalizeHttpUrl('https://example.com')).toBe('https://example.com/');
    });

    test('rejects unsupported or malformed URLs', () => {
        expect(normalizeHttpUrl('ftp://example.com')).toBe('');
        expect(normalizeHttpUrl('not a url')).toBe('');
        expect(normalizeHttpUrl('mailto:user@example.com')).toBe('');
    });
});

describe('toExactArrayBuffer', () => {
    test('returns only the visible bytes of a typed array with byteOffset', () => {
        const backing = new Uint8Array([9, 1, 2, 3, 9]);
        const view = backing.subarray(1, 4);
        const out = toExactArrayBuffer(view);

        expect(out.byteLength).toBe(3);
        expect([...new Uint8Array(out)]).toEqual([1, 2, 3]);
    });

    test('copies a full typed array', () => {
        const bytes = new Uint8Array([1, 2, 3]);
        const out = toExactArrayBuffer(bytes);

        expect(out).not.toBe(bytes.buffer);
        expect([...new Uint8Array(out)]).toEqual([1, 2, 3]);
    });

    test('copies an ArrayBuffer', () => {
        const buffer = new Uint8Array([4, 5, 6]).buffer;
        const out = toExactArrayBuffer(buffer);

        expect(out).not.toBe(buffer);
        expect([...new Uint8Array(out)]).toEqual([4, 5, 6]);
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
        expect(isImage('icon.webp')).toBe(true);
    });
    test('rejects non-images and extensionless names', () => {
        expect(isImage('doc.pdf')).toBe(false);
        expect(isImage('icon.svg')).toBe(false);
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
    test('false for active document/script formats', () => {
        expect(isViewableInBrowser('a.html')).toBe(false);
        expect(isViewableInBrowser('a.svg')).toBe(false);
        expect(isViewableInBrowser('a.js')).toBe(false);
        expect(isViewableInBrowser('a.css')).toBe(false);
    });
});

describe('isUnsafeAttachmentPreview', () => {
    test('recognizes active document/script formats', () => {
        expect(isUnsafeAttachmentPreview('a.html')).toBe(true);
        expect(isUnsafeAttachmentPreview('a.svg')).toBe(true);
        expect(isUnsafeAttachmentPreview('a.js')).toBe(true);
        expect(isUnsafeAttachmentPreview('a.css')).toBe(true);
        expect(isUnsafeAttachmentPreview('a.png')).toBe(false);
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
    test('returns empty string when length cannot cover all selected classes', () => {
        const pw = generatePassword({ length: 3, upper: true, lower: true, numbers: true, symbols: true });
        expect(pw).toBe('');
    });
    test('covers every selected character class', () => {
        for (let i = 0; i < 50; i++) {
            const pw = generatePassword({ length: 12, upper: true, lower: true, numbers: true, symbols: true, excludeSimilar: true });
            expect(pw).toMatch(/[A-HJ-NP-Z]/);
            expect(pw).toMatch(/[a-km-z]/);
            expect(pw).toMatch(/[2-9]/);
            expect(pw).toMatch(/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/);
        }
    });
    test('covers every selected character class when similar characters are allowed', () => {
        const pw = generatePassword({ length: 4, upper: true, lower: true, numbers: true, symbols: true, excludeSimilar: false });
        expect(pw).toMatch(/[A-Z]/);
        expect(pw).toMatch(/[a-z]/);
        expect(pw).toMatch(/[0-9]/);
        expect(pw).toMatch(/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/);
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
    test('estimates entropy from length and selected charset size', () => {
        const entropy = estimatePasswordEntropy({ length: 8, upper: false, lower: false, numbers: true, symbols: false, excludeSimilar: true });
        expect(entropy).toBeCloseTo(8 * Math.log2(8));
    });
    test('maps entropy to strength labels', () => {
        expect(passwordStrengthLabel(20)).toBe('Weak');
        expect(passwordStrengthLabel(45)).toBe('Fair');
        expect(passwordStrengthLabel(65)).toBe('Good');
        expect(passwordStrengthLabel(85)).toBe('Strong');
        expect(passwordStrengthLabel(105)).toBe('Excellent');
    });
});
