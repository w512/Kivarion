<template>
    <div class="attachments-section">
        <div class="section-header">
            <h3>Attachments</h3>
        </div>
        
        <div v-if="attachments.length === 0" class="no-attachments">
            No attachments
        </div>

        <div v-else class="attachments-grid">
            <div v-for="att in attachments" :key="att.name" class="attachment-card">
                <div class="attachment-preview" @click="$emit('preview', att)">
                    <img v-if="thumbnails.get(att.name)" :src="thumbnails.get(att.name)" alt="Preview" />
                    <div v-else class="file-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                        </svg>
                    </div>
                </div>
                <div class="attachment-info">
                    <div class="attachment-name" :title="att.name">{{ att.name }}</div>
                    <div class="attachment-size">{{ formatSize(att.size) }}</div>
                </div>
                <div class="attachment-actions">
                    <button class="menu-trigger" @click.stop="toggleMenu(att.name)" title="Attachment actions">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />
                        </svg>
                    </button>
                    <transition name="dropdown">
                        <div v-if="activeMenu === att.name" class="dropdown-menu attachment-menu">
                            <button class="menu-item" @click="$emit('preview', att); activeMenu = null">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                                </svg>
                                Preview
                            </button>
                            <button class="menu-item" @click="$emit('copy-name', att.name); activeMenu = null">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                </svg>
                                Copy Name
                            </button>
                            <button class="menu-item" @click="$emit('export', att); activeMenu = null">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                                </svg>
                                Export
                            </button>
                        </div>
                    </transition>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { formatSize } from '../../utils';

const props = defineProps({
    attachments: { type: Array, default: () => [] },
    thumbnails: { type: Map, default: () => new Map() },
});

defineEmits(['preview', 'copy-name', 'export']);

const activeMenu = ref(null);

function toggleMenu(name) {
    activeMenu.value = activeMenu.value === name ? null : name;
}

function handleClickOutside() {
    activeMenu.value = null;
}

onMounted(() => {
    document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
    document.removeEventListener('click', handleClickOutside);
});
</script>

<style scoped>
.attachments-section {
    margin-top: 1.5rem;
    border-top: 1px solid var(--border-color);
    padding-top: 1rem;
}

.section-header h3 {
    font-size: 0.8rem;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 1rem;
}

.no-attachments {
    text-align: center;
    padding: 1rem;
    color: var(--text-secondary);
    font-size: 0.85rem;
    background: var(--badge-bg);
    border-radius: 8px;
}

.attachments-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 0.75rem;
}

.attachment-card {
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    overflow: hidden;
    position: relative;
    transition: transform 0.2s, border-color 0.2s;
}

.attachment-card:hover {
    border-color: var(--accent-color);
    transform: translateY(-2px);
}

.attachment-preview {
    height: 80px;
    background: var(--badge-bg);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    overflow: hidden;
}

.attachment-preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.file-icon {
    color: var(--text-secondary);
    opacity: 0.5;
}

.attachment-info {
    padding: 0.5rem;
}

.attachment-name {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.attachment-size {
    font-size: 0.65rem;
    color: var(--text-secondary);
}

.attachment-actions {
    position: absolute;
    top: 4px;
    right: 4px;
}

.menu-trigger {
    width: 24px;
    height: 24px;
    border-radius: 4px;
    border: none;
    background: rgba(0, 0, 0, 0.4);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    backdrop-filter: blur(4px);
}

.dropdown-menu {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 4px;
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    min-width: 120px;
    z-index: 10;
    padding: 4px;
}

.menu-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.4rem 0.6rem;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-size: 0.75rem;
    cursor: pointer;
    border-radius: 4px;
    text-align: left;
}

.menu-item:hover {
    background: var(--badge-bg);
}

.dropdown-enter-active, .dropdown-leave-active {
    transition: all 0.15s ease;
}
.dropdown-enter-from, .dropdown-leave-to {
    opacity: 0;
    transform: translateY(-5px);
}
</style>
