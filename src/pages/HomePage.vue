<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useDatabaseAuth } from '../composables/useDatabaseAuth.js';

const router = useRouter();
const passwordInput = ref(null);
const showPassword = ref(false);

const {
    fileName,
    password,
    isLoading,
    errorMessage,
    step,
    checkLastPath,
    selectFile,
    resetFile,
    decrypt,
    useBiometrics,
    isBiometricsSupported,
    attemptBiometricUnlock,
    store
} = useDatabaseAuth(router, passwordInput);

onMounted(() => {
    checkLastPath();
});
</script>


<template>
    <div class="home-page">
        <button class="settings-btn-home" @click="router.push({ name: 'settings' })" title="Settings">
            <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
            >
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
        </button>

        <div class="card">
            <div class="icon-header">
                <svg
                    width="48"
                    height="48"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    <circle cx="12" cy="16" r="1" />
                </svg>
            </div>

            <h1>Kivarion</h1>
            <p class="subtitle">Open KeePass password database</p>

            <!-- Step 1: File Selection -->
            <div v-if="step === 1" class="step">
                <button class="file-select-btn" @click="selectFile">
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
                        <path
                            d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"
                        />
                        <polyline points="13 2 13 9 20 9" />
                    </svg>
                    <span>Select .kdbx file</span>
                </button>
            </div>

            <!-- Step 2: Password Input -->
            <div v-if="step === 2" class="step">
                <div class="file-badge">
                    <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <path
                            d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"
                        />
                        <polyline points="13 2 13 9 20 9" />
                    </svg>
                    <span>{{ fileName }}</span>
                    <button
                        class="badge-close"
                        @click="resetFile"
                        title="Select different file"
                    >
                        ✕
                    </button>
                </div>

                <form @submit.prevent="decrypt" class="password-form">
                    <div class="input-group">
                        <div class="password-wrapper">
                            <input
                                ref="passwordInput"
                                :type="showPassword ? 'text' : 'password'"
                                v-model="password"
                                placeholder="Enter master password"
                                autofocus
                                :disabled="isLoading"
                            />
                            <div class="input-actions">
                                <button 
                                    type="button" 
                                    class="action-btn toggle-password" 
                                    @click="showPassword = !showPassword"
                                    :title="showPassword ? 'Hide password' : 'Show password'"
                                >
                                    <svg v-if="showPassword" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                                        <line x1="1" y1="1" x2="23" y2="23"></line>
                                    </svg>
                                    <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                        <circle cx="12" cy="12" r="3"></circle>
                                    </svg>
                                </button>
                            </div>
                        </div>
                        <button
                            type="submit"
                            :disabled="isLoading || !password"
                        >
                            <span v-if="isLoading" class="spinner"></span>
                            <span v-else>Open</span>
                        </button>
                        <button
                            v-if="isBiometricsSupported && useBiometrics"
                            type="button"
                            class="biometric-submit-btn"
                            @click="attemptBiometricUnlock(store.filePath)"
                            title="Unlock with Touch ID"
                            :disabled="isLoading"
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"></path>
                                <path d="M14 13.12c0 2.38 0 6.38-1 8.88"></path>
                                <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"></path>
                                <path d="M2 12a10 10 0 0 1 18-6"></path>
                                <path d="M2 16h.01"></path>
                                <path d="M21.8 16c.2-2 .131-5.354 0-6"></path>
                                <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"></path>
                                <path d="M8.65 22c.21-.66.45-1.32.57-2"></path>
                                <path d="M9 6.8a6 6 0 0 1 9 5.2v2"></path>
                            </svg>
                        </button>
                    </div>
                    <div v-if="isBiometricsSupported" class="biometric-toggle">
                        <label>
                            <input type="checkbox" v-model="useBiometrics" />
                            <span>Unlock with Touch ID next time</span>
                        </label>
                    </div>
                </form>

                <p v-if="errorMessage" class="error-message">
                    {{ errorMessage }}
                </p>
            </div>
        </div>
    </div>
</template>

<style scoped>
.home-page {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 2rem;
    position: relative;
}

.settings-btn-home {
    position: absolute;
    top: 1.5rem;
    right: 1.5rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.6rem;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: var(--card-bg);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.settings-btn-home:hover {
    color: var(--accent-color);
    border-color: var(--accent-color);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.card {
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: 16px;
    padding: 2.5rem;
    width: 100%;
    max-width: 540px;
    text-align: center;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
}

.icon-header {
    color: var(--accent-color);
    margin-bottom: 0.5rem;
}

h1 {
    font-size: 1.75rem;
    font-weight: 700;
    margin: 0.5rem 0 0.25rem;
    letter-spacing: -0.02em;
}

.subtitle {
    color: var(--text-secondary);
    font-size: 0.9rem;
    margin: 0 0 1.5rem;
}

.step {
    animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
    from {
        opacity: 0;
        transform: translateY(8px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

/* File input */
.file-input-hidden {
    display: none;
}

.file-select-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.75rem 1.5rem;
    border-radius: 10px;
    border: none;
    background: var(--accent-color);
    color: #fff;
    font-weight: 600;
    font-size: 0.95rem;
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: 0 2px 8px rgba(99, 102, 241, 0.3);
}

.file-select-btn:hover {
    background: var(--accent-hover);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
}

/* File badge */
.file-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.75rem;
    border-radius: 8px;
    background: var(--badge-bg);
    color: var(--text-secondary);
    font-size: 0.85rem;
    margin-bottom: 1rem;
}

.badge-close {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 0 0.2rem;
    font-size: 0.8rem;
    opacity: 0.7;
    box-shadow: none;
}

.badge-close:hover {
    opacity: 1;
    color: var(--error-color);
}

/* Password form */
.password-form {
    margin-top: 0;
}

.input-group {
    display: flex;
    gap: 0.5rem;
}

.input-group input {
    width: 100%;
    padding: 0.7rem 2.8rem 0.7rem 1rem;
    border-radius: 10px;
    border: 1px solid var(--border-color);
    background: var(--input-bg);
    color: var(--text-primary);
    font-size: 0.95rem;
    outline: none;
    transition: border-color 0.2s;
}

.password-wrapper {
    position: relative;
    flex: 1;
}

.input-actions {
    position: absolute;
    right: 0.5rem;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    gap: 0.25rem;
}

.action-btn {
    background: none !important;
    border: none !important;
    color: var(--text-secondary) !important;
    padding: 0.5rem !important;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.6;
    transition: all 0.2s;
    box-shadow: none !important;
}

.action-btn:hover {
    opacity: 1;
    color: var(--accent-color) !important;
}

.biometric-btn {
    color: var(--accent-color) !important;
    opacity: 0.8;
}

.biometric-btn:hover {
    opacity: 1;
}

.input-group input:focus {
    border-color: var(--accent-color);
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
}

.input-group button {
    padding: 0.7rem 1.25rem;
    border-radius: 10px;
    border: none;
    background: var(--accent-color);
    color: #fff;
    font-weight: 600;
    font-size: 0.95rem;
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;
    box-shadow: none;
}

.input-group button:hover:not(:disabled) {
    background: var(--accent-hover);
}

.input-group button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.input-group .biometric-submit-btn {
    padding: 0;
    width: 3rem;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    color: var(--accent-color);
}

.input-group .biometric-submit-btn:hover:not(:disabled) {
    background: var(--input-bg);
    border-color: var(--accent-color);
}

/* Spinner */
.spinner {
    display: inline-block;
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
}

@keyframes spin {
    to {
        transform: rotate(360deg);
    }
}

/* Error */
.error-message {
    color: var(--error-color);
    font-size: 0.85rem;
    margin-top: 0.75rem;
    animation: fadeIn 0.3s ease;
}

.biometric-toggle {
    margin-top: 1rem;
    display: flex;
    justify-content: flex-start;
    padding: 0 0.5rem;
}

.biometric-toggle label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    color: var(--text-secondary);
    cursor: pointer;
}

.biometric-toggle input[type="checkbox"] {
    accent-color: var(--accent-color);
    cursor: pointer;
}
</style>
