<template>
    <Teleport to="body">
        <div
            v-if="show"
            class="modal-overlay"
            @click="$emit('cancel')"
        >
            <div class="modal-card" @click.stop>
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
                <h3>{{ title }}</h3>
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
        </div>
    </Teleport>
</template>

<script setup>
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

.modal-card h3 {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0 0 0.5rem;
}

.modal-card p {
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