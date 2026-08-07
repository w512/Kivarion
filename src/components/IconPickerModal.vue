<template>
    <BaseModal
        :show="show"
        width="640px"
        labelledby="icon-picker-title"
        :close-on-backdrop="!busy"
        :close-on-esc="!busy"
        @close="emit('cancel')"
    >
        <h3 id="icon-picker-title" class="picker-title">
            Select an icon for “{{ targetName }}”
        </h3>

        <div class="icon-sections">
            <section v-if="customIcons.length" class="icon-section">
                <h4 class="section-title">Database Icons</h4>
                <div
                    class="icon-grid"
                    role="group"
                    aria-label="Icons stored in this database"
                    @keydown="onGridKeydown"
                >
                    <button
                        v-for="icon in customIcons"
                        :key="icon.id"
                        type="button"
                        class="icon-button"
                        :class="{ selected: icon.id === selectedCustomIconId }"
                        :title="icon.name || 'Custom icon'"
                        :aria-label="icon.name || 'Custom icon'"
                        :aria-pressed="icon.id === selectedCustomIconId"
                        :tabindex="icon.id === selectedCustomIconId ? 0 : -1"
                        :disabled="busy"
                        @click="emit('select-custom', icon.id)"
                    >
                        <ObjectIcon :src="icon.src" :size="24" />
                    </button>
                </div>
            </section>

            <section class="icon-section">
                <h4 class="section-title">Kivarion Icons</h4>
                <div
                    class="icon-grid"
                    role="group"
                    aria-label="Built-in icons"
                    @keydown="onGridKeydown"
                >
                    <button
                        v-for="icon in standardIcons"
                        :key="icon.id"
                        type="button"
                        class="icon-button"
                        :class="{ selected: isStandardSelected(icon.id) }"
                        :title="icon.name"
                        :aria-label="icon.name"
                        :aria-pressed="isStandardSelected(icon.id)"
                        :tabindex="
                            isStandardSelected(icon.id) ||
                            (!hasFocusableStandard && icon.id === 0)
                                ? 0
                                : -1
                        "
                        :disabled="busy"
                        @click="emit('select-standard', icon.id)"
                    >
                        <ObjectIcon :icon-id="icon.id" :size="24" />
                    </button>
                </div>
            </section>
        </div>

        <p v-if="error" class="picker-error" role="alert">{{ error }}</p>

        <div class="modal-actions">
            <button type="button" class="cancel-btn" @click="emit('cancel')">
                Cancel
            </button>
            <div class="actions-right">
                <button
                    v-if="canDownloadFavicon"
                    type="button"
                    class="secondary-btn"
                    :disabled="busy"
                    @click="emit('download-favicon')"
                >
                    Find Favicon
                </button>
                <button
                    type="button"
                    class="secondary-btn"
                    :disabled="busy"
                    @click="emit('pick-file')"
                >
                    Select from File…
                </button>
                <button
                    type="button"
                    class="secondary-btn"
                    :disabled="busy"
                    @click="emit('use-default')"
                >
                    Use Default
                </button>
            </div>
        </div>
    </BaseModal>
</template>

<script setup>
import { computed } from 'vue';
import BaseModal from './BaseModal.vue';
import ObjectIcon from './ObjectIcon.vue';
import { STANDARD_ICONS } from '../standardIcons.js';

const props = defineProps({
    show: { type: Boolean, default: false },
    targetName: { type: String, default: '' },
    // `{ id, src, name }` for every icon stored in this database.
    customIcons: { type: Array, default: () => [] },
    selectedIconId: { type: Number, default: null },
    selectedCustomIconId: { type: String, default: null },
    canDownloadFavicon: { type: Boolean, default: false },
    busy: { type: Boolean, default: false },
    error: { type: String, default: '' },
});

const emit = defineEmits([
    'select-standard',
    'select-custom',
    'pick-file',
    'download-favicon',
    'use-default',
    'cancel',
]);

const standardIcons = STANDARD_ICONS;

// A custom icon wins over the standard id, exactly as the tree and list render
// it — so an object showing a custom icon marks none of the built-in ones.
function isStandardSelected(id) {
    return !props.selectedCustomIconId && props.selectedIconId === id;
}

const hasFocusableStandard = computed(
    () =>
        !props.selectedCustomIconId &&
        standardIcons.some((icon) => icon.id === props.selectedIconId),
);

// Seventy-odd buttons would be seventy-odd tab stops, so the grids are walked
// with the arrow keys and only the selected button is in the tab order. The
// column count is measured rather than assumed: the grid reflows with the
// window, and a hard-coded stride would jump to the wrong row.
function onGridKeydown(event) {
    const step = {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: 'up',
        ArrowDown: 'down',
    }[event.key];
    if (step === undefined) return;

    const grid = event.currentTarget;
    const buttons = Array.from(grid.querySelectorAll('button'));
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;

    event.preventDefault();
    const columns =
        buttons.filter((button) => button.offsetTop === buttons[0].offsetTop)
            .length || 1;
    const delta = step === 'up' ? -columns : step === 'down' ? columns : step;
    const next = Math.min(Math.max(index + delta, 0), buttons.length - 1);
    buttons[next]?.focus();
}
</script>

<style scoped>
.picker-title {
    margin: 0 0 1rem;
    font-size: 1rem;
    color: var(--text-primary);
    text-align: center;
}

.icon-sections {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-height: min(60vh, 460px);
    overflow-y: auto;
}

.section-title {
    margin: 0 0 0.5rem;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-secondary);
}

.icon-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(44px, 1fr));
    gap: 4px;
    padding: 0.5rem;
    border: 1px solid var(--border-color);
    border-radius: 10px;
    background: var(--badge-bg);
}

.icon-button {
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    transition:
        background 0.15s,
        border-color 0.15s;
}

.icon-button:hover:not(:disabled) {
    background: var(--card-bg);
    border-color: var(--border-color);
}

.icon-button:focus-visible {
    outline: 2px solid var(--accent-color);
    outline-offset: -2px;
}

.icon-button.selected {
    background: rgba(99, 102, 241, 0.15);
    border-color: var(--accent-color);
    color: var(--accent-color);
}

.icon-button:disabled {
    opacity: 0.5;
    cursor: default;
}

.picker-error {
    margin: 0.75rem 0 0;
    color: var(--error-color);
    font-size: 0.8rem;
}

.modal-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-top: 1.25rem;
}

.actions-right {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.5rem;
}

.cancel-btn,
.secondary-btn {
    padding: 0.5rem 0.9rem;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--card-bg);
    color: var(--text-primary);
    font-size: 0.85rem;
    cursor: pointer;
}

.cancel-btn:hover:not(:disabled),
.secondary-btn:hover:not(:disabled) {
    border-color: var(--accent-color);
    color: var(--accent-color);
}

.secondary-btn:disabled {
    opacity: 0.6;
    cursor: default;
}
</style>
