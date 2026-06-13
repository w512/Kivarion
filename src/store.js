import { defineStore } from 'pinia';
import { ref, shallowRef, watch } from 'vue';

export const useStore = defineStore('main', () => {
    const db = shallowRef(null);
    const fileName = ref('');
    const selectedGroupUuid = ref(null);
    const filePath = ref(null);

    // Modification time (ms since epoch) of the on-disk DB file as we last knew
    // it. Set when the file is opened and after every successful save; passed to
    // `save_database` so an external change is detected instead of clobbered.
    const knownMtime = ref(null);

    // kdbxweb objects (groups/entries) are not reactive. Components depend on
    // `dbVersion` so they re-evaluate after a mutation; call `touchDb()` once
    // after any change to the database structure.
    const dbVersion = ref(0);
    function touchDb() {
        dbVersion.value++;
    }

    const theme = ref(localStorage.getItem('kivarion-theme') || 'system');
    const clipboardTimeout = ref(parseInt(localStorage.getItem('kivarion-clipboard-timeout')) || 30);
    const autoLockTimeout = ref(parseInt(localStorage.getItem('kivarion-autolock-timeout')) || 0);

    // Backup policy: keep rotating `.bak` copies on each save.
    const backupEnabled = ref(localStorage.getItem('kivarion-backup-enabled') !== 'false');
    const backupDepth = ref(parseInt(localStorage.getItem('kivarion-backup-depth')) || 3);

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    function applyTheme(t) {
        let themeToApply = t;
        if (t === 'system') {
            themeToApply = mediaQuery.matches ? 'dark' : 'light';
        }
        document.documentElement.setAttribute('data-theme', themeToApply);
    }

    const handleSystemThemeChange = () => {
        if (theme.value === 'system') {
            applyTheme('system');
        }
    };

    mediaQuery.addEventListener('change', handleSystemThemeChange);
    
    watch(theme, (newTheme) => {
        localStorage.setItem('kivarion-theme', newTheme);
        applyTheme(newTheme);
    }, { immediate: true });

    watch(clipboardTimeout, (newVal) => {
        localStorage.setItem('kivarion-clipboard-timeout', newVal);
    });

    watch(autoLockTimeout, (newVal) => {
        localStorage.setItem('kivarion-autolock-timeout', newVal);
    });

    watch(backupEnabled, (newVal) => {
        localStorage.setItem('kivarion-backup-enabled', newVal ? 'true' : 'false');
    });

    watch(backupDepth, (newVal) => {
        localStorage.setItem('kivarion-backup-depth', newVal);
    });

    return {
        db, fileName, selectedGroupUuid, filePath,
        knownMtime,
        dbVersion, touchDb,
        theme, clipboardTimeout, autoLockTimeout,
        backupEnabled, backupDepth
    };
});
