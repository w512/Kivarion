<template>
    <div class="fields-view">
        <div
            v-for="field in standardFields"
            v-show="field.value"
            :key="field.id"
            class="field-row"
        >
            <label>{{ field.label }}</label>
            <div class="field-value-row">
                <div
                    v-if="field.id === 'Password'"
                    class="field-value password-value"
                >
                    <ColoredPassword v-if="showPassword" :value="field.value" />
                    <template v-else>{{
                        maskedPassword(field.value)
                    }}</template>
                </div>
                <div v-else-if="field.id === 'URL'" class="field-value">
                    <a
                        v-if="field.href"
                        :href="field.href"
                        target="_blank"
                        rel="noopener noreferrer"
                        @click.prevent="openLink(field.href)"
                        >{{ field.value }}</a
                    >
                    <span v-else>{{ field.value }}</span>
                    <p v-if="linkError" class="link-error" role="alert">
                        {{ linkError }}
                    </p>
                </div>
                <div
                    v-else
                    :class="['field-value', { notes: field.id === 'Notes' }]"
                >
                    {{ field.value }}
                </div>

                <div class="field-actions">
                    <button
                        v-if="field.id === 'Password'"
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

                    <div class="copy-btn-wrapper">
                        <transition name="mini-toast">
                            <div
                                v-if="activeCopyField === field.id"
                                class="mini-toast"
                            >
                                Copied!
                            </div>
                        </transition>
                        <button
                            class="copy-btn"
                            :title="'Copy ' + field.label.toLowerCase()"
                            @click="copy(field.value, field.id, field.secret)"
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
                                    x="9"
                                    y="9"
                                    width="13"
                                    height="13"
                                    rx="2"
                                    ry="2"
                                />
                                <path
                                    d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
                                />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { openUrl } from '@tauri-apps/plugin-opener';
import { getField, normalizeHttpUrl } from '../../utils';
import { useClipboard } from '../../composables/useClipboard';
import ColoredPassword from './ColoredPassword.vue';

const props = defineProps({
    entry: { type: Object, required: true },
    // A custom field the parent promoted into this group (see isEmailFieldName).
    emailField: { type: Object, default: null },
});

const showPassword = ref(false);
const linkError = ref('');
const { activeCopyField, copy: copyToClipboard } = useClipboard();

watch(
    () => props.entry,
    () => (linkError.value = ''),
);

const standardFields = computed(() => [
    { id: 'Title', label: 'Title', value: getField(props.entry, 'Title') },
    {
        id: 'UserName',
        label: 'Username',
        value: getField(props.entry, 'UserName'),
    },
    // Right below the username: both name the account this entry is for.
    ...(props.emailField
        ? [
              {
                  id: props.emailField.key,
                  label: props.emailField.key,
                  value: props.emailField.value,
              },
          ]
        : []),
    // The only secret among the main fields, and so the only one whose copy
    // arms the clipboard auto-clear.
    {
        id: 'Password',
        label: 'Password',
        value: getField(props.entry, 'Password'),
        secret: true,
    },
    {
        id: 'URL',
        label: 'URL',
        value: getField(props.entry, 'URL'),
        href: normalizeHttpUrl(getField(props.entry, 'URL')),
    },
    { id: 'Notes', label: 'Notes', value: getField(props.entry, 'Notes') },
]);

function maskedPassword(pw) {
    return pw ? '••••••••' : '';
}

/**
 * Open the entry's site in the user's browser.
 *
 * The anchor's own navigation is always prevented. Left to the webview,
 * `target="_blank"` does nothing at all on macOS — wry only answers WKWebView's
 * `createWebViewWithConfiguration:` when the app registered a new-window
 * handler, and Kivarion does not — while on Windows and Linux it can instead
 * navigate the app's own webview to the site, leaving an unlocked database in a
 * page some remote origin controls. Handing the URL to the OS avoids both and
 * behaves the same everywhere.
 *
 * `href` is `normalizeHttpUrl`'s output, so only `http:`/`https:` can ever get
 * here — an entry whose URL is `file:` or `javascript:` renders as plain text
 * with no link at all. The backend's `opener:default` scope allows the same
 * schemes, so it is a second gate rather than the only one.
 *
 * Deliberately *not* wrapped in `withSystemInteraction`: unlike a file dialog,
 * this is the user genuinely leaving for another app, and "lock on focus loss"
 * should do exactly what it says.
 */
async function openLink(href) {
    linkError.value = '';
    try {
        await openUrl(href);
    } catch (error) {
        console.error('Could not open the link:', error);
        // A link that silently does nothing is the bug this replaced; say so
        // rather than reintroducing it in a rarer form.
        linkError.value = 'Could not open this link in your browser.';
    }
}

// Only a secret is worth wiping from the clipboard on a timer. Doing it for the
// title, username, e-mail, URL or notes as well emptied the clipboard under a
// user who had copied one of them to paste somewhere later, and left an
// ordinary field tracked as the managed secret.
function copy(text, fieldId, secret = false) {
    return copyToClipboard(text, fieldId, { autoClear: secret });
}
</script>

<style scoped>
.fields-view {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.field-row {
    background: var(--badge-bg);
    border-radius: 8px;
    padding: 0.6rem 0.75rem;
}

.field-row label {
    display: block;
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.25rem;
}

.field-value-row {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
}

.field-value {
    font-size: 0.9rem;
    color: var(--text-primary);
    word-break: break-all;
    flex: 1;
}

.field-value a {
    color: var(--accent-color);
    text-decoration: none;
}

.field-value a:hover {
    text-decoration: underline;
}

.field-value.notes {
    white-space: pre-wrap;
    line-height: 1.5;
}

.link-error {
    margin-top: 0.35rem;
    color: var(--error-color);
    font-size: 0.78rem;
}

.field-actions {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-shrink: 0;
}

.copy-btn-wrapper {
    position: relative;
    display: flex;
    align-items: center;
}

.mini-toast {
    position: absolute;
    top: -1.75rem;
    right: 0;
    background: var(--accent-color);
    color: white;
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
    font-size: 0.65rem;
    font-weight: 700;
    white-space: nowrap;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    pointer-events: none;
    z-index: 100;
}

.mini-toast::after {
    content: '';
    position: absolute;
    bottom: -3px;
    right: 8px;
    border-left: 4px solid transparent;
    border-right: 4px solid transparent;
    border-top: 4px solid var(--accent-color);
}

.mini-toast-enter-active,
.mini-toast-leave-active {
    transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.mini-toast-enter-from,
.mini-toast-leave-to {
    opacity: 0;
    transform: translateY(5px) scale(0.8);
}

.copy-btn,
.toggle-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.25rem;
    border: none;
    background: none;
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.15s;
    box-shadow: none;
    flex-shrink: 0;
}

.copy-btn:hover,
.toggle-btn:hover {
    color: var(--accent-color);
    background: rgba(99, 102, 241, 0.1);
}
</style>
