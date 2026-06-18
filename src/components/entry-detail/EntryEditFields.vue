<template>
    <div class="fields-edit">
        <div class="form-group">
            <label>Title</label>
            <input
                v-model="modelValue.Title"
                placeholder="Entry title"
                autofocus
            />
        </div>

        <div class="form-group">
            <label>Username</label>
            <input v-model="modelValue.UserName" placeholder="Username" />
        </div>

        <div class="form-group">
            <label>Password</label>
            <div class="password-input-group">
                <input
                    v-model="modelValue.Password"
                    :type="showPassword ? 'text' : 'password'"
                    placeholder="Password"
                />

                <button
                    type="button"
                    class="toggle-btn"
                    :title="showPassword ? 'Hide' : 'Show'"
                    @click="showPassword = !showPassword"
                >
                    <svg
                        v-if="!showPassword"
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

                <div class="generator-container">
                    <button
                        type="button"
                        class="toggle-btn"
                        title="Generate password"
                        @click="showGenerator = true"
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
                                x="3"
                                y="11"
                                width="18"
                                height="11"
                                rx="2"
                                ry="2"
                            />
                            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                    </button>
                    <PasswordGenerator
                        :show="showGenerator"
                        @close="showGenerator = false"
                        @apply="
                            (p) => {
                                modelValue.Password = p;
                                showPassword = true;
                            }
                        "
                    />
                </div>
            </div>
        </div>

        <div class="form-group">
            <label>URL</label>
            <input v-model="modelValue.URL" placeholder="https://example.com" />
        </div>

        <div class="form-group">
            <label>Notes</label>
            <textarea
                v-model="modelValue.Notes"
                placeholder="Additional information"
                rows="3"
            ></textarea>
        </div>
    </div>
</template>

<script setup>
import { ref } from 'vue';
import PasswordGenerator from './PasswordGenerator.vue';

defineProps({
    modelValue: { type: Object, required: true },
});

const showPassword = ref(false);
const showGenerator = ref(false);
</script>

<style scoped>
.fields-edit {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.form-group {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
}

.form-group label {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

.form-group input,
.form-group textarea {
    padding: 0.6rem 0.75rem;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: var(--input-bg);
    color: var(--text-primary);
    font-size: 0.9rem;
    font-family: inherit;
    outline: none;
    transition: border-color 0.2s;
    resize: vertical;
}

.form-group input:focus,
.form-group textarea:focus {
    border-color: var(--accent-color);
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12);
}

.password-input-group {
    display: flex;
    gap: 0.3rem;
    align-items: center;
}

.password-input-group input {
    flex: 1;
}

.password-input-group .toggle-btn {
    padding: 0.5rem;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--card-bg);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--text-secondary);
}

.password-input-group .toggle-btn:hover {
    color: var(--accent-color);
    background: rgba(99, 102, 241, 0.1);
}

.generator-container {
    display: flex;
}
</style>
