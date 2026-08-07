<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { openUrl } from '@tauri-apps/plugin-opener';
import licenses from '../licenses.js';

// The four projects the About dialog names, with their notices in full: MIT,
// ISC and Apache-2.0 each ask for the notice to travel with the copies, and a
// list of names does not do that.

const router = useRouter();
const linkError = ref('');

function goBack() {
    // A window reloaded directly on #/licenses has no in-app history.
    if (window.history.state?.back) router.back();
    else router.replace({ name: 'settings' });
}

// Same rule as the entry URL: the anchor never navigates the webview itself,
// which would put an unlocked database behind a page a remote origin controls.
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

<template>
    <div class="licenses-page">
        <header class="licenses-header">
            <button class="back-btn" title="Go back" @click="goBack">
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
            <h1>Open Source Licenses</h1>
        </header>

        <div class="licenses-content">
            <p class="intro">
                Kivarion is built on the projects below, and reproduces each
                notice in full as its license requires.
            </p>

            <p v-if="linkError" class="link-error" role="alert">
                {{ linkError }}
            </p>

            <section
                v-for="entry in licenses"
                :key="entry.name"
                class="license-card"
            >
                <div class="license-head">
                    <h2>{{ entry.name }}</h2>
                    <span class="license-what">{{ entry.what }}</span>
                    <span class="license-id">{{ entry.license }}</span>
                </div>
                <a
                    class="license-url"
                    :href="entry.url"
                    @click.prevent="openLink(entry.url)"
                >
                    {{ entry.url }}
                </a>
                <pre class="license-text">{{ entry.text }}</pre>
            </section>
        </div>
    </div>
</template>

<style scoped>
.licenses-page {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg-color);
    color: var(--text-primary);
}

.licenses-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
}

.licenses-header h1 {
    margin: 0;
    font-size: 1.1rem;
}

.back-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--card-bg);
    color: var(--text-primary);
    cursor: pointer;
}

.back-btn:hover {
    border-color: var(--accent-color);
    color: var(--accent-color);
}

.licenses-content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 1.25rem 1.5rem 2rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
}

.intro {
    margin: 0;
    max-width: 70ch;
    font-size: 0.85rem;
    color: var(--text-secondary);
}

.license-card {
    border: 1px solid var(--border-color);
    border-radius: 10px;
    background: var(--card-bg);
    padding: 0.9rem 1rem;
}

.license-head {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.5rem;
}

.license-head h2 {
    margin: 0;
    font-size: 0.95rem;
}

.license-what {
    flex: 1;
    font-size: 0.8rem;
    color: var(--text-secondary);
}

.license-id {
    font-size: 0.75rem;
    padding: 0.1rem 0.45rem;
    border-radius: 5px;
    background: var(--badge-bg);
    color: var(--text-secondary);
}

.license-url {
    display: inline-block;
    margin-top: 0.15rem;
    font-size: 0.8rem;
    color: var(--accent-color);
    text-decoration: none;
}

.license-url:hover {
    text-decoration: underline;
}

/* The notices are pre-formatted at their own widths, so they wrap inside the
   card instead of stretching the page. */
.license-text {
    margin: 0.7rem 0 0;
    padding: 0.8rem;
    border-radius: 8px;
    background: var(--badge-bg);
    font-size: 0.75rem;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-x: auto;
}

.link-error {
    margin: 0;
    color: var(--error-color);
    font-size: 0.8rem;
}
</style>
