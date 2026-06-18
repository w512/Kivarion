<template>
    <div ref="root" class="custom-dropdown">
        <button
            ref="triggerRef"
            class="dropdown-trigger"
            :title="'Sort: ' + currentSortLabel"
            aria-haspopup="true"
            :aria-expanded="isSortOpen"
            @click="toggle"
            @keydown.down.prevent="openAndFocusFirst"
        >
            <span class="trigger-label">{{ currentSortLabel }}</span>
            <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="chevron"
                :class="{ open: isSortOpen }"
            >
                <path d="m6 9 6 6 6-6" />
            </svg>
        </button>
        <div
            v-if="isSortOpen"
            ref="menuRef"
            class="dropdown-menu"
            role="menu"
            @keydown="onMenuKeydown"
        >
            <button
                v-for="option in sortOptions"
                :key="option.value"
                class="dropdown-item"
                :class="{ active: modelValue === option.value }"
                role="menuitem"
                @click="updateSort(option.value)"
            >
                {{ option.label }}
            </button>
        </div>
    </div>
</template>

<script setup>
import { computed, nextTick, ref } from 'vue';
import { useOutsideClick } from '../../composables/useOutsideClick';

const props = defineProps({
    modelValue: { type: String, required: true },
});

const emit = defineEmits(['update:modelValue']);

const isSortOpen = ref(false);
const root = ref(null);
const triggerRef = ref(null);
const menuRef = ref(null);

useOutsideClick(root, () => (isSortOpen.value = false));

const sortOptions = [
    { label: 'Title (A-Z)', value: 'title-asc' },
    { label: 'Title (Z-A)', value: 'title-desc' },
    { label: 'Newest', value: 'created-desc' },
    { label: 'Oldest', value: 'created-asc' },
    { label: 'Recently edited', value: 'modified-desc' },
    { label: 'Least recently edited', value: 'modified-asc' },
];

const currentSortLabel = computed(() => {
    return (
        sortOptions.find((opt) => opt.value === props.modelValue)?.label ||
        'Sort'
    );
});

function toggle() {
    isSortOpen.value = !isSortOpen.value;
}

function close() {
    isSortOpen.value = false;
}

function updateSort(val) {
    emit('update:modelValue', val);
    close();
    triggerRef.value?.focus();
}

function menuItems() {
    return menuRef.value
        ? Array.from(menuRef.value.querySelectorAll('.dropdown-item'))
        : [];
}

function focusItem(index) {
    const items = menuItems();
    if (items.length === 0) return;
    const wrapped = (index + items.length) % items.length;
    items[wrapped].focus();
}

function openAndFocusFirst() {
    isSortOpen.value = true;
    nextTick(() => focusItem(0));
}

function onMenuKeydown(e) {
    const items = menuItems();
    const current = items.indexOf(document.activeElement);
    switch (e.key) {
        case 'ArrowDown':
            e.preventDefault();
            focusItem(current + 1);
            break;
        case 'ArrowUp':
            e.preventDefault();
            focusItem(current - 1);
            break;
        case 'Home':
            e.preventDefault();
            focusItem(0);
            break;
        case 'End':
            e.preventDefault();
            focusItem(items.length - 1);
            break;
        case 'Escape':
            e.preventDefault();
            close();
            triggerRef.value?.focus();
            break;
        case 'Tab':
            close();
            break;
    }
}
</script>

<style scoped>
.custom-dropdown {
    position: relative;
    user-select: none;
}

.dropdown-trigger {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.3rem 0.6rem;
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    color: var(--text-secondary);
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    min-width: 100px;
    justify-content: space-between;
}

.dropdown-trigger:hover {
    color: var(--text-primary);
    border-color: var(--accent-color);
    background: rgba(99, 102, 241, 0.05);
}

.chevron {
    transition: transform 0.2s;
    opacity: 0.7;
}

.chevron.open {
    transform: rotate(180deg);
}

.dropdown-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 100;
    min-width: 130px;
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 4px;
    box-shadow:
        0 10px 15px -3px rgba(0, 0, 0, 0.3),
        0 4px 6px -2px rgba(0, 0, 0, 0.15);
}

.dropdown-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 0.4rem 0.6rem;
    font-size: 0.75rem;
    color: var(--text-secondary);
    background: transparent;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
}

.dropdown-item:hover {
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-primary);
}

.dropdown-item.active {
    color: var(--accent-color);
    background: rgba(99, 102, 241, 0.1);
    font-weight: 600;
}
</style>
