import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse, compileScript } from '@vue/compiler-sfc';
import { createRenderer, defineComponent, h } from 'vue';

/**
 * Mount a real `.vue` single-file component in Bun, with no DOM.
 *
 * `loadVueComponent` compiles the SFC's `<script setup>` and rewrites its
 * imports into calls to an injected loader, so any dependency can be replaced
 * by a stub — child components, Tauri APIs, the store. The renderer below is a
 * custom one from `createRenderer`: nodes are plain objects, which is what lets
 * a test read what a component rendered without a DOM implementation.
 */

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

export function importSpecToDestructure(spec) {
    return spec
        .split(',')
        .map((part) => {
            const [name, alias] = part.trim().split(/\s+as\s+/);
            return alias ? `${name.trim()}: ${alias.trim()}` : name.trim();
        })
        .join(', ');
}

export async function loadVueComponent(filePath, stubs = {}) {
    const absolutePath = path.resolve(filePath);
    const source = readFileSync(absolutePath, 'utf8');
    const descriptor = parse(source, { filename: absolutePath }).descriptor;
    let code = compileScript(descriptor, {
        id: absolutePath,
        inlineTemplate: true,
    }).content;

    code = code.replace(
        /import\s+\{([\s\S]*?)\}\s+from\s+['"]([^'"]+)['"];?/g,
        (_, spec, importSource) =>
            `const { ${importSpecToDestructure(spec)} } = await __import(${JSON.stringify(importSource)});`,
    );
    code = code.replace(
        /import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"];?/g,
        (_, name, importSource) =>
            `const ${name} = (await __import(${JSON.stringify(importSource)})).default;`,
    );
    code = code.replace(/export\s+default/, 'return');

    const module = await new AsyncFunction(
        '__import',
        `${code}\n//# sourceURL=${absolutePath}`,
    )(async (importSource) => {
        if (importSource in stubs) return stubs[importSource];

        if (importSource.startsWith('.')) {
            let resolved = path.resolve(
                path.dirname(absolutePath),
                importSource,
            );
            if (!path.extname(resolved)) {
                if (readable(`${resolved}.js`)) resolved = `${resolved}.js`;
                else if (readable(`${resolved}.vue`))
                    resolved = `${resolved}.vue`;
            }
            if (resolved.endsWith('.vue'))
                return { default: await loadVueComponent(resolved, stubs) };
            return import(pathToFileURL(resolved).href);
        }

        return import(importSource);
    });

    return module;
}

export function readable(filePath) {
    try {
        readFileSync(filePath);
        return true;
    } catch {
        return false;
    }
}

export function makeStubComponent(name, { renderSlot = false } = {}) {
    return defineComponent({
        name,
        setup(_props, { slots }) {
            return renderSlot
                ? () => h('div', null, slots.default?.())
                : () => null;
        },
    });
}

export const renderer = createRenderer({
    patchProp(el, key, _prev, next) {
        el.props[key] = next;
    },
    insert(child, parent) {
        parent.children ||= [];
        parent.children.push(child);
        child.parent = parent;
    },
    remove(child) {
        const siblings = child.parent?.children;
        if (!siblings) return;
        const index = siblings.indexOf(child);
        if (index >= 0) siblings.splice(index, 1);
    },
    createElement(type) {
        return {
            type,
            props: {},
            children: [],
            listeners: {},
            // `v-show` is a runtime-dom directive: it reads and writes
            // `el.style.display` directly, so a node without a style object
            // makes any component that uses it fail to mount here.
            style: {},
            addEventListener(event, handler) {
                this.listeners[event] = handler;
            },
            removeEventListener(event) {
                delete this.listeners[event];
            },
            getRootNode() {
                return null;
            },
            // Components that manage focus (BaseModal) call these on the real
            // DOM nodes they hold refs to; without them mounting such a
            // component throws inside a watcher rather than failing visibly.
            querySelector() {
                return null;
            },
            querySelectorAll() {
                return [];
            },
            focus() {},
            contains() {
                return false;
            },
        };
    },
    createText(text) {
        return { type: '#text', text };
    },
    createComment(text) {
        return { type: '#comment', text };
    },
    setText(node, text) {
        node.text = text;
    },
    setElementText(node, text) {
        node.children = [{ type: '#text', text, parent: node }];
    },
    parentNode(node) {
        return node.parent || null;
    },
    nextSibling(node) {
        const siblings = node.parent?.children || [];
        return siblings[siblings.indexOf(node) + 1] || null;
    },
    querySelector() {
        return { type: 'teleport-target', props: {}, children: [] };
    },
});

export function mount(Component, renderProps) {
    const root = { type: 'root', children: [] };
    const app = renderer.createApp({
        setup() {
            return () => h(Component, renderProps());
        },
    });
    app.mount(root);
    return { root, unmount: () => app.unmount() };
}

export function textContent(node) {
    if (!node) return '';
    if (node.type === '#text') return node.text || '';
    return (node.children || []).map(textContent).join('');
}

export function findFirst(node, predicate) {
    if (predicate(node)) return node;
    for (const child of node.children || []) {
        const found = findFirst(child, predicate);
        if (found) return found;
    }
    return null;
}

export function allText(root) {
    return textContent(root).replace(/\s+/g, ' ').trim();
}

/** The globals a component reaches for that Bun does not provide. */
export function installDomGlobals() {
    // `window` has to dispatch events (`kivarion:before-lock`) and answer
    // `innerWidth` (the resizable columns clamp against it), so it is an
    // `EventTarget` rather than a bag of properties.
    if (typeof globalThis.window?.addEventListener !== 'function') {
        const target = new EventTarget();
        // `generatePassword` reads `window.crypto`; Bun exposes Web Crypto on
        // globalThis but has no `window`.
        target.crypto = globalThis.crypto;
        target.innerWidth = 1400;
        globalThis.window = target;
    }
    globalThis.Document = class Document {};
    globalThis.ShadowRoot = class ShadowRoot {};
    globalThis.document = {
        addEventListener() {},
        removeEventListener() {},
    };
}
