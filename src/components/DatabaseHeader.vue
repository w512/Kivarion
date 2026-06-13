<template>
    <header class="page-header">
        <div class="header-left">
            <svg
                width="22"
                height="22"
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
            <div>
                <h1>{{ dbName }}</h1>
                <span class="file-name">{{ filePath }}</span>
            </div>
        </div>
        <div class="header-actions">
            <div class="search-box">
                <svg
                    class="search-icon"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                    type="text"
                    class="search-input"
                    v-model="search"
                    placeholder="Search entries"
                    spellcheck="false"
                />
                <button
                    v-if="search"
                    class="search-clear"
                    @click="search = ''"
                    title="Clear search"
                    aria-label="Clear search"
                >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                </button>
            </div>
            <button
                class="icon-btn settings-btn"
                @click="$router.push({ name: 'settings' })"
                title="Settings"
            >
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
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
            </button>
            <button
                class="icon-btn edit-btn"
                @click="$emit('edit-db')"
                title="Edit database settings"
            >
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
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
            </button>
            <button
                class="icon-btn lock-btn"
                @click="$emit('lock')"
                title="Lock database"
            >
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
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
            </button>
            <button 
                class="icon-btn close-btn" 
                @click="$emit('close')"
                title="Close database"
            >
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
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
            </button>
        </div>
    </header>
</template>

<script setup>
defineProps({
    dbName: { type: String, default: 'Unnamed' },
    filePath: { type: String, default: '' },
});

defineEmits(['lock', 'close', 'edit-db']);

const search = defineModel('search', { type: String, default: '' });
</script>

<style scoped>
.page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.75rem 0.5rem 1.25rem;
    border-bottom: 1px solid var(--border-color);
    background: var(--card-bg);
    flex-shrink: 0;
}

.header-left {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    color: var(--accent-color);
}

.header-left h1 {
    font-size: 1.1rem;
    font-weight: 700;
    margin: 0;
    color: var(--text-primary);
}

.file-name {
    font-size: 0.7rem;
    color: var(--text-secondary);
}

.header-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.search-box {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0 0.5rem;
    height: 30px;
    border-radius: 6px;
    border: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-secondary);
    transition: border-color 0.15s;
}

.search-box:focus-within {
    border-color: var(--accent-color);
    color: var(--accent-color);
}

.search-icon {
    flex-shrink: 0;
}

.search-input {
    border: none;
    background: transparent;
    outline: none;
    color: var(--text-primary);
    font-size: 0.8rem;
    width: 150px;
    padding: 0;
}

.search-input::placeholder {
    color: var(--text-secondary);
}

.search-clear {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.15rem;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: 4px;
    flex-shrink: 0;
}

.search-clear:hover {
    color: var(--text-primary);
}

.icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.45rem;
    border-radius: 6px;
    border: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s;
    box-shadow: none;
}

.settings-btn:hover {
    border-color: var(--accent-color);
    color: var(--accent-color);
}

.edit-btn:hover {
    border-color: var(--accent-color);
    color: var(--accent-color);
}

.lock-btn:hover {
    border-color: var(--accent-color);
    color: var(--accent-color);
}

.close-btn:hover {
    border-color: var(--error-color);
    color: var(--error-color);
}
</style>