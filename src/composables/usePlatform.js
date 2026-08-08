import { ref } from 'vue';
import { type } from '@tauri-apps/plugin-os';

/**
 * Whether the app runs on macOS — asked by everything that has to word a
 * keyboard shortcut (⌘ vs Ctrl) or offer a macOS-only feature (Quick Look).
 *
 * `type()` is synchronous: the plugin injects the value into the webview before
 * the app bundle runs, so this is a property read rather than a command call.
 * It still happens once and is shared, because the answer cannot change while
 * the process lives — and because the read has a failure mode worth keeping in
 * one place: outside a Tauri webview (the bare `bun run dev` server) the
 * injected global is absent and the property access throws. "Not macOS" is the
 * safe reading for both kinds of caller — a Ctrl-worded tooltip, and no Quick
 * Look — so a failure leaves the ref at `false` rather than propagating.
 *
 * The detection is lazy rather than done at module scope so it cannot depend on
 * import order relative to whatever sets that global up.
 */
const isMac = ref(false);
let detected = false;

export function usePlatform() {
    if (!detected) {
        detected = true;
        try {
            isMac.value = type() === 'macos';
        } catch (e) {
            console.error('Failed to detect OS', e);
        }
    }
    return { isMac };
}
