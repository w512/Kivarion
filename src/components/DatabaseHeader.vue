<template>
    <header class="page-header">
        <!-- Everything that acts on the *file* hangs off its name, rather than
             sitting in the right-hand corner among the search box and the
             session controls: those actions are rare, and the database they
             apply to is what the user is looking at while choosing one. -->
        <div ref="dbMenuRoot" class="db-menu" @keydown="onMenuKeydown">
            <h1 class="db-heading">
                <button
                    ref="triggerRef"
                    class="db-trigger"
                    :class="{ open: isMenuOpen }"
                    aria-haspopup="menu"
                    :aria-expanded="isMenuOpen"
                    :title="filePath"
                    @click="toggleMenu"
                    @keydown.down.prevent="openAndFocusFirst"
                >
                    <span class="db-meta">
                        <span class="db-name">{{ dbName }}</span>
                        <span class="file-name">{{ filePath }}</span>
                    </span>
                    <ChevronDown
                        class="chevron"
                        :class="{ open: isMenuOpen }"
                        :size="14"
                        :stroke-width="2.5"
                    />
                </button>
            </h1>
            <div
                v-if="isMenuOpen"
                ref="menuRef"
                class="dropdown-menu"
                role="menu"
            >
                <button
                    class="menu-item"
                    role="menuitem"
                    @click="choose(() => emit('edit-db'))"
                >
                    <KeyRound :size="14" />
                    Database Settings…
                </button>
                <button
                    class="menu-item"
                    role="menuitem"
                    @click="choose(() => emit('settings'))"
                >
                    <Settings :size="14" />
                    App Settings…
                </button>
                <div class="menu-divider"></div>
                <button
                    class="menu-item danger"
                    role="menuitem"
                    @click="choose(() => emit('close'))"
                >
                    <LogOut :size="14" />
                    Close Database
                </button>
            </div>
        </div>
        <div class="header-actions">
            <div class="search-box" :title="searchTitle">
                <Search class="search-icon" :size="14" />
                <input
                    ref="searchInputRef"
                    v-model="search"
                    type="text"
                    class="search-input"
                    placeholder="Search entries"
                    spellcheck="false"
                />
                <button
                    v-if="search"
                    class="search-clear"
                    title="Clear search"
                    aria-label="Clear search"
                    @click="search = ''"
                >
                    <X :size="12" :stroke-width="2.5" />
                </button>
            </div>
            <!-- The one action here that is both frequent and about safety, so
                 it stays a button instead of joining the menu above. -->
            <button
                class="icon-btn lock-btn"
                :title="lockTitle"
                @click="emit('lock')"
            >
                <Lock :size="16" />
            </button>
        </div>
    </header>
</template>

<script setup>
import { computed, nextTick, ref } from 'vue';
import {
    ChevronDown,
    KeyRound,
    Lock,
    LogOut,
    Search,
    Settings,
    X,
} from 'lucide-vue-next';
import { useOutsideClick } from '../composables/useOutsideClick';
import { usePlatform } from '../composables/usePlatform';

defineProps({
    dbName: { type: String, default: 'Unnamed' },
    filePath: { type: String, default: '' },
});

const emit = defineEmits(['lock', 'close', 'edit-db', 'settings']);

const search = defineModel('search', { type: String, default: '' });
const searchInputRef = ref(null);

const isMenuOpen = ref(false);
const dbMenuRoot = ref(null);
const triggerRef = ref(null);
const menuRef = ref(null);

const { isMac } = usePlatform();
const mod = computed(() => (isMac.value ? '⌘' : 'Ctrl+'));
const searchTitle = computed(() => `Search entries (${mod.value}F)`);
const lockTitle = computed(() => `Lock database (${mod.value}L)`);

useOutsideClick(dbMenuRoot, () => (isMenuOpen.value = false));

function toggleMenu() {
    isMenuOpen.value = !isMenuOpen.value;
}

function closeMenu() {
    isMenuOpen.value = false;
}

function choose(action) {
    closeMenu();
    action();
}

function menuItems() {
    return menuRef.value
        ? Array.from(menuRef.value.querySelectorAll('.menu-item'))
        : [];
}

function focusItem(index) {
    const items = menuItems();
    if (items.length === 0) return;
    items[(index + items.length) % items.length].focus();
}

function openAndFocusFirst() {
    isMenuOpen.value = true;
    nextTick(() => focusItem(0));
}

// On the wrapper rather than on the menu, so Escape closes it while the focus
// still sits on the trigger — which is where a mouse click leaves it. The event
// is stopped as well: DatabasePage listens for Escape on the window and would
// otherwise clear the search box behind the menu the user was dismissing.
function onMenuKeydown(e) {
    if (!isMenuOpen.value) return;
    const items = menuItems();
    const current = items.indexOf(document.activeElement);
    switch (e.key) {
        case 'ArrowDown':
            e.preventDefault();
            focusItem(current + 1);
            break;
        case 'ArrowUp':
            e.preventDefault();
            focusItem(current - 1);
            break;
        case 'Home':
            e.preventDefault();
            focusItem(0);
            break;
        case 'End':
            e.preventDefault();
            focusItem(items.length - 1);
            break;
        case 'Escape':
            e.preventDefault();
            e.stopPropagation();
            closeMenu();
            triggerRef.value?.focus();
            break;
        case 'Tab':
            closeMenu();
            break;
    }
}

function focusSearch() {
    searchInputRef.value?.focus();
    searchInputRef.value?.select?.();
}

function clearSearch() {
    search.value = '';
}

defineExpose({ focusSearch, clearSearch });
</script>

<style scoped>
.page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.4rem 0.75rem 0.4rem 0.6rem;
    border-bottom: 1px solid var(--border-color);
    background: var(--card-bg);
    flex-shrink: 0;
}

.db-menu {
    position: relative;
    min-width: 0;
}

.db-heading {
    margin: 0;
    font-size: inherit;
    font-weight: inherit;
}

.db-trigger {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    max-width: 100%;
    padding: 0.3rem 0.5rem;
    border: none;
    border-radius: 8px;
    background: transparent;
    /* Only the chevron takes this now — the name and the path set their own,
       and an accent-coloured chevron shouted louder than the name beside it. */
    color: var(--text-secondary);
    cursor: pointer;
    text-align: left;
    transition:
        background 0.15s,
        color 0.15s;
}

.db-trigger:hover,
.db-trigger.open {
    background: var(--badge-bg);
}

/* `min-width: 0` so a long path can shrink and ellipsize instead of pushing
   the search box off the header. */
.db-meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
}

.db-name,
.file-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.db-name {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1.2;
}

.file-name {
    font-size: 0.7rem;
    color: var(--text-secondary);
}

.chevron {
    flex-shrink: 0;
    opacity: 0.7;
    transition: transform 0.2s;
}

.chevron.open {
    transform: rotate(180deg);
}

.dropdown-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 100;
    min-width: 190px;
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 0.4rem;
    box-shadow:
        0 10px 15px -3px rgba(0, 0, 0, 0.3),
        0 4px 6px -2px rgba(0, 0, 0, 0.15);
}

.menu-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.5rem 0.6rem;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-size: 0.85rem;
    text-align: left;
    white-space: nowrap;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s;
}

.menu-item:hover,
.menu-item:focus-visible {
    background: var(--badge-bg);
}

.menu-item.danger {
    color: var(--error-color);
}

.menu-item.danger:hover,
.menu-item.danger:focus-visible {
    background: rgba(239, 68, 68, 0.1);
}

.menu-divider {
    height: 1px;
    background: var(--border-color);
    margin: 0.4rem 0.25rem;
}

/* Never shrinks: a long file path has to ellipsize on the left instead of
   squeezing the search box. */
.header-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-shrink: 0;
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

/* Borderless on purpose: a border around every icon turns a row of them into a
   grid of boxes, and the search box beside it is then the only framed element
   — which is the one that should draw the eye. */
.icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.45rem;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition:
        background 0.15s,
        color 0.15s;
}

.icon-btn:hover {
    background: var(--badge-bg);
    color: var(--accent-color);
}
</style>
