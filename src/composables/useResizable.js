import { onUnmounted, ref, watch } from 'vue';

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

/**
 * A draggable, persisted column width.
 *
 * @param {string} storageKey
 * @param {number} initialWidth
 * @param {object} [options]
 * @param {number} [options.minWidth]
 * @param {number} [options.maxWidth]
 * @param {import('vue').Ref<number>} [options.offsetSource] - width of everything
 *   to the left of this column, subtracted from the pointer position.
 * @param {string[]} [options.legacyKeys] - older localStorage keys to migrate from.
 * @param {number} [options.reserve] - horizontal space that must stay available
 *   for the columns to the right. Without it a wide drag in a narrow window
 *   pushes them past their CSS min-width and the layout overflows sideways.
 */
export function useResizable(
    storageKey,
    initialWidth,
    {
        minWidth = 150,
        maxWidth = 600,
        offsetSource = null,
        legacyKeys = [],
        reserve = 0,
    } = {},
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
    let activePointerId = null;
    let captureTarget = null;

    watch(width, (val) => {
        const clamped = clampWidth(val, minWidth, maxWidth) ?? initialWidth;
        if (val !== clamped) {
            width.value = clamped;
            return;
        }
        localStorage.setItem(storageKey, String(clamped));
    });

    // The ceiling is whatever `maxWidth` allows *and* the window can spare.
    // Never below `minWidth`: in a window too small for every column the CSS
    // min-widths take over instead of this collapsing the dragged one.
    function currentMaxWidth() {
        const viewport = globalThis.window?.innerWidth;
        if (!Number.isFinite(viewport)) return maxWidth;

        const offset = offsetSource?.value ?? 0;
        return Math.max(
            minWidth,
            Math.min(maxWidth, viewport - offset - reserve),
        );
    }

    function startResize(event) {
        // Ignore secondary buttons, so a right-click on the divider does not
        // begin a drag that only ends on the next click.
        if (event && event.button !== undefined && event.button !== 0) return;

        isResizing.value = true;

        // Pointer capture keeps the drag alive while the cursor is outside the
        // window and guarantees a pointerup/pointercancel. With plain mouse
        // events a release off-window never delivered mouseup, leaving the
        // column stuck to the cursor after the button was let go.
        activePointerId = event?.pointerId ?? null;
        captureTarget = event?.currentTarget ?? null;
        if (activePointerId !== null && captureTarget?.setPointerCapture) {
            try {
                captureTarget.setPointerCapture(activePointerId);
            } catch {
                captureTarget = null;
            }
        }

        document.addEventListener('pointermove', resize);
        document.addEventListener('pointerup', stopResize);
        document.addEventListener('pointercancel', stopResize);
    }

    function resize(event) {
        if (!isResizing.value) return;

        const offset = offsetSource?.value ?? 0;
        // Clamp rather than ignore an out-of-range position: dropping the
        // update made the column stop following the pointer mid-drag instead
        // of resting against its limit.
        width.value =
            clampWidth(event.clientX - offset, minWidth, currentMaxWidth()) ??
            width.value;
    }

    function stopResize() {
        isResizing.value = false;

        if (activePointerId !== null && captureTarget?.releasePointerCapture) {
            try {
                captureTarget.releasePointerCapture(activePointerId);
            } catch {
                // Already released — the pointer ended outside the element.
            }
        }
        activePointerId = null;
        captureTarget = null;

        document.removeEventListener('pointermove', resize);
        document.removeEventListener('pointerup', stopResize);
        document.removeEventListener('pointercancel', stopResize);
    }

    // Auto-lock can unmount the page mid-drag; without this the document
    // listeners would outlive the component and keep writing to a dead ref.
    onUnmounted(stopResize);

    return {
        width,
        isResizing,
        startResize,
    };
}
