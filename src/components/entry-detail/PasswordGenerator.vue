<template>
    <BaseModal
        :show="show"
        width="550px"
        :z-index="2000"
        labelledby="pg-title"
        @close="close"
    >
        <div class="pg-content">
            <div class="modal-header">
                <h3 id="pg-title">Password Generator</h3>
                <button class="close-btn" aria-label="Close" @click="close">
                    ✕
                </button>
            </div>

            <div class="preview-area">
                <div class="generated-password">{{ currentPassword }}</div>
                <button
                    class="refresh-btn"
                    title="Regenerate"
                    @click.stop="regenerate"
                >
                    <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <path
                            d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"
                        />
                    </svg>
                </button>
            </div>

            <div class="strength-area" :class="strengthClass">
                <div class="strength-header">
                    <span>{{ strengthLabel }}</span>
                    <span>{{ entropyBits }} bits</span>
                </div>
                <div class="strength-track">
                    <div
                        class="strength-fill"
                        :style="{ width: strengthPercent + '%' }"
                    ></div>
                </div>
            </div>

            <div class="options-area">
                <div class="option-row">
                    <div class="option-label">
                        <label>Length</label>
                        <span class="length-value">{{ options.length }}</span>
                    </div>
                    <input
                        v-model.number="options.length"
                        type="range"
                        min="4"
                        max="64"
                        step="1"
                        @input="regenerate"
                    />
                </div>

                <div class="checkbox-grid">
                    <label class="checkbox-item">
                        <input
                            v-model="options.upper"
                            type="checkbox"
                            @change="regenerate"
                        />
                        <span>A-Z</span>
                    </label>
                    <label class="checkbox-item">
                        <input
                            v-model="options.lower"
                            type="checkbox"
                            @change="regenerate"
                        />
                        <span>a-z</span>
                    </label>
                    <label class="checkbox-item">
                        <input
                            v-model="options.numbers"
                            type="checkbox"
                            @change="regenerate"
                        />
                        <span>0-9</span>
                    </label>
                    <label class="checkbox-item">
                        <input
                            v-model="options.symbols"
                            type="checkbox"
                            @change="regenerate"
                        />
                        <span>!@#</span>
                    </label>
                </div>

                <label class="checkbox-item exclude-similar">
                    <input
                        v-model="options.excludeSimilar"
                        type="checkbox"
                        @change="regenerate"
                    />
                    <span>Exclude similar characters (l, 1, O, 0)</span>
                </label>
            </div>

            <div class="modal-footer">
                <button
                    class="apply-btn"
                    :disabled="!currentPassword"
                    @click="apply"
                >
                    Use Password
                </button>
                <button class="cancel-btn" @click="close">Cancel</button>
            </div>
        </div>
    </BaseModal>
</template>

<script setup>
import { computed, ref, reactive, watch } from 'vue';
import BaseModal from '../BaseModal.vue';
import {
    estimatePasswordEntropy,
    generatePassword,
    passwordStrengthLabel,
} from '../../utils';

const props = defineProps({
    show: Boolean,
});

const emit = defineEmits(['close', 'apply']);

const SETTINGS_KEY = 'kivarion-password-generator-options';
const DEFAULT_OPTIONS = {
    length: 20,
    upper: true,
    lower: true,
    numbers: true,
    symbols: true,
    excludeSimilar: true,
};

function loadOptions() {
    try {
        const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
        return {
            ...DEFAULT_OPTIONS,
            ...saved,
            length: Math.min(
                64,
                Math.max(4, Number(saved.length) || DEFAULT_OPTIONS.length),
            ),
            upper:
                typeof saved.upper === 'boolean'
                    ? saved.upper
                    : DEFAULT_OPTIONS.upper,
            lower:
                typeof saved.lower === 'boolean'
                    ? saved.lower
                    : DEFAULT_OPTIONS.lower,
            numbers:
                typeof saved.numbers === 'boolean'
                    ? saved.numbers
                    : DEFAULT_OPTIONS.numbers,
            symbols:
                typeof saved.symbols === 'boolean'
                    ? saved.symbols
                    : DEFAULT_OPTIONS.symbols,
            excludeSimilar:
                typeof saved.excludeSimilar === 'boolean'
                    ? saved.excludeSimilar
                    : DEFAULT_OPTIONS.excludeSimilar,
        };
    } catch {
        return { ...DEFAULT_OPTIONS };
    }
}

const options = reactive(loadOptions());

const currentPassword = ref('');

const entropy = computed(() => estimatePasswordEntropy(options));
const entropyBits = computed(() => Math.round(entropy.value));
const strengthLabel = computed(() => passwordStrengthLabel(entropy.value));
const strengthPercent = computed(() =>
    Math.min(100, Math.round((entropy.value / 120) * 100)),
);
const strengthClass = computed(
    () => `strength-${strengthLabel.value.toLowerCase()}`,
);

const regenerate = () => {
    currentPassword.value = generatePassword(options);
};

const close = () => {
    emit('close');
};

const apply = () => {
    emit('apply', currentPassword.value);
    close();
};

watch(
    options,
    () => {
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...options }));
        } catch {}
    },
    { deep: true },
);

// Initialize on show
watch(
    () => props.show,
    (newVal) => {
        if (newVal) regenerate();
    },
);
</script>

<style scoped>
.pg-content {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
}

.modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.modal-header h3 {
    font-size: 1.1rem;
    font-weight: 700;
    margin: 0;
    color: var(--text-primary);
}

.close-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 1rem;
    opacity: 0.6;
    transition: opacity 0.2s;
}

.close-btn:hover {
    opacity: 1;
}

.preview-area {
    background: var(--input-bg);
    border: 1px solid var(--border-color);
    border-radius: 10px;
    padding: 1rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
}

.generated-password {
    flex: 1;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 1.1rem;
    color: var(--accent-color);
    word-break: break-all;
    user-select: all;
    min-height: 1.4em;
}

.refresh-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    display: flex;
    padding: 6px;
    transition:
        color 0.2s,
        transform 0.2s;
}

.refresh-btn:hover {
    color: var(--accent-color);
    transform: rotate(30deg);
}

.strength-area {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
}

.strength-header {
    display: flex;
    justify-content: space-between;
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--text-secondary);
}

.strength-track {
    height: 7px;
    background: var(--badge-bg);
    border-radius: 999px;
    overflow: hidden;
}

.strength-fill {
    height: 100%;
    border-radius: 999px;
    transition:
        width 0.2s ease,
        background 0.2s ease;
}

.strength-weak .strength-fill {
    background: #ef4444;
}
.strength-fair .strength-fill {
    background: #f97316;
}
.strength-good .strength-fill {
    background: #eab308;
}
.strength-strong .strength-fill {
    background: #22c55e;
}
.strength-excellent .strength-fill {
    background: var(--accent-color);
}

.options-area {
    display: flex;
    flex-direction: column;
    gap: 1rem;
}

.option-row {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.option-label {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.option-label label {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-secondary);
}

.length-value {
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--accent-color);
    background: rgba(99, 102, 241, 0.1);
    padding: 2px 8px;
    border-radius: 6px;
}

input[type='range'] {
    width: 100%;
    accent-color: var(--accent-color);
}

.checkbox-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
}

.checkbox-item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.9rem;
    color: var(--text-primary);
    cursor: pointer;
}

.checkbox-item input {
    accent-color: var(--accent-color);
    width: 16px;
    height: 16px;
}

.exclude-similar {
    margin-top: 0.25rem;
    font-size: 0.85rem;
    color: var(--text-secondary);
}

.modal-footer {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.5rem;
}

.apply-btn {
    width: 100%;
    padding: 0.75rem;
    background: var(--accent-color);
    color: white;
    border: none;
    border-radius: 10px;
    font-weight: 700;
    font-size: 0.9rem;
    cursor: pointer;
    transition:
        background 0.2s,
        transform 0.1s;
}

.apply-btn:hover:not(:disabled) {
    background: var(--accent-hover);
}

.apply-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
}

.apply-btn:active:not(:disabled) {
    transform: scale(0.98);
}

.cancel-btn {
    width: 100%;
    padding: 0.75rem;
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
    border-radius: 10px;
    font-weight: 600;
    font-size: 0.9rem;
    cursor: pointer;
    transition: all 0.2s;
}

.cancel-btn:hover {
    border-color: var(--text-secondary);
    color: var(--text-primary);
}
</style>
