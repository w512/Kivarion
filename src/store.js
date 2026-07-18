import { defineStore } from 'pinia';
import { ref, shallowRef, watch } from 'vue';

export const SETTING_LIMITS = {
    clipboardTimeout: { min: 0, max: 600, defaultValue: 30 },
    autoLockTimeout: { min: 0, max: 1440, defaultValue: 0 },
    backupDepth: { min: 1, max: 20, defaultValue: 3 },
};

export function clampNumberSetting(value, { min, max, defaultValue }) {
    const number = Number(value);
    if (!Number.isFinite(number)) return defaultValue;
    return Math.min(max, Math.max(min, Math.trunc(number)));
}

function readNumberSetting(key, limits) {
    const stored = localStorage.getItem(key);
    return clampNumberSetting(
        stored === null ? limits.defaultValue : stored,
        limits,
    );
}

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
    const clipboardTimeout = ref(
        readNumberSetting(
            'kivarion-clipboard-timeout',
            SETTING_LIMITS.clipboardTimeout,
        ),
    );
    const autoLockTimeout = ref(
        readNumberSetting(
            'kivarion-autolock-timeout',
            SETTING_LIMITS.autoLockTimeout,
        ),
    );
    const lockOnFocusLoss = ref(
        localStorage.getItem('kivarion-lock-on-focus-loss') === 'true',
    );

    // Backup policy: keep rotating `.bak` copies on each save.
    const backupEnabled = ref(
        localStorage.getItem('kivarion-backup-enabled') !== 'false',
    );
    const backupDepth = ref(
        readNumberSetting('kivarion-backup-depth', SETTING_LIMITS.backupDepth),
    );

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

    watch(
        theme,
        (newTheme) => {
            localStorage.setItem('kivarion-theme', newTheme);
            applyTheme(newTheme);
        },
        { immediate: true },
    );

    watch(clipboardTimeout, (newVal) => {
        const clamped = clampNumberSetting(
            newVal,
            SETTING_LIMITS.clipboardTimeout,
        );
        if (newVal !== clamped) {
            clipboardTimeout.value = clamped;
            return;
        }
        localStorage.setItem('kivarion-clipboard-timeout', String(clamped));
    });

    watch(autoLockTimeout, (newVal) => {
        const clamped = clampNumberSetting(
            newVal,
            SETTING_LIMITS.autoLockTimeout,
        );
        if (newVal !== clamped) {
            autoLockTimeout.value = clamped;
            return;
        }
        localStorage.setItem('kivarion-autolock-timeout', String(clamped));
    });

    watch(lockOnFocusLoss, (newVal) => {
        localStorage.setItem(
            'kivarion-lock-on-focus-loss',
            newVal ? 'true' : 'false',
        );
    });

    watch(backupEnabled, (newVal) => {
        localStorage.setItem(
            'kivarion-backup-enabled',
            newVal ? 'true' : 'false',
        );
    });

    watch(backupDepth, (newVal) => {
        const clamped = clampNumberSetting(newVal, SETTING_LIMITS.backupDepth);
        if (newVal !== clamped) {
            backupDepth.value = clamped;
            return;
        }
        localStorage.setItem('kivarion-backup-depth', String(clamped));
    });

    return {
        db,
        fileName,
        selectedGroupUuid,
        filePath,
        knownMtime,
        dbVersion,
        touchDb,
        theme,
        clipboardTimeout,
        autoLockTimeout,
        lockOnFocusLoss,
        backupEnabled,
        backupDepth,
    };
});
