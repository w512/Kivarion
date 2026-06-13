import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import * as kdbxweb from 'kdbxweb';
import { getField, normalizeHttpUrl } from '../utils';
import { useStore } from '../store';

const ICON_ENDPOINT = 'https://icon.horse/icon/';
const MAX_ICON_BYTES = 100 * 1024;
const ICON_FETCH_TIMEOUT_MS = 8000;
const ICON_DEBOUNCE_MS = globalThis.__KIVARION_ICON_DEBOUNCE_MS__ ?? 300;
const ALLOWED_ICON_MIME = new Set(['image/png']);

const iconCache = new Map();
const inFlightFetches = new Map();
const pendingDownloads = new WeakMap();

export function useEntryIcons(emit) {
    const store = useStore();

    function downloadIcon(entry) {
        if (!entry) return Promise.resolve(false);

        const pending = pendingDownloads.get(entry);
        if (pending) {
            clearTimeout(pending.timer);
            pending.resolve(false);
        }

        return new Promise((resolve) => {
            const timer = setTimeout(async () => {
                pendingDownloads.delete(entry);
                try {
                    resolve(await applyIcon(entry, store, emit));
                } catch (e) {
                    console.error('Failed to fetch icon', e);
                    resolve(false);
                }
            }, ICON_DEBOUNCE_MS);

            pendingDownloads.set(entry, { timer, resolve });
        });
    }

    return {
        downloadIcon
    };
}

async function applyIcon(entry, store, emit) {
    const url = normalizeHttpUrl(getField(entry, 'URL'));
    if (!url || !store.db) return false;

    const domain = new URL(url).hostname.toLowerCase();
    const buffer = await fetchIconForDomain(domain);
    if (!buffer || !buffer.byteLength || !store.db) return false;

    const oldIconId = getIconId(entry.customIcon);
    const oldIcon = oldIconId ? store.db.meta.customIcons.get(oldIconId) : null;

    if (oldIcon?.data && arrayBuffersEqual(oldIcon.data, buffer)) {
        return false;
    }

    const existingIconId = findCustomIconByData(store.db, buffer);
    const nextIcon = existingIconId
        ? new kdbxweb.KdbxUuid(existingIconId)
        : kdbxweb.KdbxUuid.random();

    if (!existingIconId) {
        store.db.meta.customIcons.set(nextIcon.id, { data: buffer });
    }

    if (oldIconId === nextIcon.id) return false;

    entry.customIcon = nextIcon;
    entry.times.update();
    removeUnusedCustomIcon(store.db, oldIconId);
    emit('updated');
    return true;
}

async function fetchIconForDomain(domain) {
    if (iconCache.has(domain)) return iconCache.get(domain).slice(0);
    if (inFlightFetches.has(domain)) return (await inFlightFetches.get(domain)).slice(0);

    const promise = fetchIcon(domain)
        .then((buffer) => {
            iconCache.set(domain, buffer.slice(0));
            return buffer;
        })
        .finally(() => {
            inFlightFetches.delete(domain);
        });

    inFlightFetches.set(domain, promise);
    return (await promise).slice(0);
}

async function fetchIcon(domain) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ICON_FETCH_TIMEOUT_MS);

    try {
        const res = await tauriFetch(`${ICON_ENDPOINT}${encodeURIComponent(domain)}`, {
            signal: controller.signal,
            connectTimeout: ICON_FETCH_TIMEOUT_MS,
        });

        if (!res.ok) throw new Error(`Icon fetch failed with status ${res.status}`);

        const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (!ALLOWED_ICON_MIME.has(contentType)) {
            throw new Error(`Unexpected icon content-type: ${contentType || 'unknown'}`);
        }

        const contentLength = Number(res.headers.get('content-length') || 0);
        if (contentLength > MAX_ICON_BYTES) {
            throw new Error(`Icon is too large: ${contentLength} bytes`);
        }

        return await readLimitedBody(res, controller);
    } finally {
        clearTimeout(timeout);
    }
}

async function readLimitedBody(res, controller) {
    if (!res.body?.getReader) {
        const buffer = await res.arrayBuffer();
        if (buffer.byteLength > MAX_ICON_BYTES) {
            throw new Error(`Icon is too large: ${buffer.byteLength} bytes`);
        }
        return buffer;
    }

    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
            total += chunk.byteLength;
            if (total > MAX_ICON_BYTES) {
                controller.abort();
                throw new Error(`Icon is too large: ${total} bytes`);
            }
            chunks.push(chunk);
        }
    } finally {
        reader.releaseLock();
    }

    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return out.buffer;
}

function findCustomIconByData(db, data) {
    for (const [id, icon] of db.meta.customIcons) {
        if (icon?.data && arrayBuffersEqual(icon.data, data)) return id;
    }
    return null;
}

function removeUnusedCustomIcon(db, iconId) {
    if (!iconId || !db?.meta?.customIcons?.has(iconId)) return;

    const isUsed = collectAllEntries(db).some(entry => getIconId(entry.customIcon) === iconId);
    if (!isUsed) db.meta.customIcons.delete(iconId);
}

function collectAllEntries(db) {
    const out = [];
    collectEntries(db?.getDefaultGroup?.(), out);
    return out;
}

function collectEntries(group, out) {
    if (!group) return;
    out.push(...(group.entries || []));
    for (const child of group.groups || []) {
        collectEntries(child, out);
    }
}

function getIconId(icon) {
    return icon?.id || icon || null;
}

function arrayBuffersEqual(a, b) {
    const left = new Uint8Array(a);
    const right = new Uint8Array(b);
    if (left.byteLength !== right.byteLength) return false;

    for (let i = 0; i < left.byteLength; i++) {
        if (left[i] !== right[i]) return false;
    }
    return true;
}
