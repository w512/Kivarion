<script setup>
import { onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useAutoLock } from './composables/useAutoLock.js';

useAutoLock();

// The backend holds Cmd+Q / menu quits (`ExitRequested` → prevent_exit) so an
// open database can flush its saves first. DatabasePage owns that flow; on
// every other route there is nothing to flush, so quit immediately — without
// this fallback a quit from HomePage or Settings would leave the app running.
const route = useRoute();
let unlistenQuitRequested = null;

onMounted(async () => {
    unlistenQuitRequested = await listen('kivarion:quit-requested', () => {
        if (route.name !== 'database') {
            void invoke('quit_app');
        }
    });
});

onUnmounted(() => {
    unlistenQuitRequested?.();
    unlistenQuitRequested = null;
});
</script>

<template>
    <router-view />
</template>

<style>
:root {
    --bg-color: #0f1117;
    --card-bg: #1a1b23;
    --border-color: #2a2b35;
    --text-primary: #e4e4e7;
    --text-secondary: #71717a;
    --accent-color: #6366f1;
    --accent-hover: #5457e5;
    --error-color: #ef4444;
    --input-bg: #12131a;
    --badge-bg: #1f2028;
}

:root[data-theme='light'] {
    --bg-color: #f8fafc;
    --card-bg: #ffffff;
    --border-color: #e2e8f0;
    --text-primary: #0f172a;
    --text-secondary: #64748b;
    --accent-color: #6366f1;
    --accent-hover: #4f46e5;
    --error-color: #ef4444;
    --input-bg: #f1f5f9;
    --badge-bg: #f1f5f9;
}

* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family:
        'Inter',
        system-ui,
        -apple-system,
        BlinkMacSystemFont,
        'Segoe UI',
        Roboto,
        sans-serif;
    background-color: var(--bg-color);
    color: var(--text-primary);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
}

::selection {
    background: rgba(99, 102, 241, 0.3);
}

/* Visible keyboard focus ring across the app (keyboard only, not mouse). */
:focus-visible {
    outline: 2px solid var(--accent-color);
    outline-offset: 2px;
}

:focus:not(:focus-visible) {
    outline: none;
}

::-webkit-scrollbar {
    width: 6px;
}

::-webkit-scrollbar-track {
    background: var(--bg-color);
}

::-webkit-scrollbar-thumb {
    background: var(--border-color);
    border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
    background: var(--text-secondary);
}
</style>
