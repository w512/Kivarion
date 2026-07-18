import { ref, watch } from 'vue';

function clampWidth(value, minWidth, maxWidth) {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return Math.min(maxWidth, Math.max(minWidth, Math.trunc(number)));
}

function readStoredWidth(
    storageKey,
    legacyKeys,
    initialWidth,
    minWidth,
    maxWidth,
) {
    let stored = localStorage.getItem(storageKey);
    const hasCurrentValue = stored !== null;
    let migratedFromLegacy = false;

    if (stored === null) {
        for (const legacyKey of legacyKeys) {
            const legacyValue = localStorage.getItem(legacyKey);
            if (legacyValue !== null) {
                stored = legacyValue;
                migratedFromLegacy = true;
                break;
            }
        }
    }

    const clamped =
        clampWidth(stored, minWidth, maxWidth) ??
        clampWidth(initialWidth, minWidth, maxWidth) ??
        minWidth;

    if (migratedFromLegacy || (hasCurrentValue && stored !== String(clamped))) {
        localStorage.setItem(storageKey, String(clamped));
        if (migratedFromLegacy) {
            for (const legacyKey of legacyKeys)
                localStorage.removeItem(legacyKey);
        }
    }

    return clamped;
}

export function useResizable(
    storageKey,
    initialWidth,
    minWidth = 150,
    maxWidth = 600,
    offsetSource = null,
    legacyKeys = [],
) {
    const width = ref(
        readStoredWidth(
            storageKey,
            legacyKeys,
            initialWidth,
            minWidth,
            maxWidth,
        ),
    );
    const isResizing = ref(false);

    watch(width, (val) => {
        const clamped = clampWidth(val, minWidth, maxWidth) ?? initialWidth;
        if (val !== clamped) {
            width.value = clamped;
            return;
        }
        localStorage.setItem(storageKey, String(clamped));
    });

    function startResize() {
        isResizing.value = true;
        document.addEventListener('mousemove', resize);
        document.addEventListener('mouseup', stopResize);
    }

    function resize(e) {
        if (!isResizing.value) return;

        let newWidth;
        if (offsetSource && offsetSource.value !== undefined) {
            newWidth = e.clientX - offsetSource.value;
        } else {
            newWidth = e.clientX;
        }

        if (newWidth > minWidth && newWidth < maxWidth) {
            width.value = newWidth;
        }
    }

    function stopResize() {
        isResizing.value = false;
        document.removeEventListener('mousemove', resize);
        document.removeEventListener('mouseup', stopResize);
    }

    return {
        width,
        isResizing,
        startResize,
    };
}
