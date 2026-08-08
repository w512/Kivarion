import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import {
    addCustomIcon,
    arrayBuffersEqual,
    getIconId,
    MAX_CUSTOM_ICON_BYTES,
    removeUnusedCustomIcon,
} from '../customIcons.js';
import { getField, normalizeHttpUrl, sniffImageMimeType } from '../utils';
import { useStore } from '../store';

const ICON_ENDPOINT = 'https://icon.horse/icon/';
// The same cap a hand-picked file gets: this path ends in the same
// `Meta/CustomIcons` list, and the lower one it used to carry refused site
// icons a user could then add by hand from a downloaded file.
const MAX_ICON_BYTES = MAX_CUSTOM_ICON_BYTES;
const ICON_FETCH_TIMEOUT_MS = 8000;
const ICON_FORMATS = 'PNG, JPEG, GIF, WebP, BMP, ICO or SVG';
const ICON_DEBOUNCE_MS = globalThis.__KIVARION_ICON_DEBOUNCE_MS__ ?? 300;
const MAX_ICON_CACHE_ENTRIES =
    globalThis.__KIVARION_ICON_CACHE_MAX_ENTRIES__ ?? 100;

const iconCache = new Map();
const inFlightFetches = new Map();
const pendingDownloads = new Map();
let cacheGeneration = 0;
let cacheListenerRegistered = false;

export function clearEntryIconCaches() {
    cacheGeneration++;
    iconCache.clear();
    inFlightFetches.clear();

    for (const pending of pendingDownloads.values()) {
        clearTimeout(pending.timer);
        pending.resolve(false);
    }
    pendingDownloads.clear();
}

function registerCacheCleanup() {
    if (cacheListenerRegistered || typeof window === 'undefined') return;
    window.addEventListener('kivarion:before-lock', clearEntryIconCaches);
    cacheListenerRegistered = true;
}

export function useEntryIcons(emit) {
    const store = useStore();
    registerCacheCleanup();

    function downloadIcon(entry) {
        if (!entry) return Promise.resolve(false);

        const pending = pendingDownloads.get(entry);
        if (pending) {
            clearTimeout(pending.timer);
            pending.resolve(false);
            pendingDownloads.delete(entry);
        }

        if (store.downloadSiteIcons === false) return Promise.resolve(false);

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
        downloadIcon,
    };
}

async function applyIcon(entry, store, emit) {
    if (store.downloadSiteIcons === false) return false;

    const url = normalizeHttpUrl(getField(entry, 'URL'));
    const db = store.db;
    if (!url || !db) return false;

    const domain = new URL(url).hostname.toLowerCase();
    const buffer = await fetchIconForDomain(domain);
    if (
        !buffer ||
        !buffer.byteLength ||
        store.db !== db ||
        store.downloadSiteIcons === false
    ) {
        return false;
    }

    const oldIconId = getIconId(entry.customIcon);
    const oldIcon = oldIconId ? db.meta.customIcons.get(oldIconId) : null;

    if (oldIcon?.data && arrayBuffersEqual(oldIcon.data, buffer)) {
        return false;
    }

    const nextIcon = addCustomIcon(db, buffer, domain);
    if (oldIconId === nextIcon.id) return false;

    entry.customIcon = nextIcon;
    entry.times.update();
    removeUnusedCustomIcon(db, oldIconId);
    emit('updated');
    return true;
}

async function fetchIconForDomain(domain) {
    if (iconCache.has(domain)) {
        const cached = iconCache.get(domain);
        iconCache.delete(domain);
        iconCache.set(domain, cached);
        return cached.slice(0);
    }
    if (inFlightFetches.has(domain))
        return (await inFlightFetches.get(domain)).slice(0);

    const generation = cacheGeneration;
    let promise;
    promise = fetchIcon(domain)
        .then((buffer) => {
            if (generation === cacheGeneration) cacheIcon(domain, buffer);
            return buffer;
        })
        .finally(() => {
            if (inFlightFetches.get(domain) === promise) {
                inFlightFetches.delete(domain);
            }
        });

    inFlightFetches.set(domain, promise);
    return (await promise).slice(0);
}

function cacheIcon(domain, buffer) {
    iconCache.delete(domain);
    iconCache.set(domain, buffer.slice(0));

    while (iconCache.size > MAX_ICON_CACHE_ENTRIES) {
        iconCache.delete(iconCache.keys().next().value);
    }
}

async function fetchIcon(domain) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ICON_FETCH_TIMEOUT_MS);

    try {
        const res = await tauriFetch(
            `${ICON_ENDPOINT}${encodeURIComponent(domain)}`,
            {
                signal: controller.signal,
                connectTimeout: ICON_FETCH_TIMEOUT_MS,
            },
        );

        if (!res.ok)
            throw new Error(`Icon fetch failed with status ${res.status}`);

        const contentLength = Number(res.headers.get('content-length') || 0);
        if (contentLength > MAX_ICON_BYTES) {
            throw new Error(`Icon is too large: ${contentLength} bytes`);
        }

        const buffer = await readLimitedBody(res, controller);

        // The gate is the bytes, not the `Content-Type` header. A favicon is
        // whatever the site publishes — icon.horse passes ICO, SVG and JPEG
        // through unchanged, and a strict `image/png` allowlist rejected most
        // real sites' icons. Sniffing is also the stricter check of the two: a
        // server can label an HTML error page `image/png`, and the header said
        // nothing about what would actually be stored in the vault. This is the
        // same rule the icon picker applies to a local file.
        const mime = sniffImageMimeType(new Uint8Array(buffer));
        if (!mime) {
            throw new Error(
                `Downloaded icon is not a supported image (${ICON_FORMATS})`,
            );
        }

        return buffer;
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

            const chunk =
                value instanceof Uint8Array ? value : new Uint8Array(value);
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
