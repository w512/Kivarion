# Kivarion

Kivarion is a modern, fast, and secure desktop password manager that works with the KeePass format (`.kdbx` files). Built with **Tauri 2** and **Vue 3**, it provides a native user experience with a strong focus on security.

## Key Features

- **Full KDBX 4 support** — securely work with KeePass 2.x databases.
- **Secure decryption** — uses **Argon2** (WASM) for key derivation.
- **Three-column interface** — convenient navigation with a group tree, entry list, and resizable detail panel.
- **Structure management** — create, rename, and delete groups and entries.
- **Global search** — the search field in the top bar filters entries across the entire database, regardless of the selected group. It searches the **Title**, **UserName**, **URL**, **Notes**, and **custom fields** by both name and value. Matching is case-insensitive and substring-based. Protected fields, including passwords and hidden custom fields, are excluded from search.
- **Attachment support** — view, preview (images and PDFs), and export files attached to entries.
- **Website favicons** — automatically fetch icons for entries through `icon.horse`.
- **Password generator** — create strong passwords with configurable options.
- **Auto-save** — immediately write changes to the file after every operation.
- **Personalization** — supports light, dark, and system themes.
- **Native experience** — integrates with the operating system through Tauri, including dialogs, filesystem access, and system paths.

## Technology Stack

| Component | Technology |
|-----------|-----------|
| **Core** | [Tauri 2](https://v2.tauri.app/) (Rust) |
| **Frontend** | [Vue 3](https://vuejs.org/) (Composition API) |
| **State** | [Pinia](https://pinia.vuejs.org/) |
| **Routing** | [Vue Router](https://router.vuejs.org/) |
| **KDBX** | [kdbxweb](https://github.com/keeweb/kdbxweb) |
| **Crypto** | [argon2-browser](https://github.com/antelle/argon2-browser) (Bundled WASM) |
| **Styling** | Vanilla CSS (Variables & Glassmorphism) |

## Development

[Bun](https://bun.sh/) is required.

```bash
# Install dependencies
bun install

# Run in development mode (Tauri + Vite)
bun run tauri dev

# Build the production version
bun run tauri build
```

## Test Database

`TestDatabase.kdbx` is a sample database for local testing only. It contains no real secrets.

Password: `123`

## Project Structure

```
src/
├── main.js              # Vue and crypto engine initialization
├── App.vue              # Root component and global style tokens
├── store.js             # Pinia store (database, credentials, theme)
├── pages/               # Main screens: HomePage, DatabasePage, SettingsPage
├── components/          # Modular UI (modals, header, EntryDetail, GroupTree, etc.)
├── composables/         # Shared logic (auth, actions, resizing, icons, attachments)
├── crypto-init.js       # kdbxweb configuration for Argon2
├── dbHelper.js          # Low-level filesystem operations
└── utils.js             # Formatting and password generation utilities

src-tauri/
├── capabilities/        # Plugin permission configuration (http, dialog)
├── src/
│   ├── main.rs          # Rust entry point
│   └── lib.rs           # Plugin registration and custom commands
└── tauri.conf.json      # Tauri build configuration
```

## Security

- The master password is not persisted by default. **If you enable Touch ID unlock, the password is stored in the macOS Keychain** so it can be retrieved (as plaintext, into the app) after a successful biometric check. It is protected at rest by the OS Keychain, not "never stored". Touch ID is only triggered by an explicit action — Kivarion never prompts for it automatically.
- Sensitive fields are handled through the `kdbxweb` library's `ProtectedValue`.
- The webview has **no direct filesystem access**: all database/attachment file I/O goes through dedicated Rust commands operating only on a path you picked via a native dialog.
- On macOS, previewing an attachment with Quick Look writes the decrypted file to a private temporary location and deletes it after the preview closes; the OS may still cache previews.
- Saves are durable and atomic (temp file → fsync → rename), and detect external modification before overwriting. Rotating `.bak` backups (configurable in Settings) are kept next to the database; they are encrypted KDBX copies, not plaintext.
