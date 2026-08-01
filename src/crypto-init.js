import * as kdbxweb from 'kdbxweb';
import { invokeWithBytes } from './ipc.js';

/**
 * Wire kdbxweb's KDBX 4 key derivation to the Rust backend.
 *
 * Must run before the app is mounted (see `src/main.js`): kdbxweb rejects with
 * `NotImplemented` if a database needs Argon2 and no implementation was
 * registered, so a database opened before this call would simply fail.
 *
 * This used to be `argon2-browser`, a WASM build running in the webview. It
 * computed synchronously on the renderer's main thread whatever the promise
 * around it suggested, and KDBX re-derives the key on *every* save (kdbxweb
 * generates a new master seed each time), so the UI froze for the whole KDF —
 * seconds on a large vault, on every auto-save. The `argon2_hash` command is
 * `async` and runs on the backend's blocking pool, so the interface stays live
 * while the key is derived.
 *
 * The bytes go over as the raw IPC body rather than as JSON arguments. Not for
 * the size — 64 bytes either way — but because Tauri would turn a `Uint8Array`
 * argument into a JSON *string* of decimal numbers, and a JS string holding key
 * material cannot be zeroed. `password` and `salt` are concatenated;
 * `password-length` tells the backend where to split them.
 */
export function initCryptoEngine() {
    kdbxweb.CryptoEngine.setArgon2Impl(
        async (
            password,
            salt,
            memory,
            iterations,
            length,
            parallelism,
            type,
            version,
        ) => {
            const key = new Uint8Array(password);
            const saltBytes = new Uint8Array(salt);
            const payload = new Uint8Array(key.length + saltBytes.length);
            payload.set(key);
            payload.set(saltBytes, key.length);

            try {
                // `memory` is already in KiB — kdbxweb divides the KDBX `M`
                // parameter by 1024 before calling. `type` is 0 (Argon2d) or 2
                // (Argon2id), `version` 0x10 or 0x13; both are validated
                // backend-side, and 0 must survive the trip (it is a real type,
                // not an absent argument).
                return await invokeWithBytes('argon2_hash', payload, {
                    'password-length': key.length,
                    memory,
                    iterations,
                    length,
                    parallelism,
                    type,
                    version,
                });
            } finally {
                // The request has been sent and its body already captured, so
                // the copy of the composite key can go. kdbxweb's own buffers
                // are its business; this one is ours.
                payload.fill(0);
            }
        },
    );
}
