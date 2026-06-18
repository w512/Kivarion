import js from '@eslint/js';
import pluginVue from 'eslint-plugin-vue';
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting';
import globals from 'globals';

export default [
    {
        // Build output, Rust backend, vendored assets and lockfiles are not linted.
        ignores: ['dist/**', 'src-tauri/**', 'public/**', 'node_modules/**'],
    },
    js.configs.recommended,
    ...pluginVue.configs['flat/recommended'],
    {
        files: ['**/*.{js,mjs,vue}'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.browser,
            },
        },
        rules: {
            // Allow intentionally unused args/vars when prefixed with `_`.
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            // Best-effort `catch {}` blocks (localStorage / biometric cleanup)
            // are intentional; failure there is non-fatal.
            'no-empty': ['error', { allowEmptyCatch: true }],
            // App.vue is a legitimate single-word root component.
            'vue/multi-word-component-names': 'off',
            // Edit forms intentionally two-way bind to properties of an object
            // prop (the shared reactive `form`); only flag reassigning the prop.
            'vue/no-mutating-props': ['error', { shallowOnly: true }],
        },
    },
    {
        // Node-context config files.
        files: ['vite.config.js', 'eslint.config.js', '*.config.js'],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
    },
    {
        // Bun test runner: tests import from 'bun:test' and use Web Crypto on globalThis.
        files: ['tests/**/*.js'],
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.browser,
            },
        },
    },
    // Disable formatting-related lint rules; Prettier owns formatting.
    skipFormatting,
];
