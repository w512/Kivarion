<script setup>
import { useRouter } from 'vue-router';
import { useStore } from '../store.js';

const router = useRouter();
const store = useStore();

function goBack() {
    router.back();
}
</script>

<template>
    <div class="settings-page">
        <header class="settings-header">
            <button class="back-btn" @click="goBack" title="Go back">
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
                    <line x1="19" y1="12" x2="5" y2="12"></line>
                    <polyline points="12 19 5 12 12 5"></polyline>
                </svg>
            </button>
            <h1>Settings</h1>
        </header>
        <div class="settings-content">
            <div class="setting-item">
                <div class="setting-info">
                    <h3>Theme</h3>
                    <p>Select your interface appearance preference</p>
                </div>
                <div class="setting-action">
                    <select v-model="store.theme" class="select-input">
                        <option value="system">System</option>
                        <option value="light">Light</option>
                        <option value="dark">Dark</option>
                    </select>
                </div>
            </div>

            <div class="setting-item">
                <div class="setting-info">
                    <h3>Clipboard Timeout</h3>
                    <p>Automatically clear clipboard after (seconds, 0 to disable)</p>
                </div>
                <div class="setting-action">
                    <input type="number" v-model.number="store.clipboardTimeout" min="0" max="600" class="number-input">
                </div>
            </div>

            <div class="setting-item">
                <div class="setting-info">
                    <h3>Auto-Lock Timeout</h3>
                    <p>Lock database after inactivity (minutes, 0 to disable)</p>
                </div>
                <div class="setting-action">
                    <input type="number" v-model.number="store.autoLockTimeout" min="0" max="1440" class="number-input">
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.settings-page {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg-color, #0f1117);
    color: var(--text-primary, #e4e4e7);
}

.settings-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid var(--border-color, #2a2b35);
    background: var(--card-bg, #1a1b23);
}

.settings-header h1 {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0;
}

.back-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.5rem;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: var(--text-secondary, #71717a);
    cursor: pointer;
    transition: all 0.2s;
}

.back-btn:hover {
    background: var(--border-color);
    color: var(--text-primary);
}

.settings-content {
    padding: 2rem 1.5rem;
    flex: 1;
    overflow-y: auto;
}

.setting-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.5rem;
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    margin-bottom: 1rem;
}

.setting-info h3 {
    margin: 0 0 0.25rem 0;
    font-size: 1rem;
    font-weight: 500;
    color: var(--text-primary);
}

.setting-info p {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
}

.select-input,
.number-input {
    padding: 0.5rem 1rem;
    font-size: 0.875rem;
    background-color: var(--input-bg);
    color: var(--text-primary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    outline: none;
    transition: border-color 0.2s;
}

.select-input {
    padding-right: 2rem;
    cursor: pointer;
    appearance: none;
    background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
    background-repeat: no-repeat;
    background-position: right 0.5rem center;
    background-size: 1em;
}

.number-input {
    width: 80px;
    text-align: center;
}

.select-input:focus,
.number-input:focus {
    border-color: var(--accent-color);
}
</style>
