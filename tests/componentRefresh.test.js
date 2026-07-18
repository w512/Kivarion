import { beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse, compileScript } from '@vue/compiler-sfc';
import {
    createRenderer,
    defineComponent,
    h,
    markRaw,
    nextTick,
    reactive,
    ref,
} from 'vue';

let currentStore;

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function importSpecToDestructure(spec) {
    return spec
        .split(',')
        .map((part) => {
            const [name, alias] = part.trim().split(/\s+as\s+/);
            return alias ? `${name.trim()}: ${alias.trim()}` : name.trim();
        })
        .join(', ');
}

async function loadVueComponent(filePath, stubs = {}) {
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

function readable(filePath) {
    try {
        readFileSync(filePath);
        return true;
    } catch {
        return false;
    }
}

function makeStubComponent(name) {
    return defineComponent({
        name,
        setup() {
            return () => null;
        },
    });
}

const renderer = createRenderer({
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
        return { type, props: {}, children: [] };
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

function mount(Component, renderProps) {
    const root = { type: 'root', children: [] };
    const app = renderer.createApp({
        setup() {
            return () => h(Component, renderProps());
        },
    });
    app.mount(root);
    return { root, unmount: () => app.unmount() };
}

function textContent(node) {
    if (!node) return '';
    if (node.type === '#text') return node.text || '';
    return (node.children || []).map(textContent).join('');
}

function findFirst(node, predicate) {
    if (predicate(node)) return node;
    for (const child of node.children || []) {
        const found = findFirst(child, predicate);
        if (found) return found;
    }
    return null;
}

function allText(root) {
    return textContent(root).replace(/\s+/g, ' ').trim();
}

beforeEach(() => {
    currentStore = reactive({ dbVersion: 0 });
    globalThis.document = {
        addEventListener() {},
        removeEventListener() {},
    };
});

describe('component refresh behaviour', () => {
    test('EntryDetail refreshes raw entry fields when store.dbVersion changes', async () => {
        const EntryDetail = await loadVueComponent(
            'src/components/EntryDetail.vue',
            {
                '../store': { useStore: () => currentStore },
                '@tauri-apps/plugin-os': { type: async () => 'linux' },
                './entry-detail/EntryViewFields.vue': {
                    default: makeStubComponent('EntryViewFields'),
                },
                './entry-detail/EntryEditFields.vue': {
                    default: makeStubComponent('EntryEditFields'),
                },
                './entry-detail/EntryCustomFields.vue': {
                    default: makeStubComponent('EntryCustomFields'),
                },
                './entry-detail/EntryAttachments.vue': {
                    default: makeStubComponent('EntryAttachments'),
                },
                './entry-detail/EntryMetadata.vue': {
                    default: makeStubComponent('EntryMetadata'),
                },
                './entry-detail/AttachmentPreviewModal.vue': {
                    default: makeStubComponent('AttachmentPreviewModal'),
                },
                '../composables/useEntryAttachments': {
                    useEntryAttachments: () => ({
                        attachments: ref([]),
                        attachmentThumbnails: ref({}),
                        showPreview: ref(false),
                        previewUrl: ref(''),
                        previewName: ref(''),
                        openPreview() {},
                        closePreview() {},
                        exportAttachment() {},
                        copyAttachmentName() {},
                    }),
                },
                '../composables/useEntryIcons': {
                    useEntryIcons: () => ({ downloadIcon() {} }),
                },
                '../composables/useEntryForm': {
                    useEntryForm: () => ({
                        isEditing: ref(false),
                        isDirty: ref(false),
                        form: reactive({ CustomFields: [] }),
                        formError: ref(''),
                        startEdit() {},
                        cancelEdit() {},
                        saveEdit: () => true,
                    }),
                },
            },
        );

        const entry = markRaw({
            fields: new Map([
                ['Title', 'Old title'],
                ['UserName', 'user'],
            ]),
        });
        const { root } = mount(EntryDetail, () => ({ entry }));
        await nextTick();

        expect(textContent(findFirst(root, (node) => node.type === 'h2'))).toBe(
            'Old title',
        );

        entry.fields.set('Title', 'New title');
        currentStore.dbVersion++;
        await nextTick();

        expect(textContent(findFirst(root, (node) => node.type === 'h2'))).toBe(
            'New title',
        );
    });

    test('GroupTree refreshes raw group labels and counts when refreshKey changes', async () => {
        const GroupTree = await loadVueComponent(
            'src/components/GroupTree.vue',
        );
        const group = markRaw({
            uuid: 'group-1',
            name: 'Old group',
            entryCount: 1,
            children: [],
        });
        const state = reactive({ refreshKey: 0 });
        const { root } = mount(GroupTree, () => ({
            groups: [group],
            selectedGroupUuid: 'group-1',
            allEntriesCount: 1,
            refreshKey: state.refreshKey,
        }));
        await nextTick();

        expect(allText(root)).toContain('Old group');
        expect(allText(root)).toContain('1');

        group.name = 'New group';
        group.entryCount = 2;
        state.refreshKey++;
        await nextTick();

        expect(allText(root)).toContain('New group');
        expect(allText(root)).toContain('2');
    });
});
