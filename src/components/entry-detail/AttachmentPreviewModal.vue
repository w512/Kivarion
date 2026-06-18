<template>
    <transition name="fade">
        <div v-if="show" class="preview-overlay" @click="$emit('close')">
            <div class="preview-content" @click.stop>
                <div class="preview-header">
                    <span class="preview-title">{{ name }}</span>
                    <button class="close-preview-btn" @click="$emit('close')">
                        <svg
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>
                <div class="preview-body">
                    <img v-if="isImage(name)" :src="url" alt="Preview" />
                    <iframe
                        v-else-if="isViewableInBrowser(name)"
                        :src="url"
                        class="iframe-preview"
                        sandbox
                    ></iframe>
                    <div v-else class="no-preview">
                        <svg
                            width="64"
                            height="64"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <path
                                d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
                            />
                            <polyline points="14 2 14 8 20 8" />
                        </svg>
                        <p v-if="isUnsafeAttachmentPreview(name)">
                            Preview disabled for this file type for security
                            reasons.
                        </p>
                        <p v-else>No preview available for this file type</p>
                    </div>
                </div>
            </div>
        </div>
    </transition>
</template>

<script setup>
import {
    isImage,
    isUnsafeAttachmentPreview,
    isViewableInBrowser,
} from '../../utils';

defineProps({
    show: { type: Boolean, required: true },
    url: { type: String, default: null },
    name: { type: String, default: '' },
});

defineEmits(['close']);
</script>

<style scoped>
.preview-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2000;
    backdrop-filter: blur(8px);
}

.preview-content {
    background: var(--card-bg);
    border-radius: 12px;
    width: 90vw;
    height: 90vh;
    max-width: 1000px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
}

.preview-header {
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--border-color);
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.preview-title {
    font-weight: 600;
    font-size: 1rem;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.close-preview-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 0.25rem;
    border-radius: 6px;
    transition: all 0.2s;
}

.close-preview-btn:hover {
    background: var(--badge-bg);
    color: var(--text-primary);
}

.preview-body {
    flex: 1;
    overflow: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
}

.preview-body img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: 4px;
}

.iframe-preview {
    width: 100%;
    height: 100%;
    border: none;
    background: white;
    border-radius: 4px;
}

.no-preview {
    text-align: center;
    color: var(--text-secondary);
}

.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}
</style>
