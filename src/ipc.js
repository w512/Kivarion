import { invoke } from '@tauri-apps/api/core';

/**
 * Invoke a Tauri command with a bulk byte payload.
 *
 * A `Uint8Array` nested inside the usual JSON argument object is serialized by
 * Tauri with `Array.from()` — every byte becomes a decimal number in a JSON
 * string, costing roughly four bytes of text per payload byte and forcing serde
 * to parse it all back. A 60 MB vault becomes a ~250 MB string on every save.
 *
 * Passing the bytes as the *entire* payload makes Tauri send them as an
 * untransformed `application/octet-stream` body instead, so the scalar
 * arguments have to travel as headers. Header values must be ISO-8859-1, hence
 * the percent-encoding; `lib.rs` decodes them (paths are regularly non-ASCII).
 *
 * Argument names map to headers as `x-kivarion-<name>`; `null`/`undefined`
 * values are omitted so the backend sees them as absent.
 *
 * @param {string} command - Tauri command name
 * @param {Uint8Array} bytes - the payload, sent as the raw request body
 * @param {Record<string, unknown>} [args] - scalar arguments sent as headers
 */
export function invokeWithBytes(command, bytes, args = {}) {
    const headers = {};
    for (const [name, value] of Object.entries(args)) {
        if (value === null || value === undefined) continue;
        headers[`x-kivarion-${name}`] = encodeURIComponent(String(value));
    }

    return invoke(command, bytes, { headers });
}
