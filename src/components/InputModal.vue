<template>
    <BaseModal
        :show="show"
        width="340px"
        labelledby="input-modal-title"
        @close="$emit('cancel')"
    >
        <div class="input-modal">
            <h3 id="input-modal-title">{{ title }}</h3>
            <div class="modal-input-wrapper">
                <input
                    :value="modelValue"
                    :placeholder="placeholder"
                    class="modal-input"
                    :class="{ 'modal-input--error': error }"
                    autofocus
                    @input="$emit('update:modelValue', $event.target.value)"
                    @keyup.enter="confirm"
                />
                <p v-if="error" class="modal-error">{{ error }}</p>
            </div>
            <div class="modal-actions">
                <button
                    class="confirm-btn"
                    :disabled="confirmDisabled"
                    @click="confirm"
                >
                    {{ confirmText }}
                </button>
                <button class="cancel-btn" @click="$emit('cancel')">
                    {{ cancelText }}
                </button>
            </div>
        </div>
    </BaseModal>
</template>

<script setup>
import BaseModal from './BaseModal.vue';

const props = defineProps({
    show: { type: Boolean, default: false },
    title: { type: String, default: '' },
    modelValue: { type: String, default: '' },
    placeholder: { type: String, default: '' },
    confirmText: { type: String, default: 'Save' },
    cancelText: { type: String, default: 'Cancel' },
    error: { type: String, default: '' },
    confirmDisabled: { type: Boolean, default: false },
});

const emit = defineEmits(['update:modelValue', 'confirm', 'cancel']);

function confirm() {
    if (!props.confirmDisabled) emit('confirm');
}
</script>

<style scoped>
.input-modal {
    text-align: center;
}

.input-modal h3 {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0 0 1rem;
}

.modal-input-wrapper {
    margin-bottom: 1.5rem;
}

.modal-input {
    width: 100%;
    padding: 0.6rem 0.75rem;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: var(--input-bg);
    color: var(--text-primary);
    font-size: 0.9rem;
    outline: none;
    transition: border-color 0.2s;
    box-sizing: border-box;
}

.modal-input:focus {
    border-color: var(--accent-color);
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12);
}

.modal-input--error,
.modal-input--error:focus {
    border-color: var(--error-color);
    box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.12);
}

.modal-error {
    margin-top: 0.5rem;
    color: var(--error-color);
    font-size: 0.78rem;
    line-height: 1.35;
    text-align: left;
}

.modal-actions {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
}

.confirm-btn {
    padding: 0.5rem 1.25rem;
    border-radius: 8px;
    border: none;
    background: var(--accent-color);
    color: #fff;
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
    transition: all 0.15s;
    box-shadow: none;
}

.confirm-btn:hover:not(:disabled) {
    background: var(--accent-hover);
}

.confirm-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.cancel-btn {
    padding: 0.5rem 1.25rem;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: var(--card-bg);
    color: var(--text-secondary);
    font-size: 0.85rem;
    cursor: pointer;
    transition: all 0.15s;
    box-shadow: none;
}

.cancel-btn:hover {
    border-color: var(--text-secondary);
    color: var(--text-primary);
}
</style>
