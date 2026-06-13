import * as kdbxweb from 'kdbxweb';
import argon2 from 'argon2-browser/dist/argon2-bundled.min.js';

/**
 * Initialize kdbxweb CryptoEngine with Argon2 implementation.
 * Must be called before any KDBX 4 database operations.
 *
 * Uses the bundled argon2-browser build which includes the WASM
 * binary inline (as base64), avoiding any wasm loading issues with Vite.
 */
export function initCryptoEngine() {
    kdbxweb.CryptoEngine.setArgon2Impl(
        (
            password,
            salt,
            memory,
            iterations,
            length,
            parallelism,
            type,
            version,
        ) => {
            return argon2
                .hash({
                    pass: new Uint8Array(password),
                    salt: new Uint8Array(salt),
                    time: iterations,
                    mem: memory,
                    hashLen: length,
                    parallelism,
                    type,
                    version,
                })
                .then((result) => result.hash.buffer);
        },
    );
}
