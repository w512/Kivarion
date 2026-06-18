import { onBeforeUnmount, onMounted } from 'vue';

/**
 * Invoke `handler` when a click happens outside the given element.
 *
 * @param {import('vue').Ref<HTMLElement|null>|HTMLElement} elementRef
 *   A template ref (or raw element) describing the boundary. Clicks on this
 *   element or any descendant are considered "inside" and ignored.
 * @param {(event: MouseEvent) => void} handler
 *   Called with the originating event when the click is outside.
 *
 * Listens on the document during the bubble phase so a trigger's own
 * `@click` (which lives inside the boundary) runs first and is ignored here.
 * The listener is registered on mount and removed automatically on unmount.
 */
export function useOutsideClick(elementRef, handler) {
    function onDocumentClick(event) {
        const el = elementRef?.value ?? elementRef;
        if (!el) return;
        const target = event.target;
        if (el === target || el.contains(target)) return;
        handler(event);
    }

    onMounted(() => document.addEventListener('click', onDocumentClick));
    onBeforeUnmount(() =>
        document.removeEventListener('click', onDocumentClick),
    );
}
