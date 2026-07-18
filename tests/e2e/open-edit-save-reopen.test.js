import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import {
    copyFileSync,
    existsSync,
    mkdtempSync,
    rmSync,
    statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';

// tauri-driver currently supports Linux/Windows WebDriver backends; on macOS
// the crate exits with "not supported on this platform". Keep this smoke test
// opt-in and automatically skipped where the driver cannot run.
const IS_TAURI_DRIVER_SUPPORTED = process.platform !== 'darwin';
const RUN_E2E = process.env.KIVARION_E2E === '1' && IS_TAURI_DRIVER_SUPPORTED;
const WEB_ELEMENT_ID = 'element-6066-11e4-a52e-4f735466cecf';

let tempDir;
let driverProcess;
let driver;
let dbPath;

function defaultAppPath() {
    const root = process.cwd();
    const candidates = [
        path.join(root, 'src-tauri/target/debug/bundle/macos/Kivarion.app'),
        path.join(root, 'src-tauri/target/release/bundle/macos/Kivarion.app'),
        path.join(root, 'src-tauri/target/debug/Kivarion'),
        path.join(root, 'src-tauri/target/release/Kivarion'),
        path.join(root, 'src-tauri/target/debug/Kivarion.exe'),
        path.join(root, 'src-tauri/target/release/Kivarion.exe'),
    ];
    return candidates.find(existsSync) || candidates[0];
}

async function findFreePort() {
    return await new Promise((resolve, reject) => {
        const server = net.createServer();
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
        server.on('error', reject);
    });
}

async function waitFor(fn, timeoutMs = 15_000, intervalMs = 100) {
    const start = Date.now();
    let lastError;
    while (Date.now() - start < timeoutMs) {
        try {
            const result = await fn();
            if (result) return result;
        } catch (error) {
            lastError = error;
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw lastError || new Error('Timed out waiting for condition');
}

async function startTauriDriver() {
    const port =
        Number(process.env.TAURI_DRIVER_PORT) || (await findFreePort());
    const command = process.env.TAURI_DRIVER || 'tauri-driver';
    driverProcess = spawn(command, ['--port', String(port)], {
        stdio: process.env.TAURI_DRIVER_LOG ? 'inherit' : 'ignore',
    });

    driverProcess.on('exit', (code, signal) => {
        if (code || signal) {
            // Surface unexpected exits in waits/requests via connection errors.
        }
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    await waitFor(async () => {
        const response = await fetch(`${baseUrl}/status`).catch(() => null);
        return response?.ok;
    });

    return new WebDriverClient(baseUrl);
}

class WebDriverClient {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
        this.sessionId = null;
    }

    async request(method, endpoint, body = undefined) {
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
            method,
            headers:
                body === undefined
                    ? undefined
                    : { 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(
                `${method} ${endpoint} failed (${response.status}): ${JSON.stringify(payload)}`,
            );
        }
        return payload.value ?? payload;
    }

    async createSession(application) {
        const value = await this.request('POST', '/session', {
            capabilities: {
                alwaysMatch: {
                    browserName: 'wry',
                    'tauri:options': { application },
                },
            },
        });
        this.sessionId = value.sessionId || value.capabilities?.sessionId;
        if (!this.sessionId)
            throw new Error('tauri-driver did not return a session id');
    }

    async deleteSession() {
        if (!this.sessionId) return;
        const id = this.sessionId;
        this.sessionId = null;
        await this.request('DELETE', `/session/${id}`).catch(() => {});
    }

    async execute(script, args = []) {
        return await this.request(
            'POST',
            `/session/${this.sessionId}/execute/sync`,
            {
                script,
                args,
            },
        );
    }

    async element(using, value) {
        const result = await this.request(
            'POST',
            `/session/${this.sessionId}/element`,
            {
                using,
                value,
            },
        );
        return result[WEB_ELEMENT_ID] || result.ELEMENT;
    }

    async elements(using, value) {
        const result = await this.request(
            'POST',
            `/session/${this.sessionId}/elements`,
            {
                using,
                value,
            },
        );
        return result.map(
            (element) => element[WEB_ELEMENT_ID] || element.ELEMENT,
        );
    }

    async waitForElement(using, value, timeoutMs = 15_000) {
        return await waitFor(
            async () => await this.element(using, value),
            timeoutMs,
        );
    }

    async click(elementId) {
        await this.request(
            'POST',
            `/session/${this.sessionId}/element/${elementId}/click`,
            {},
        );
    }

    async clear(elementId) {
        await this.request(
            'POST',
            `/session/${this.sessionId}/element/${elementId}/clear`,
            {},
        );
    }

    async sendKeys(elementId, text) {
        await this.request(
            'POST',
            `/session/${this.sessionId}/element/${elementId}/value`,
            {
                text,
            },
        );
    }

    async text(elementId) {
        return await this.request(
            'GET',
            `/session/${this.sessionId}/element/${elementId}/text`,
        );
    }
}

async function openDatabaseFromLastPath(client, databasePath) {
    await client.execute(
        `localStorage.clear();
         localStorage.setItem('kivarion-last-db-path', arguments[0]);
         location.reload();
         return true;`,
        [databasePath],
    );

    const passwordInput = await client.waitForElement(
        'css selector',
        'input[type="password"]',
    );
    await client.sendKeys(passwordInput, '123');
    const openButton = await client.waitForElement(
        'css selector',
        'button[type="submit"]',
    );
    await client.click(openButton);
    await client.waitForElement('css selector', '.entry-row', 30_000);
}

async function selectFirstEntry(client) {
    const rows = await waitFor(async () => {
        const elements = await client.elements('css selector', '.entry-row');
        return elements.length ? elements : null;
    });
    await client.click(rows[0]);
    return await client.waitForElement('css selector', '.entry-detail h2');
}

beforeEach(() => {
    if (!RUN_E2E) return;
    tempDir = mkdtempSync(path.join(tmpdir(), 'kivarion-e2e-'));
    dbPath = path.join(tempDir, 'E2E-TestDatabase.kdbx');
    copyFileSync(path.resolve('TestDatabase.kdbx'), dbPath);
});

afterEach(async () => {
    await driver?.deleteSession?.();
    driver = null;
    if (driverProcess) {
        driverProcess.kill();
        driverProcess = null;
    }
    if (tempDir) {
        rmSync(tempDir, { recursive: true, force: true });
        tempDir = null;
    }
});

describe('E2E smoke: open, edit, save, reopen', () => {
    const e2eTest = RUN_E2E ? test : test.skip;

    e2eTest(
        'persists an edited entry title after reopening the database',
        async () => {
            const appPath = process.env.KIVARION_E2E_APP || defaultAppPath();
            if (!existsSync(appPath)) {
                throw new Error(
                    `Tauri app not found: ${appPath}. Build it first (for example: bun run tauri build --debug) or set KIVARION_E2E_APP.`,
                );
            }

            driver = await startTauriDriver();
            await driver.createSession(appPath);

            await openDatabaseFromLastPath(driver, dbPath);
            await selectFirstEntry(driver);

            const editButton = await driver.waitForElement(
                'css selector',
                'button[title="Edit entry"]',
            );
            await driver.click(editButton);
            const titleInput = await driver.waitForElement(
                'css selector',
                'input[placeholder="Entry title"]',
            );

            const oldMtime = statSync(dbPath).mtimeMs;
            const newTitle = `E2E saved ${Date.now()}`;
            await driver.clear(titleInput);
            await driver.sendKeys(titleInput, newTitle);
            await driver.click(
                await driver.waitForElement('css selector', 'button.save-btn'),
            );

            await waitFor(
                async () => statSync(dbPath).mtimeMs > oldMtime,
                30_000,
            );
            const heading = await driver.waitForElement(
                'css selector',
                '.entry-detail h2',
            );
            await waitFor(
                async () => (await driver.text(heading)) === newTitle,
                10_000,
            );

            await driver.deleteSession();
            await driver.createSession(appPath);
            await openDatabaseFromLastPath(driver, dbPath);

            const searchInput = await driver.waitForElement(
                'css selector',
                'input.search-input',
            );
            await driver.sendKeys(searchInput, newTitle);
            await waitFor(async () => {
                const rows = await driver.elements(
                    'css selector',
                    '.entry-row',
                );
                for (const row of rows) {
                    if ((await driver.text(row)).includes(newTitle)) return row;
                }
                return null;
            }, 15_000);

            await selectFirstEntry(driver);
            const reopenedHeading = await driver.waitForElement(
                'css selector',
                '.entry-detail h2',
            );
            expect(await driver.text(reopenedHeading)).toBe(newTitle);
        },
        120_000,
    );
});
