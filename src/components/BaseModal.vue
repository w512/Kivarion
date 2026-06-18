<template>
    <Teleport to="body">
        <div
            v-if="show"
            ref="overlayRef"
            class="base-modal-overlay"
            :style="{ zIndex }"
            @click="onBackdrop"
            @keydown="onKeydown"
        >
            <div
                ref="cardRef"
                class="base-modal-card"
                :style="cardStyle"
                role="dialog"
                aria-modal="true"
                :aria-labelledby="labelledby || undefined"
                :aria-label="labelledby ? undefined : ariaLabel || undefined"
                tabindex="-1"
                @click.stop
            >
                <slot />
            </div>
        </div>
    </Teleport>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue';

const props = defineProps({
    show: { type: Boolean, default: false },
    // id of the element (usually the heading) that labels the dialog.
    labelledby: { type: String, default: '' },
    // Fallback accessible name when there is no visible heading to reference.
    ariaLabel: { type: String, default: '' },
    closeOnBackdrop: { type: Boolean, default: true },
    closeOnEsc: { type: Boolean, default: true },
    // CSS width for the card (e.g. '340px'); omit to use the component default.
    width: { type: String, default: '' },
    zIndex: { type: Number, default: 100 },
});

const emit = defineEmits(['close']);

const overlayRef = ref(null);
const cardRef = ref(null);
let previouslyFocused = null;

const cardStyle = computed(() => (props.width ? { width: props.width } : {}));

const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusable() {
    if (!cardRef.value) return [];
    return Array.from(
        cardRef.value.querySelectorAll(FOCUSABLE_SELECTOR),
    ).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

function onBackdrop() {
    if (props.closeOnBackdrop) emit('close');
}

function onKeydown(e) {
    if (e.key === 'Escape' && props.closeOnEsc) {
        e.stopPropagation();
        emit('close');
        return;
    }
    if (e.key === 'Tab') trapTab(e);
}

// Keep keyboard focus within the dialog while it is open.
function trapTab(e) {
    const focusable = getFocusable();
    if (focusable.length === 0) {
        e.preventDefault();
        return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    const card = cardRef.value;

    if (e.shiftKey) {
        if (active === first || active === card || !card.contains(active)) {
            e.preventDefault();
            last.focus();
        }
    } else if (active === last || !card.contains(active)) {
        e.preventDefault();
        first.focus();
    }
}

watch(
    () => props.show,
    (isShowing) => {
        if (isShowing) {
            previouslyFocused = document.activeElement;
            nextTick(() => {
                // Honor an explicit [autofocus] target, otherwise focus the
                // dialog itself (avoids landing on a destructive button).
                const autofocusEl = cardRef.value?.querySelector('[autofocus]');
                (autofocusEl || cardRef.value)?.focus();
            });
        } else {
            restoreFocus();
        }
    },
);

function restoreFocus() {
    if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
    }
    previouslyFocused = null;
}
</script>

<style scoped>
.base-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
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

.base-modal-card {
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: 14px;
    padding: 1.5rem;
    max-width: calc(100vw - 2rem);
    max-height: calc(100vh - 2rem);
    overflow-y: auto;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.3);
    animation: modalPop 0.2s ease;
    outline: none;
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
</style>
