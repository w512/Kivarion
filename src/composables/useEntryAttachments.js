import { ref, computed, watch, onUnmounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { isImage, getMimeType } from '../utils';
import { useClipboard } from './useClipboard';

export function useEntryAttachments(entryRef, isMac) {
    const { copy } = useClipboard();
    const attachmentThumbnails = ref(new Map());
    const showPreview = ref(false);
    const previewUrl = ref(null);
    const previewName = ref('');

    const attachments = computed(() => {
        const list = [];
        const entry = entryRef.value;
        if (entry?.binaries) {
            for (const [name, binary] of entry.binaries) {
                let data = null;
                if (binary?.value) {
                    data =
                        binary.value instanceof Uint8Array
                            ? binary.value
                            : binary.value.getBinary?.();
                } else if (binary instanceof Uint8Array) {
                    data = binary;
                }
                if (data) list.push({ name, size: data.byteLength, data });
            }
        }
        return list;
    });

    watch(
        attachments,
        (newAttachments) => {
            // Cleanup old URLs
            for (const url of attachmentThumbnails.value.values()) {
                URL.revokeObjectURL(url);
            }
            attachmentThumbnails.value.clear();

            // Create new URLs for images
            for (const att of newAttachments) {
                if (isImage(att.name)) {
                    attachmentThumbnails.value.set(
                        att.name,
                        URL.createObjectURL(new Blob([att.data])),
                    );
                }
            }
        },
        { immediate: true },
    );

    onUnmounted(() => {
        for (const url of attachmentThumbnails.value.values()) {
            URL.revokeObjectURL(url);
        }
        if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
    });

    async function openPreview(attachment) {
        if (isMac.value) {
            try {
                // The Rust side writes the decrypted bytes into a private,
                // owner-only temp dir and deletes them after the preview closes.
                // Passing the name (not a path) keeps path traversal out of reach.
                await invoke('quick_look_attachment', {
                    fileName: attachment.name,
                    data: Array.from(attachment.data),
                });
            } catch (err) {
                console.error('Quick Look failed, fallback to modal', err);
                openPreviewModal(attachment);
            }
        } else {
            openPreviewModal(attachment);
        }
    }

    function openPreviewModal(attachment) {
        if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
        previewUrl.value = URL.createObjectURL(
            new Blob([attachment.data], { type: getMimeType(attachment.name) }),
        );
        previewName.value = attachment.name;
        showPreview.value = true;
    }

    function closePreview() {
        showPreview.value = false;
        // Delay revocation to allow closing animation to finish
        setTimeout(() => {
            if (!showPreview.value && previewUrl.value) {
                URL.revokeObjectURL(previewUrl.value);
                previewUrl.value = null;
            }
        }, 300);
    }

    async function exportAttachment(att) {
        try {
            const filePath = await save({ defaultPath: att.name });
            if (filePath)
                await invoke('export_file', { path: filePath, data: att.data });
        } catch (err) {
            console.error('Failed to export attachment:', err);
        }
    }

    function copyAttachmentName(name) {
        copy(name);
    }

    return {
        attachments,
        attachmentThumbnails,
        showPreview,
        previewUrl,
        previewName,
        openPreview,
        closePreview,
        exportAttachment,
        copyAttachmentName,
    };
}
