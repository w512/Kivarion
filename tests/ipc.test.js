import { beforeEach, describe, expect, mock, test } from 'bun:test';

let invokeCalls;

mock.module('@tauri-apps/api/core', () => ({
    invoke: (cmd, args, options) => {
        invokeCalls.push({ cmd, args, options });
        return Promise.resolve('ok');
    },
}));

const { invokeWithBytes } = await import('../src/ipc.js');

beforeEach(() => {
    invokeCalls = [];
});

describe('invokeWithBytes', () => {
    test('passes the bytes as the whole payload so Tauri sends a raw body', async () => {
        const bytes = new Uint8Array([0, 1, 254, 255]);

        await invokeWithBytes('save_database', bytes, { path: '/tmp/a.kdbx' });

        // Tauri only skips its `Array.from()` JSON expansion when the payload
        // *is* the buffer — wrapping it in an object silently undoes the fix.
        expect(invokeCalls[0].args).toBe(bytes);
        expect(ArrayBuffer.isView(invokeCalls[0].args)).toBe(true);
    });

    test('percent-encodes header values so non-ASCII paths survive', async () => {
        await invokeWithBytes('save_database', new Uint8Array(), {
            path: '/Users/nick/Синхронизация/vault.kdbx',
        });

        const value = invokeCalls[0].options.headers['x-kivarion-path'];
        // A raw non-ISO-8859-1 value would make the `Headers` constructor throw.
        expect(value).toBe(
            '%2FUsers%2Fnick%2F%D0%A1%D0%B8%D0%BD%D1%85%D1%80%D0%BE%D0%BD%D0%B8%D0%B7%D0%B0%D1%86%D0%B8%D1%8F%2Fvault.kdbx',
        );
        expect(decodeURIComponent(value)).toBe(
            '/Users/nick/Синхронизация/vault.kdbx',
        );
    });

    test('stringifies scalars and omits null/undefined arguments', async () => {
        await invokeWithBytes('save_database', new Uint8Array(), {
            path: '/tmp/a.kdbx',
            'expected-mtime': 1712345678901,
            backup: false,
            'backup-depth': 3,
            missing: null,
            absent: undefined,
        });

        // An omitted `expected-mtime` is what tells the backend to skip the
        // optimistic-concurrency check, so a null must not become "null".
        expect(invokeCalls[0].options.headers).toEqual({
            'x-kivarion-path': '%2Ftmp%2Fa.kdbx',
            'x-kivarion-expected-mtime': '1712345678901',
            'x-kivarion-backup': 'false',
            'x-kivarion-backup-depth': '3',
        });
    });
});
