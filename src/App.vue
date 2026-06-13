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
