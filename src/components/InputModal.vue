<template>
    <Teleport to="body">
        <div
            v-if="show"
            class="modal-overlay"
            @click="$emit('cancel')"
        >
            <div class="modal-card" @click.stop>
                <h3>{{ title }}</h3>
                <div class="modal-input-wrapper">
                    <input
                        :value="modelValue"
                        @input="$emit('update:modelValue', $event.target.value)"
                        :placeholder="placeholder"
                        ref="inputRef"
                        @keyup.enter="confirm"
                        class="modal-input"
                        :class="{ 'modal-input--error': error }"
                        autofocus
                    />
                    <p v-if="error" class="modal-error">{{ error }}</p>
                </div>
                <div class="modal-actions">
                    <button class="confirm-btn" @click="confirm" :disabled="confirmDisabled">
                        {{ confirmText }}
                    </button>
                    <button class="cancel-btn" @click="$emit('cancel')">
                        {{ cancelText }}
                    </button>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<script setup>
import { ref } from 'vue';

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

const inputRef = ref(null);
</script>

<style scoped>
.modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    animation: fadeIn 0.15s ease;
}

@keyframes fadeIn {
    from {
        opacity: 0;
    }
    to {
        opacity: 1;
    }
}

.modal-card {
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: 14px;
    padding: 1.5rem;
    width: 340px;
    text-align: center;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.3);
    animation: modalPop 0.2s ease;
}

@keyframes modalPop {
    from {
        opacity: 0;
        transform: scale(0.95);
    }
    to {
        opacity: 1;
        transform: scale(1);
    }
}

.modal-card h3 {
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