import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import licenses from '../src/licenses.js';

// The Licenses screen is how Kivarion meets the one condition MIT, ISC and
// Apache-2.0 share: the notice travels with the copies. So each text is checked
// against the file its package actually ships — an upgrade that changes a
// notice, or a copy that drifts by an edit, fails here.

const entryFor = (name) => licenses.find((entry) => entry.name === name);
const shipped = (path) => readFileSync(path, 'utf8').trim();

describe('third-party licenses', () => {
    test('names the four projects the About dialog credits', () => {
        expect(licenses.map((entry) => entry.name)).toEqual([
            'Lucide',
            'kdbxweb',
            'Tauri',
            'Vue',
        ]);

        for (const entry of licenses) {
            expect(entry.what).toBeTruthy();
            expect(entry.license).toBeTruthy();
            expect(entry.url).toStartWith('https://github.com/');
            expect(entry.text.length).toBeGreaterThan(100);
        }
    });

    test('reproduces the npm packages verbatim', () => {
        expect(entryFor('Lucide').text).toBe(
            shipped('node_modules/lucide-vue-next/LICENSE'),
        );
        expect(entryFor('kdbxweb').text).toBe(
            shipped('node_modules/kdbxweb/LICENSE'),
        );
        expect(entryFor('Vue').text).toBe(shipped('node_modules/vue/LICENSE'));
    });

    test('carries both halves of the icon set’s notice', () => {
        const lucide = entryFor('Lucide').text;

        // ISC wants the copyright line and the permission notice; the icons
        // inherited from Feather carry a second, MIT one.
        expect(lucide).toContain('ISC License');
        expect(lucide).toContain('Lucide Contributors');
        expect(lucide).toContain('Cole Bemis');
        expect(lucide).toContain(
            'Permission to use, copy, modify, and/or distribute this software',
        );
        expect(lucide).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
    });

    test('carries both licenses Tauri is offered under', () => {
        const tauri = entryFor('Tauri').text;

        expect(tauri).toContain('Permission is hereby granted');
        expect(tauri).toContain('Apache License');
        expect(tauri).toContain('Version 2.0, January 2004');
    });
});
