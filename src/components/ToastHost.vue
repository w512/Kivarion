<template>
    <div class="toast-host">
        <TransitionGroup name="toast">
            <div
                v-for="toast in toasts"
                :key="toast.id"
                class="toast"
                role="alert"
                @mouseenter="pauseToast(toast.id)"
                @mouseleave="resumeToast(toast.id)"
            >
                <CircleAlert :size="16" class="toast-icon" aria-hidden="true" />
                <span class="toast-message">{{ toast.message }}</span>
                <button
                    type="button"
                    class="toast-dismiss"
                    aria-label="Dismiss"
                    @click="dismissToast(toast.id)"
                >
                    <X :size="14" aria-hidden="true" />
                </button>
            </div>
        </TransitionGroup>
    </div>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue';
import { CircleAlert, X } from 'lucide-vue-next';
import {
    clearToasts,
    dismissToast,
    pauseToast,
    resumeToast,
    toasts,
} from '../toast.js';

// A message can name a custom field or an attachment of the database that was
// open, so none of them may survive a lock. Mounted once in `App.vue`, for the
// app's lifetime, so this listener sees every lock.
onMounted(() => window.addEventListener('kivarion:before-lock', clearToasts));
onUnmounted(() =>
    window.removeEventListener('kivarion:before-lock', clearToasts),
);
</script>

<style scoped>
.toast-host {
    position: fixed;
    top: 0.75rem;
    right: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    /* Above every dialog (2000): a toast reports what a dialog's own action
       just refused to do, so it has to be readable in front of it. */
    z-index: 3000;
    /* The stack sits over the app's own controls; only the toasts themselves
       may take a click. */
    pointer-events: none;
}

.toast {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    width: min(24rem, calc(100vw - 1.5rem));
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--border-color);
    border-left: 3px solid var(--error-color);
    border-radius: 8px;
    background: var(--card-bg);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    color: var(--text-primary);
    font-size: 0.8rem;
    line-height: 1.35;
    pointer-events: auto;
}

.toast-icon {
    flex-shrink: 0;
    margin-top: 1px;
    color: var(--error-color);
}

.toast-message {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
}

.toast-dismiss {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
}

.toast-dismiss:hover {
    background: var(--badge-bg);
    color: var(--text-primary);
}

.toast-enter-active,
.toast-leave-active,
.toast-move {
    transition: all 0.18s ease;
}

.toast-enter-from,
.toast-leave-to {
    opacity: 0;
    transform: translateX(12px);
}
</style>
