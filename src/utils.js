export function formatDate(date) {
    if (!date) return '—';
    return new Intl.DateTimeFormat('default', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

export function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export const STANDARD_FIELDS = ['Title', 'UserName', 'Password', 'URL', 'Notes'];

export function normalizeFieldName(name) {
    return (name || '').trim().toLocaleLowerCase();
}

export function isStandardFieldName(name) {
    const normalized = normalizeFieldName(name);
    return STANDARD_FIELDS.some(field => normalizeFieldName(field) === normalized);
}

export function isProtectedValue(val) {
    return !!val && typeof val !== 'string' && typeof val.getText === 'function';
}

export function getField(entry, name) {
    if (!entry || !entry.fields) return '';
    const val = entry.fields.get(name);
    if (!val) return '';
    if (typeof val === 'string') return val;
    if (isProtectedValue(val)) return val.getText();
    return String(val);
}

export function toExactArrayBuffer(bytes) {
    if (bytes instanceof ArrayBuffer) return bytes.slice(0);
    if (!ArrayBuffer.isView(bytes)) {
        throw new TypeError('Expected an ArrayBuffer or a typed array');
    }
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export function normalizeHttpUrl(value) {
    const trimmed = (value || '').trim();
    if (!trimmed) return '';

    const urlText = trimmed.includes('://') ? trimmed : `https://${trimmed}`;

    try {
        const url = new URL(urlText);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
        if (!url.hostname || url.username || url.password) return '';
        return url.href;
    } catch {
        return '';
    }
}

// Single source of truth for file-type handling, keyed by extension.
// `image` marks files shown as inline thumbnails; `viewable` marks files the
// browser can render in the preview modal. Images are always viewable.
const FILE_TYPES = {
    // Images
    png: { mime: 'image/png', image: true },
    jpg: { mime: 'image/jpeg', image: true },
    jpeg: { mime: 'image/jpeg', image: true },
    gif: { mime: 'image/gif', image: true },
    svg: { mime: 'image/svg+xml', image: true },
    webp: { mime: 'image/webp', image: true },
    // Documents & text
    pdf: { mime: 'application/pdf', viewable: true },
    txt: { mime: 'text/plain', viewable: true },
    md: { mime: 'text/markdown', viewable: true },
    html: { mime: 'text/html', viewable: true },
    js: { mime: 'text/javascript', viewable: true },
    css: { mime: 'text/css', viewable: true },
    json: { mime: 'application/json', viewable: true },
    // Media
    mp4: { mime: 'video/mp4', viewable: true },
    mp3: { mime: 'audio/mpeg', viewable: true },
    wav: { mime: 'audio/wav', viewable: true },
};

function fileInfo(name) {
    const ext = (name || '').split('.').pop().toLowerCase();
    return FILE_TYPES[ext] || null;
}

export function isImage(name) {
    return !!fileInfo(name)?.image;
}

export function getMimeType(name) {
    return fileInfo(name)?.mime || 'application/octet-stream';
}

export function isViewableInBrowser(name) {
    const info = fileInfo(name);
    return !!info && (info.viewable || info.image);
}

export function generatePassword(options = {}) {
    const {
        length = 20,
        upper = true,
        lower = true,
        numbers = true,
        symbols = true,
        excludeSimilar = true
    } = options;

    let charset = '';
    if (upper) charset += 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // Excluded I, O
    if (!excludeSimilar && upper) charset += 'IO';
    
    if (lower) charset += 'abcdefghijkmnopqrstuvwxyz'; // Excluded l
    if (!excludeSimilar && lower) charset += 'l';

    if (numbers) charset += '23456789'; // Excluded 0, 1
    if (!excludeSimilar && numbers) charset += '01';

    if (symbols) charset += '!@#$%^&*()_+-=[]{}|;:,.<>?';

    if (charset === '') return '';

    let password = '';
    for (let i = 0; i < length; i++) {
        password += charset[secureRandomIndex(charset.length)];
    }
    return password;
}

/**
 * Uniformly pick an index in [0, max) using rejection sampling so that no
 * character is statistically favoured (plain `random % max` is biased unless
 * max divides 2^32).
 */
function secureRandomIndex(max) {
    const range = 2 ** 32;
    const limit = Math.floor(range / max) * max;
    const buf = new Uint32Array(1);
    let x;
    do {
        window.crypto.getRandomValues(buf);
        x = buf[0];
    } while (x >= limit);
    return x % max;
}
