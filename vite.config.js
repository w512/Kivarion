import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
    plugins: [vue()],

    build: {
        // Tied to `bundle.macOS.minimumSystemVersion` in `tauri.conf.json`:
        // macOS 13.0 ships Safari 16, and a Tauri app renders in the system's
        // own WKWebView, so the oldest macOS we install on decides the oldest
        // syntax we may emit. Set explicitly rather than left to Vite's
        // default, which is a moving target — it went from Safari 16.0 to 16.4
        // in Vite 8 on its own, which would have quietly dropped 13.0–13.2.
        // Windows (evergreen WebView2) and Linux (WebKitGTK) are both newer
        // than this, so one conservative target covers all three.
        target: 'safari16',
    },

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent Vite from obscuring rust errors
    clearScreen: false,
    // 2. tauri expects a fixed port, fail if that port is not available
    server: {
        port: 1420,
        strictPort: true,
        host: host || false,
        hmr: host
            ? {
                  protocol: 'ws',
                  host,
                  port: 1421,
              }
            : undefined,
        watch: {
            // 3. tell Vite to ignore watching `src-tauri`
            ignored: ['**/src-tauri/**'],
        },
    },
}));
