import { beforeEach, describe, expect, mock, test } from 'bun:test';
import * as kdbxweb from 'kdbxweb';

// The backend command itself is exercised from the Rust side (crypto.rs drives
// raw IPC requests through the invoke handler). What only this side can check
// is what `initCryptoEngine` hands it: the argument names, the units, and that
// the two byte inputs are concatenated the way the backend splits them.
//
// kdbxweb itself is deliberately *not* mocked — `mock.module` is process-wide
// in Bun, and the rest of the suite runs against the real library. Going
// through `CryptoEngine.argon2` also exercises the registration itself: an
// implementation kdbxweb never received would fail here rather than pass.
let invokeCalls;
let invokeResult;
let invokeError;

mock.module('@tauri-apps/api/core', () => ({
    invoke: (cmd, args, options) => {
        invokeCalls.push({
            cmd,
            // A snapshot of what was sent, plus the caller's live buffer — the
            // implementation wipes the latter once the request is done.
            sent: new Uint8Array(args),
            buffer: args,
            options,
        });
        return invokeError
            ? Promise.reject(invokeError)
            : Promise.resolve(invokeResult);
    },
}));

const { initCryptoEngine } = await import('../src/crypto-init.js');

const KEY = new Uint8Array(32).fill(0xab);
const SALT = new Uint8Array(32).fill(0xcd);

function header(name) {
    return invokeCalls[0].options.headers[`x-kivarion-${name}`];
}

// kdbxweb's Argon2 contract: (password, salt, memory /* KiB */, iterations,
// length, parallelism, type, version) -> Promise<ArrayBuffer>.
function derive({ type = 0, version = 0x13 } = {}) {
    return kdbxweb.CryptoEngine.argon2(
        KEY.buffer,
        SALT.buffer,
        16384,
        12,
        32,
        2,
        type,
        version,
    );
}

beforeEach(() => {
    invokeCalls = [];
    invokeResult = new Uint8Array(32).fill(0x11).buffer;
    invokeError = null;
    initCryptoEngine();
});

describe('initCryptoEngine', () => {
    test('sends the composite key and salt as one raw body the backend can split', async () => {
        await derive();

        expect(invokeCalls).toHaveLength(1);
        expect(invokeCalls[0].cmd).toBe('argon2_hash');
        // Tauri only skips its `Array.from()` JSON expansion — which would turn
        // key material into an unzeroable JS string — when the payload *is* the
        // buffer rather than a field inside an argument object.
        expect(invokeCalls[0].sent).toEqual(new Uint8Array([...KEY, ...SALT]));
        expect(header('password-length')).toBe('32');
    });

    test('passes every KDF parameter through, in the units kdbxweb uses', async () => {
        await derive();

        // `memory` is already KiB here: kdbxweb divides the KDBX `M` parameter
        // by 1024 before calling. Sending bytes instead would be wrong by a
        // factor of 1024 and no database would open.
        expect(header('memory')).toBe('16384');
        expect(header('iterations')).toBe('12');
        expect(header('length')).toBe('32');
        expect(header('parallelism')).toBe('2');
        expect(header('version')).toBe('19');
    });

    test('keeps Argon2d, whose type is 0, from being dropped as an absent argument', async () => {
        await derive({ type: kdbxweb.CryptoEngine.Argon2TypeArgon2d });

        // `invokeWithBytes` omits null/undefined; 0 is a real type (Argon2d)
        // and the committed test fixture uses it.
        expect(header('type')).toBe('0');
    });

    test('passes Argon2id through as type 2', async () => {
        await derive({ type: kdbxweb.CryptoEngine.Argon2TypeArgon2id });

        expect(header('type')).toBe('2');
    });

    test('returns the derived key to kdbxweb unchanged', async () => {
        const derived = await derive();

        expect(new Uint8Array(derived)).toEqual(new Uint8Array(32).fill(0x11));
    });

    test('wipes its copy of the key material once the request is done', async () => {
        await derive();

        // The request body was already captured by then (checked above), so the
        // buffer this side still holds must no longer be key material.
        expect(invokeCalls[0].buffer).toEqual(new Uint8Array(64));
    });

    test('wipes its copy even when the derivation fails', async () => {
        invokeError = new Error('Argon2 key derivation failed');

        await expect(derive()).rejects.toThrow('Argon2 key derivation failed');
        expect(invokeCalls[0].buffer).toEqual(new Uint8Array(64));
    });
});
