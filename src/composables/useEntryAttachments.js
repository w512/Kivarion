import { computed, onUnmounted, ref, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { invokeWithBytes } from '../ipc.js';
import { pushEntryHistory } from '../entryHistory.js';
import { getMimeType, isImage, toExactArrayBuffer } from '../utils';
import { useStore } from '../store';
import { useClipboard } from './useClipboard';
import { withSystemInteraction } from './useSystemInteraction.js';

const MAX_ATTACHMENT_NAME_LENGTH = 255;

// An attachment lives inside the `.kdbx`, so its cost is not the one-off read:
// every later save re-encrypts it along with the rest of the vault, the backup
// rotation copies it, and rename/delete keep a second copy in entry history.
// Above this size the user is told that before the file is read at all.
export const LARGE_ATTACHMENT_SIZE = 10 * 1024 * 1024;

function hasInvalidAttachmentNameCharacters(name) {
    return (
        name.includes('/') ||
        name.includes('\\') ||
        [...name].some((character) => character.codePointAt(0) < 32)
    );
}

export function getAttachmentBytes(binary) {
    // A direct ProtectedValue also has a `.value`, but that byte array is the
    // XOR-obfuscated representation. Always ask it for decrypted bytes first.
    const directProtectedBytes = binary?.getBinary?.();
    if (directProtectedBytes instanceof Uint8Array) return directProtectedBytes;
    if (directProtectedBytes instanceof ArrayBuffer) {
        return new Uint8Array(directProtectedBytes);
    }

    const value = binary?.value ?? binary;
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }

    const protectedBytes = value?.getBinary?.();
    if (protectedBytes instanceof Uint8Array) return protectedBytes;
    if (protectedBytes instanceof ArrayBuffer) {
        return new Uint8Array(protectedBytes);
    }
    return null;
}

export function validateAttachmentName(
    name,
    existingNames = [],
    currentName = null,
) {
    const normalized = (name || '').trim();
    if (!normalized) return 'Attachment name cannot be empty.';
    if (normalized.length > MAX_ATTACHMENT_NAME_LENGTH) {
        return `Attachment name cannot exceed ${MAX_ATTACHMENT_NAME_LENGTH} characters.`;
    }
    if (hasInvalidAttachmentNameCharacters(normalized)) {
        return 'Attachment name cannot contain slashes or control characters.';
    }

    const key = normalized.toLocaleLowerCase();
    const currentKey = currentName?.toLocaleLowerCase();
    if (
        key !== currentKey &&
        existingNames.some((existing) => existing.toLocaleLowerCase() === key)
    ) {
        return 'An attachment with this name already exists.';
    }
    return '';
}

export function getUniqueAttachmentName(name, existingNames = []) {
    const original = (name || '').trim() || 'attachment';
    const existing = new Set(
        existingNames.map((item) => item.toLocaleLowerCase()),
    );
    if (!existing.has(original.toLocaleLowerCase())) return original;

    const dot = original.lastIndexOf('.');
    const hasExtension = dot > 0 && dot < original.length - 1;
    const base = hasExtension ? original.slice(0, dot) : original;
    const extension = hasExtension ? original.slice(dot) : '';
    let index = 2;
    let candidate;
    do {
        candidate = `${base} (${index++})${extension}`;
    } while (existing.has(candidate.toLocaleLowerCase()));
    return candidate;
}

export function addEntryAttachment(entry, name, binary) {
    if (!entry?.binaries || !binary) {
        return { ok: false, error: 'Could not create the attachment.' };
    }

    const uniqueName = getUniqueAttachmentName(name, [
        ...entry.binaries.keys(),
    ]);
    pushEntryHistory(entry);
    entry.binaries.set(uniqueName, binary);
    entry.times?.update?.();
    return { ok: true, name: uniqueName };
}

export function renameEntryAttachment(entry, oldName, newName) {
    if (!entry?.binaries?.has(oldName)) {
        return { ok: false, error: 'Attachment no longer exists.' };
    }

    const normalized = (newName || '').trim();
    const error = validateAttachmentName(
        normalized,
        [...entry.binaries.keys()],
        oldName,
    );
    if (error) return { ok: false, error };
    if (normalized === oldName) return { ok: true, changed: false };

    const binary = entry.binaries.get(oldName);
    pushEntryHistory(entry);
    entry.binaries.delete(oldName);
    entry.binaries.set(normalized, binary);
    entry.times?.update?.();
    return { ok: true, changed: true, name: normalized };
}

export function deleteEntryAttachment(entry, name) {
    if (!entry?.binaries?.has(name)) return false;
    pushEntryHistory(entry);
    entry.binaries.delete(name);
    entry.times?.update?.();
    return true;
}

export function useEntryAttachments(entryRef, isMac, emitUpdated = () => {}) {
    const store = useStore();
    const { copy } = useClipboard();
    const attachmentThumbnails = ref(new Map());
    const showPreview = ref(false);
    const previewUrl = ref(null);
    const previewName = ref('');
    const isAddingAttachment = ref(false);
    const attachmentError = ref('');
    const attachmentVersion = ref(0);
    const pendingLargeAttachment = ref(null);
    let resolveLargeAttachment = null;

    const attachments = computed(() => {
        // KDBX maps are not reactive. dbVersion covers mutations made anywhere
        // else; attachmentVersion makes these local operations update even in
        // isolation before the parent save handler runs.
        store.dbVersion;
        attachmentVersion.value;

        const list = [];
        const entry = entryRef.value;
        if (entry?.binaries) {
            for (const [name, binary] of entry.binaries) {
                const data = getAttachmentBytes(binary);
                if (data) list.push({ name, size: data.byteLength, data });
            }
        }
        return list;
    });

    const totalAttachmentsSize = computed(() =>
        attachments.value.reduce((total, att) => total + att.size, 0),
    );

    watch(
        attachments,
        (newAttachments) => {
            for (const url of attachmentThumbnails.value.values()) {
                URL.revokeObjectURL(url);
            }
            attachmentThumbnails.value.clear();

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

    // A pending size confirmation must never outlive what it was asked about:
    // the entry can change and auto-lock can close the database while the modal
    // is open, and an unanswered promise would keep addAttachment hanging.
    function answerLargeAttachment(accepted) {
        const resolve = resolveLargeAttachment;
        resolveLargeAttachment = null;
        pendingLargeAttachment.value = null;
        resolve?.(accepted);
    }

    function confirmLargeAttachment() {
        answerLargeAttachment(true);
    }

    function cancelLargeAttachment() {
        answerLargeAttachment(false);
    }

    watch([entryRef, () => store.db], () => {
        if (resolveLargeAttachment) answerLargeAttachment(false);
    });

    onUnmounted(() => {
        if (resolveLargeAttachment) answerLargeAttachment(false);
        for (const url of attachmentThumbnails.value.values()) {
            URL.revokeObjectURL(url);
        }
        if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
    });

    function askAboutLargeAttachment(selection) {
        return new Promise((resolve) => {
            resolveLargeAttachment = resolve;
            pendingLargeAttachment.value = {
                name: selection.fileName,
                size: selection.size,
            };
        });
    }

    async function addAttachment() {
        if (isAddingAttachment.value || !store.db || !entryRef.value) return;

        const db = store.db;
        const entry = entryRef.value;
        attachmentError.value = '';
        isAddingAttachment.value = true;

        try {
            // Only the picker takes the screen away from the app; the read and
            // the confirmation below run with the window focused again.
            const selection = await withSystemInteraction(() =>
                invoke('pick_attachment_file'),
            );
            if (!selection) return;
            if (store.db !== db || entryRef.value !== entry) return;

            if (selection.size > LARGE_ATTACHMENT_SIZE) {
                const accepted = await askAboutLargeAttachment(selection);
                if (!accepted) return;
                if (store.db !== db || entryRef.value !== entry) return;
            }

            const bytes = await invoke('read_database', {
                path: selection.path,
            });
            if (store.db !== db || entryRef.value !== entry) return;

            const data = new Uint8Array(toExactArrayBuffer(bytes));
            const binary = await db.createBinary(data);
            if (store.db !== db || entryRef.value !== entry) return;

            const result = addEntryAttachment(
                entry,
                selection.fileName,
                binary,
            );
            if (!result.ok) throw new Error(result.error);
            attachmentVersion.value++;
            emitUpdated('updated');
        } catch (error) {
            console.error('Failed to add attachment:', error);
            attachmentError.value = 'Could not add this attachment.';
        } finally {
            if (resolveLargeAttachment) answerLargeAttachment(false);
            isAddingAttachment.value = false;
        }
    }

    function renameAttachment(oldName, newName) {
        const entry = entryRef.value;
        const result = renameEntryAttachment(entry, oldName, newName);
        if (!result.ok || !result.changed) return result;

        if (previewName.value === oldName) previewName.value = result.name;
        attachmentVersion.value++;
        emitUpdated('updated');
        return result;
    }

    function deleteAttachment(name) {
        const entry = entryRef.value;
        if (!deleteEntryAttachment(entry, name)) return false;

        if (previewName.value === name) closePreview();
        attachmentVersion.value++;
        emitUpdated('updated');
        return true;
    }

    async function openPreview(attachment) {
        if (isMac.value) {
            try {
                // The Rust side writes the decrypted bytes into a unique,
                // owner-only temp dir and deletes it after the preview closes;
                // stale dirs are removed at next launch. Quick Look itself may
                // retain OS-managed preview cache data that the app cannot purge.
                // Passing the name (not a path) keeps path traversal out of reach.
                // Quick Look owns the screen until it is dismissed, so this must
                // not read as the user leaving the app (auto-lock).
                await withSystemInteraction(() =>
                    invokeWithBytes('quick_look_attachment', attachment.data, {
                        'file-name': attachment.name,
                    }),
                );
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
            // The native save dialog holds focus; locking the database while it
            // is open would abandon the export half-done.
            await withSystemInteraction(async () => {
                // The dialog runs in the backend, which grants write access to
                // the chosen path — `export_file` refuses anything else.
                const filePath = await invoke('pick_export_path', {
                    defaultName: att.name,
                });
                if (filePath) {
                    await invokeWithBytes('export_file', att.data, {
                        path: filePath,
                    });
                }
            });
        } catch (err) {
            console.error('Failed to export attachment:', err);
        }
    }

    function copyAttachmentName(name) {
        copy(name);
    }

    function clearAttachmentError() {
        attachmentError.value = '';
    }

    return {
        attachments,
        attachmentThumbnails,
        totalAttachmentsSize,
        showPreview,
        previewUrl,
        previewName,
        isAddingAttachment,
        attachmentError,
        pendingLargeAttachment,
        confirmLargeAttachment,
        cancelLargeAttachment,
        addAttachment,
        renameAttachment,
        deleteAttachment,
        clearAttachmentError,
        openPreview,
        closePreview,
        exportAttachment,
        copyAttachmentName,
    };
}
