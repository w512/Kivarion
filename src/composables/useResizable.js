import { ref, watch } from 'vue';

export function useResizable(storageKey, initialWidth, minWidth = 150, maxWidth = 600, offsetSource = null) {
    const width = ref(parseInt(localStorage.getItem(storageKey)) || initialWidth);
    const isResizing = ref(false);

    watch(width, (val) => localStorage.setItem(storageKey, val));

    function startResize(e) {
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
        startResize
    };
}
