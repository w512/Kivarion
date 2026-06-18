<template>
    <BaseModal
        :show="show"
        width="340px"
        labelledby="confirm-modal-title"
        @close="$emit('cancel')"
    >
        <div class="confirm-modal">
            <div class="modal-icon" :class="`modal-icon--${confirmVariant}`">
                <slot name="icon">
                    <svg
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14H6L5 6" />
                        <path d="M10 11v6" />
                        <path d="M14 11v6" />
                        <path d="M9 6V4h6v2" />
                    </svg>
                </slot>
            </div>
            <h3 id="confirm-modal-title">{{ title }}</h3>
            <p>{{ message }}</p>
            <div class="modal-actions">
                <button
                    class="confirm-btn"
                    :class="`confirm-btn--${confirmVariant}`"
                    @click="$emit('confirm')"
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

defineProps({
    show: { type: Boolean, default: false },
    title: { type: String, default: 'Are you sure?' },
    message: { type: String, default: 'This action cannot be undone.' },
    confirmText: { type: String, default: 'Delete' },
    cancelText: { type: String, default: 'Cancel' },
    confirmVariant: {
        type: String,
        default: 'danger',
        validator: (v) => ['danger', 'primary'].includes(v),
    },
});

defineEmits(['confirm', 'cancel']);
</script>

<style scoped>
.confirm-modal {
    text-align: center;
}

.modal-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    border-radius: 12px;
    margin-bottom: 0.75rem;
}

.modal-icon--danger {
    background: rgba(239, 68, 68, 0.12);
    color: var(--error-color);
}

.modal-icon--primary {
    background: rgba(99, 102, 241, 0.12);
    color: var(--accent-color);
}

.confirm-modal h3 {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0 0 0.5rem;
}

.confirm-modal p {
    font-size: 0.85rem;
    color: var(--text-secondary);
    margin: 0 0 1.25rem;
    line-height: 1.4;
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
    color: #fff;
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
    transition: all 0.15s;
    box-shadow: none;
}

.confirm-btn--danger {
    background: var(--error-color);
}

.confirm-btn--danger:hover {
    background: #dc2626;
}

.confirm-btn--primary {
    background: var(--accent-color);
}

.confirm-btn--primary:hover {
    background: var(--accent-hover);
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
