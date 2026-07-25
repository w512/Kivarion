<script setup>
import { computed } from 'vue';
import { estimatePasswordEntropy, passwordStrengthLabel } from '../utils.js';

const props = defineProps({
    password: { type: String, default: '' },
});

const entropy = computed(() =>
    estimatePasswordEntropy({ password: props.password }),
);
const strength = computed(() => passwordStrengthLabel(entropy.value));
const percentage = computed(() =>
    Math.min(100, Math.round((entropy.value / 120) * 100)),
);
</script>

<template>
    <div
        class="password-strength"
        role="meter"
        aria-label="Password strength"
        :aria-valuenow="Math.round(entropy)"
        aria-valuemin="0"
        aria-valuemax="120"
        :aria-valuetext="strength"
    >
        <div class="strength-bar">
            <div
                class="strength-fill"
                :class="strength.toLowerCase()"
                :style="{ width: percentage + '%' }"
            ></div>
        </div>
        <span>{{ strength }}</span>
    </div>
</template>

<style scoped>
.password-strength {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    color: var(--text-secondary);
    font-size: 0.78rem;
}

.strength-bar {
    flex: 1;
    height: 6px;
    border-radius: 999px;
    background: var(--border-color);
    overflow: hidden;
}

.strength-fill {
    height: 100%;
    /* A very weak password must still show a sliver, not an empty track. */
    min-width: 4px;
    border-radius: inherit;
    background: var(--error-color);
    transition: width 0.2s;
}

.strength-fill.fair,
.strength-fill.good {
    background: #f59e0b;
}

.strength-fill.strong,
.strength-fill.excellent {
    background: #22c55e;
}
</style>
