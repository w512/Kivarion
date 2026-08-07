<template>
    <BaseModal
        :show="show"
        width="440px"
        labelledby="about-title"
        @close="emit('close')"
    >
        <h3 id="about-title" class="about-title">Kivarion</h3>
        <p class="about-version">Version {{ version || '—' }}</p>
        <p class="about-summary">
            A desktop password manager for KeePass <code>.kdbx</code> files.
        </p>

        <h4 class="about-section">Built with</h4>
        <ul class="credits">
            <li v-for="credit in credits" :key="credit.name">
                <a :href="credit.url" @click.prevent="openLink(credit.url)">
                    {{ credit.name }}
                </a>
                <span class="credit-note">
                    — {{ credit.what }} ({{ credit.license }})
                </span>
            </li>
        </ul>

        <p v-if="linkError" class="link-error" role="alert">{{ linkError }}</p>

        <div class="modal-actions">
            <button type="button" class="cancel-btn" @click="emit('close')">
                Close
            </button>
        </div>
    </BaseModal>
</template>

<script setup>
import { ref, watch } from 'vue';
import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';
import BaseModal from './BaseModal.vue';

const props = defineProps({
    show: { type: Boolean, default: false },
});

const emit = defineEmits(['close']);

const version = ref('');
const linkError = ref('');

// The built-in icon set is Lucide's: KDBX stores only a standard icon *number*,
// and this is the artwork Kivarion draws it with, so the attribution belongs
// here rather than in a comment nobody reads.
const credits = [
    {
        name: 'Lucide',
        url: 'https://github.com/lucide-icons/lucide',
        what: 'the icon set',
        license: 'ISC',
    },
    {
        name: 'kdbxweb',
        url: 'https://github.com/keeweb/kdbxweb',
        what: 'KDBX reading and writing',
        license: 'MIT',
    },
    {
        name: 'Tauri',
        url: 'https://github.com/tauri-apps/tauri',
        what: 'the desktop shell',
        license: 'MIT / Apache-2.0',
    },
    {
        name: 'Vue',
        url: 'https://github.com/vuejs/core',
        what: 'the interface',
        license: 'MIT',
    },
];

// Read when the dialog first opens rather than on mount: it is one IPC call for
// something nobody has looked at yet.
watch(
    () => props.show,
    async (isShowing) => {
        if (!isShowing || version.value) return;
        try {
            version.value = await getVersion();
        } catch (error) {
            console.error('Could not read the app version:', error);
        }
    },
);

// Same rule as the entry URL: the anchor never navigates the webview itself —
// a navigation would put an unlocked database behind a page a remote origin
// controls. `opener:default`'s scope (http/https/mailto/tel) is the second gate.
async function openLink(href) {
    linkError.value = '';
    try {
        await openUrl(href);
    } catch (error) {
        console.error('Could not open the link:', error);
        linkError.value = 'Could not open this link in your browser.';
    }
}
</script>

<style scoped>
.about-title {
    margin: 0;
    font-size: 1.2rem;
    color: var(--text-primary);
}

.about-version {
    margin: 0.15rem 0 0.9rem;
    font-size: 0.8rem;
    color: var(--text-secondary);
}

.about-summary {
    margin: 0 0 1.2rem;
    font-size: 0.85rem;
    color: var(--text-primary);
}

.about-section {
    margin: 0 0 0.5rem;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-secondary);
}

.credits {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    font-size: 0.85rem;
}

.credits a {
    color: var(--accent-color);
    text-decoration: none;
}

.credits a:hover {
    text-decoration: underline;
}

.credit-note {
    color: var(--text-secondary);
}

.link-error {
    margin: 0.75rem 0 0;
    color: var(--error-color);
    font-size: 0.8rem;
}

.modal-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 1.25rem;
}

.cancel-btn {
    padding: 0.5rem 0.9rem;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--card-bg);
    color: var(--text-primary);
    font-size: 0.85rem;
    cursor: pointer;
}

.cancel-btn:hover {
    border-color: var(--accent-color);
    color: var(--accent-color);
}
</style>
