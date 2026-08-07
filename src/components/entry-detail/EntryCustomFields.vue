<template>
    <div class="custom-fields-wrapper">
        <!-- View Mode -->
        <div
            v-if="!isEditing && fields.length > 0"
            class="custom-fields-section"
        >
            <div class="section-header">
                <h3>Custom Fields</h3>
            </div>
            <div class="fields-view">
                <div v-for="field in fields" :key="field.key" class="field-row">
                    <label>{{ field.key }}</label>
                    <div class="field-value-row">
                        <div class="field-value">
                            <ColoredPassword
                                v-if="
                                    field.protected &&
                                    isProtectedFieldVisible(field.key)
                                "
                                :value="field.value"
                            />
                            <template v-else>{{
                                field.protected
                                    ? maskedValue(field.value)
                                    : field.value
                            }}</template>
                        </div>
                        <div class="field-actions">
                            <button
                                v-if="field.protected"
                                class="toggle-btn"
                                :title="
                                    isProtectedFieldVisible(field.key)
                                        ? 'Hide'
                                        : 'Show'
                                "
                                @click="toggleProtectedField(field.key)"
                            >
                                <svg
                                    v-if="!isProtectedFieldVisible(field.key)"
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                >
                                    <path
                                        d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"
                                    />
                                    <circle cx="12" cy="12" r="3" />
                                </svg>
                                <svg
                                    v-else
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                >
                                    <path
                                        d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"
                                    />
                                    <path
                                        d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"
                                    />
                                    <line x1="1" y1="1" x2="23" y2="23" />
                                </svg>
                            </button>
                            <transition name="mini-toast">
                                <div
                                    v-if="activeCopyField === field.key"
                                    class="mini-toast"
                                >
                                    Copied!
                                </div>
                            </transition>
                            <button
                                class="copy-btn"
                                title="Copy"
                                @click="
                                    copy(
                                        field.value,
                                        field.key,
                                        field.protected,
                                    )
                                "
                            >
                                <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                >
                                    <rect
                                        x="9"
                                        y="9"
                                        width="13"
                                        height="13"
                                        rx="2"
                                        ry="2"
                                    />
                                    <path
                                        d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
                                    />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Edit Mode -->
        <div v-if="isEditing" class="custom-fields-edit-section">
            <div class="section-header">
                <h3>Custom Fields</h3>
                <button type="button" class="add-field-btn" @click="addField">
                    <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    Add
                </button>
            </div>

            <div v-if="modelValue.length === 0" class="no-custom-fields">
                No custom fields
            </div>

            <div
                v-for="(field, index) in modelValue"
                :key="index"
                class="custom-field-edit-row"
            >
                <input
                    v-model="field.key"
                    type="text"
                    class="field-input field-key"
                    :class="{ 'field-input--missing': isKeyMissing(field) }"
                    placeholder="Name"
                    :title="
                        isKeyMissing(field)
                            ? 'A field without a name is discarded when the entry is saved'
                            : ''
                    "
                />
                <input
                    v-model="field.value"
                    :type="field.protected ? 'password' : 'text'"
                    class="field-input field-value-input"
                    placeholder="Value"
                />
                <label
                    class="protected-toggle"
                    :class="{ 'protected-toggle--on': field.protected }"
                    :title="
                        field.protected
                            ? 'Protected: stored as a protected KeePass value'
                            : 'Not protected: click to store this field as a protected KeePass value'
                    "
                >
                    <input v-model="field.protected" type="checkbox" />
                    <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                    >
                        <rect x="3" y="11" width="18" height="11" rx="2" />
                        <path
                            v-if="field.protected"
                            d="M7 11V7a5 5 0 0 1 10 0v4"
                        />
                        <path v-else d="M7 11V7a5 5 0 0 1 9.9-1" />
                    </svg>
                    <!-- The pill is icon-only; the label still names the
                         checkbox for screen readers. -->
                    <span class="visually-hidden">Protected</span>
                </label>
                <button
                    type="button"
                    class="remove-field-btn"
                    title="Remove field"
                    @click="removeField(index)"
                >
                    <svg
                        width="14"
                        height="14"
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
        </div>
    </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { useClipboard } from '../../composables/useClipboard';
import ColoredPassword from './ColoredPassword.vue';

const props = defineProps({
    isEditing: { type: Boolean, default: false },
    fields: { type: Array, default: () => [] }, // For view mode
    modelValue: { type: Array, default: () => [] }, // For edit mode
});

const emit = defineEmits(['update:modelValue']);

const { activeCopyField, copy: copyToClipboard } = useClipboard();
const visibleProtectedFields = ref({});

watch(
    () => props.fields.map((field) => field.key).join('\0'),
    () => {
        visibleProtectedFields.value = {};
    },
);

function addField() {
    const newFields = [
        ...props.modelValue,
        { key: '', value: '', protected: false },
    ];
    emit('update:modelValue', newFields);
}

// A row with a value but no name is dropped by the form's validation on save,
// which is invisible until the entry comes back without it.
function isKeyMissing(field) {
    return !(field.key || '').trim() && !!(field.value || '').trim();
}

function removeField(index) {
    const newFields = [...props.modelValue];
    newFields.splice(index, 1);
    emit('update:modelValue', newFields);
}

function maskedValue(value) {
    const length = Math.min((value || '').length || 8, 20);
    return '•'.repeat(length);
}

function isProtectedFieldVisible(key) {
    return !!visibleProtectedFields.value[key];
}

function toggleProtectedField(key) {
    visibleProtectedFields.value = {
        ...visibleProtectedFields.value,
        [key]: !visibleProtectedFields.value[key],
    };
}

function copy(text, fieldId, isProtected = false) {
    return copyToClipboard(text, fieldId, { autoClear: isProtected });
}
</script>

<style scoped>
.custom-fields-section {
    margin-top: 1.5rem;
    border-top: 1px solid var(--border-color);
    padding-top: 1rem;
}

.section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
}

.section-header h3 {
    font-size: 0.8rem;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0;
}

.fields-view {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.field-row {
    background: var(--badge-bg);
    border-radius: 8px;
    padding: 0.6rem 0.75rem;
}

.field-row label {
    display: block;
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.25rem;
}

.field-value-row {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
}

.field-value {
    font-size: 0.9rem;
    color: var(--text-primary);
    word-break: break-all;
    flex: 1;
}

.field-actions {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-shrink: 0;
}

.copy-btn,
.toggle-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.25rem;
    border: none;
    background: none;
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.15s;
}

.copy-btn:hover,
.toggle-btn:hover {
    color: var(--accent-color);
    background: rgba(99, 102, 241, 0.1);
}

/* Edit Mode Styles */
.custom-fields-edit-section {
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border-color);
}

.add-field-btn {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.6rem;
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    color: var(--text-secondary);
    font-size: 0.75rem;
    cursor: pointer;
    transition: all 0.2s;
}

.add-field-btn:hover {
    color: var(--accent-color);
    border-color: var(--accent-color);
    background: rgba(99, 102, 241, 0.05);
}

.no-custom-fields {
    text-align: center;
    padding: 1rem;
    color: var(--text-secondary);
    font-size: 0.85rem;
    background: var(--badge-bg);
    border-radius: 8px;
}

/* One row is one field: name, value and the two controls stay on a single line
   at any column width — the inputs shrink (flex-basis 0, min-width 0) instead
   of pushing the controls onto a second line. */
.custom-field-edit-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.5rem;
}

.field-input {
    height: 36px;
    min-width: 0;
    padding: 0 0.7rem;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: var(--input-bg);
    color: var(--text-primary);
    font-family: inherit;
    font-size: 0.85rem;
    outline: none;
    transition:
        border-color 0.2s,
        box-shadow 0.2s;
}

.field-input:focus {
    border-color: var(--accent-color);
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12);
}

.field-key {
    flex: 1 1 0;
}

.field-value-input {
    flex: 2 1 0;
}

/* The form discards a nameless field on save; say so before it happens. */
.field-input--missing,
.field-input--missing:focus {
    border-color: var(--error-color);
}

.field-input--missing:focus {
    box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.12);
}

.protected-toggle {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--card-bg);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s;
}

.visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
}

.protected-toggle:hover {
    border-color: var(--accent-color);
    color: var(--accent-color);
}

.protected-toggle--on {
    border-color: var(--accent-color);
    background: rgba(99, 102, 241, 0.1);
    color: var(--accent-color);
}

/* The checkbox stays in the DOM for keyboard use and screen readers; the pill
   itself is the visual state. */
.protected-toggle input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
}

.protected-toggle:focus-within {
    border-color: var(--accent-color);
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12);
}

.remove-field-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    color: var(--text-secondary);
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
    border-radius: 8px;
    transition: all 0.15s;
}

.remove-field-btn:hover {
    color: var(--error-color);
    background: rgba(239, 68, 68, 0.1);
}

.mini-toast {
    position: absolute;
    top: -1.75rem;
    right: 0;
    background: var(--accent-color);
    color: white;
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
    font-size: 0.65rem;
    font-weight: 700;
    white-space: nowrap;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    pointer-events: none;
    z-index: 100;
}

.mini-toast::after {
    content: '';
    position: absolute;
    bottom: -3px;
    right: 8px;
    border-left: 4px solid transparent;
    border-right: 4px solid transparent;
    border-top: 4px solid var(--accent-color);
}

.mini-toast-enter-active,
.mini-toast-leave-active {
    transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.mini-toast-enter-from,
.mini-toast-leave-to {
    opacity: 0;
    transform: translateY(5px) scale(0.8);
}
</style>
