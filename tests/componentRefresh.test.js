import { beforeEach, describe, expect, test } from 'bun:test';
import { markRaw, nextTick, reactive, ref } from 'vue';
import {
    allText,
    findFirst,
    installDomGlobals,
    loadVueComponent,
    makeStubComponent,
    mount,
    textContent,
} from './helpers/vueSfc.js';

let currentStore;

/**
 * A `vue` stub whose `<transition>` renders its slot and nothing else.
 *
 * The real one comes from runtime-dom and drives its enter/leave phases through
 * `classList`, `requestAnimationFrame` and `ownerDocument` — none of which the
 * fake elements below have. Animations are not what any of these tests are
 * about, so the component under test gets a pass-through instead.
 */
async function vueWithoutTransitions() {
    const vue = await import('vue');
    return {
        ...vue,
        Transition: {
            name: 'TransitionStub',
            // The real one consumes `name`; without this it is reported as a
            // stray attribute on every render.
            inheritAttrs: false,
            setup:
                (_props, { slots }) =>
                () =>
                    slots.default?.(),
        },
    };
}

beforeEach(() => {
    currentStore = reactive({ dbVersion: 0 });
    installDomGlobals();
});

// Records the props a child was rendered with, so a test can assert what the
// parent decided instead of re-rendering the child's markup.
function makePropCapturingStub(name, props, sink) {
    // Declaring the props is what makes Vue camelize `:email-field` for us.
    return {
        name,
        props,
        setup(componentProps) {
            sink(componentProps);
            return () => null;
        },
    };
}

// Finds a labelled item of an open dropdown menu, in either the entry's header
// or the database header — both render `.menu-item` buttons.
function menuItem(root, label) {
    return findFirst(
        root,
        (node) =>
            String(node.props?.class || '').includes('menu-item') &&
            allText(node).includes(label),
    );
}

// Filled by the useClipboard stub below; reset by the tests that inspect it.
const clipboardCalls = [];

function entryDetailStubs(overrides = {}) {
    return {
        '../store': { useStore: () => currentStore },
        '../composables/usePlatform': {
            usePlatform: () => ({ isMac: ref(false) }),
        },
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
                totalAttachmentsSize: ref(0),
                pendingLargeAttachment: ref(null),
                confirmLargeAttachment() {},
                cancelLargeAttachment() {},
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
        '../composables/useClipboard': {
            useClipboard: () => ({
                activeCopyField: ref(null),
                copy: (...args) => {
                    clipboardCalls.push(args);
                    return true;
                },
            }),
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
        ...overrides,
    };
}

describe('component refresh behaviour', () => {
    test('EntryDetail refreshes raw entry fields when store.dbVersion changes', async () => {
        const EntryDetail = await loadVueComponent(
            'src/components/EntryDetail.vue',
            entryDetailStubs(),
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

    // The dropdown lives inside a `<transition>`, so the pass-through stub is
    // what makes an opened menu observable here at all.
    async function mountEntryWithMenu(entry) {
        const EntryDetail = await loadVueComponent(
            'src/components/EntryDetail.vue',
            entryDetailStubs({ vue: await vueWithoutTransitions() }),
        );
        const { root } = mount(EntryDetail, () => ({ entry }));
        await nextTick();

        findFirst(root, (node) => node.props?.class === 'menu-trigger')
            // `@click.stop`, so the handler calls this on what it is given.
            .props.onClick({ stopPropagation: () => {} });
        await nextTick();
        return root;
    }

    // The Title row used to sit in EntryViewFields, repeating the heading
    // verbatim. It is gone; the heading carries the full-text tooltip (the h2
    // truncates with an ellipsis) and copying it lives in the header's menu —
    // rare next to the username and password, which have their own buttons.
    test('EntryDetail copies the title from its menu, and never as a secret', async () => {
        clipboardCalls.length = 0;
        const entry = markRaw({
            fields: new Map([['Title', 'Microsoft account']]),
        });
        const root = await mountEntryWithMenu(entry);

        expect(findFirst(root, (node) => node.type === 'h2').props.title).toBe(
            'Microsoft account',
        );

        menuItem(root, 'Copy Title').props.onClick();

        // A title is not a secret: copying it must not arm the clipboard
        // auto-clear, or pasting it later hands the user an empty clipboard.
        expect(clipboardCalls).toEqual([['Microsoft account', 'Title']]);
    });

    test('EntryDetail offers no title copy for an untitled entry', async () => {
        const entry = markRaw({ fields: new Map([['UserName', 'user']]) });
        const root = await mountEntryWithMenu(entry);

        // The heading falls back to a placeholder; copying "No title" or
        // showing it as a tooltip would both be nonsense.
        expect(textContent(findFirst(root, (node) => node.type === 'h2'))).toBe(
            'No title',
        );
        expect(
            findFirst(root, (node) => node.type === 'h2').props.title,
        ).toBeFalsy();
        expect(menuItem(root, 'Copy Title')).toBe(null);
    });

    test('EntryDetail shows an e-mail custom field with the main fields, not twice', async () => {
        let viewProps;
        let customProps;
        const EntryDetail = await loadVueComponent(
            'src/components/EntryDetail.vue',
            entryDetailStubs({
                './entry-detail/EntryViewFields.vue': {
                    default: makePropCapturingStub(
                        'EntryViewFields',
                        ['entry', 'emailField'],
                        (props) => (viewProps = props),
                    ),
                },
                './entry-detail/EntryCustomFields.vue': {
                    default: makePropCapturingStub(
                        'EntryCustomFields',
                        ['isEditing', 'fields'],
                        (props) => (customProps = props),
                    ),
                },
            }),
        );

        const entry = markRaw({
            fields: new Map([
                ['Title', 'Mailbox'],
                ['UserName', 'user'],
                ['E-mail', 'user@example.com'],
                ['Recovery code', '123456'],
            ]),
        });
        mount(EntryDetail, () => ({ entry }));
        await nextTick();

        expect(viewProps.emailField).toEqual({
            key: 'E-mail',
            value: 'user@example.com',
            protected: false,
        });
        expect(customProps.fields.map((field) => field.key)).toEqual([
            'Recovery code',
        ]);
    });

    test('EntryDetail leaves a protected e-mail field in the custom section', async () => {
        let viewProps;
        let customProps;
        const EntryDetail = await loadVueComponent(
            'src/components/EntryDetail.vue',
            entryDetailStubs({
                './entry-detail/EntryViewFields.vue': {
                    default: makePropCapturingStub(
                        'EntryViewFields',
                        ['entry', 'emailField'],
                        (props) => (viewProps = props),
                    ),
                },
                './entry-detail/EntryCustomFields.vue': {
                    default: makePropCapturingStub(
                        'EntryCustomFields',
                        ['isEditing', 'fields'],
                        (props) => (customProps = props),
                    ),
                },
            }),
        );

        // Masking and the reveal button live in the custom-field section, so a
        // protected value must not be lifted into the always-visible group.
        const entry = markRaw({
            fields: new Map([
                ['Title', 'Mailbox'],
                ['Email', { getText: () => 'user@example.com' }],
            ]),
        });
        mount(EntryDetail, () => ({ entry }));
        await nextTick();

        expect(viewProps.emailField).toBeNull();
        expect(customProps.fields.map((field) => field.key)).toEqual(['Email']);
    });

    test('DatabaseSettingsModal exposes verification progress and inline errors', async () => {
        const DatabaseSettingsModal = await loadVueComponent(
            'src/components/DatabaseSettingsModal.vue',
            {
                './BaseModal.vue': {
                    default: makeStubComponent('BaseModal', {
                        renderSlot: true,
                    }),
                },
                './PasswordStrength.vue': {
                    default: makeStubComponent('PasswordStrength'),
                },
                '@tauri-apps/api/core': { invoke: async () => null },
                '../composables/useSystemInteraction.js': {
                    withSystemInteraction: (action) => action(),
                },
            },
        );
        const state = reactive({
            show: false,
            busy: false,
            error: '',
        });
        const { root } = mount(DatabaseSettingsModal, () => ({
            show: state.show,
            dbName: 'Vault',
            keyFilePath: null,
            busy: state.busy,
            error: state.error,
        }));

        state.show = true;
        state.busy = true;
        state.error = 'Current password or key file is incorrect.';
        await nextTick();

        expect(allText(root)).toContain('Verifying…');
        expect(allText(root)).toContain(
            'Current password or key file is incorrect.',
        );
        expect(
            findFirst(root, (node) => node.props?.class === 'confirm-btn')
                ?.props.disabled,
        ).toBe(true);
        expect(
            findFirst(root, (node) => node.props?.class === 'cancel-btn')?.props
                .disabled,
        ).toBe(true);

        state.busy = false;
        await nextTick();

        expect(allText(root)).toContain('Save Changes');
        expect(
            findFirst(root, (node) => node.props?.class === 'confirm-btn')
                ?.props.disabled,
        ).toBe(false);
    });

    // Not a refresh test, but it needs the same lightweight renderer: the bug it
    // pins lived in which options the parent passed down, not in the composable.
    test('EntryViewFields only auto-clears the clipboard for the password', async () => {
        const copies = [];
        const EntryViewFields = await loadVueComponent(
            'src/components/entry-detail/EntryViewFields.vue',
            {
                '@tauri-apps/plugin-opener': { openUrl: async () => {} },
                '../../composables/useClipboard': {
                    useClipboard: () => ({
                        activeCopyField: ref(null),
                        copy: (_text, fieldId, options) => {
                            copies.push({
                                fieldId,
                                autoClear: options.autoClear,
                            });
                            return true;
                        },
                    }),
                },
            },
        );

        const entry = markRaw({
            fields: new Map([
                ['Title', 'Mailbox'],
                ['UserName', 'user'],
                ['Password', 'secret'],
                ['URL', 'https://example.com'],
                ['Notes', 'a note'],
            ]),
        });
        const { root } = mount(EntryViewFields, () => ({
            entry,
            emailField: {
                key: 'E-mail',
                value: 'user@example.com',
                protected: false,
            },
        }));
        await nextTick();

        for (const label of [
            'username',
            'e-mail',
            'password',
            'url',
            'notes',
        ]) {
            findFirst(
                root,
                (node) => node.props?.title === `Copy ${label}`,
            ).props.onClick();
        }

        // Only the password is a secret. Arming the auto-clear for the others
        // emptied the clipboard under a user who had copied a URL or a login to
        // paste later on.
        expect(copies).toEqual([
            { fieldId: 'UserName', autoClear: false },
            { fieldId: 'E-mail', autoClear: false },
            { fieldId: 'Password', autoClear: true },
            { fieldId: 'URL', autoClear: false },
            { fieldId: 'Notes', autoClear: false },
        ]);
    });

    // The entry's URL is handed to the operating system, so what reaches
    // `openUrl` — and what never gets a link at all — is a security boundary,
    // not only a UX detail.
    async function mountUrlField(url, { openUrl } = {}) {
        const opened = [];
        const EntryViewFields = await loadVueComponent(
            'src/components/entry-detail/EntryViewFields.vue',
            {
                '@tauri-apps/plugin-opener': {
                    openUrl:
                        openUrl ??
                        (async (href) => {
                            opened.push(href);
                        }),
                },
                '../../composables/useClipboard': {
                    useClipboard: () => ({
                        activeCopyField: ref(null),
                        copy: () => true,
                    }),
                },
            },
        );

        const entry = markRaw({
            fields: new Map([
                ['Title', 'Site'],
                ['URL', url],
            ]),
        });
        const { root } = mount(EntryViewFields, () => ({ entry }));
        await nextTick();

        const link = findFirst(root, (node) => node.type === 'a');
        return { root, link, opened };
    }

    test('EntryViewFields opens the entry URL through the OS instead of navigating', async () => {
        const { link, opened } = await mountUrlField('example.com');

        expect(link).not.toBeNull();
        // Left to the webview this does nothing at all on macOS, and on
        // Windows/Linux can navigate the app's own page to the site.
        expect(typeof link.props.onClick).toBe('function');

        let defaultPrevented = false;
        link.props.onClick({
            // Must return undefined, like the real one: Vue's `.prevent`
            // modifier treats a truthy guard result as "stop here" and would
            // never reach the handler.
            preventDefault: () => {
                defaultPrevented = true;
            },
        });
        await nextTick();

        expect(defaultPrevented).toBe(true);
        // The normalized URL, not the raw field text.
        expect(opened).toEqual(['https://example.com/']);
    });

    test('EntryViewFields keeps the link reachable without opener-window access', async () => {
        const { link } = await mountUrlField('https://example.com/login');

        // `href` stays for accessibility and the context menu even though the
        // click is intercepted; `noreferrer` goes with `noopener`.
        expect(link.props.href).toBe('https://example.com/login');
        expect(link.props.rel).toBe('noopener noreferrer');
    });

    test('EntryViewFields never hands a non-http scheme to the OS', async () => {
        for (const url of [
            'javascript:alert(1)',
            'file:///etc/passwd',
            'smb://server/share',
            'data:text/html,<script>x</script>',
        ]) {
            const { root, link, opened } = await mountUrlField(url);

            // `normalizeHttpUrl` rejects these, so there is no anchor to click
            // and nothing can reach `openUrl` — the value is shown as text.
            expect(link).toBeNull();
            expect(opened).toEqual([]);
            expect(allText(root)).toContain(url);
        }
    });

    test('EntryViewFields reports a link it could not open', async () => {
        const { root, link } = await mountUrlField('example.com', {
            openUrl: async () => {
                throw new Error('no handler for https');
            },
        });

        link.props.onClick({ preventDefault: () => {} });
        await nextTick();
        await nextTick();

        // Replacing a silently dead link with a silently failing one would be
        // no improvement.
        expect(allText(root)).toContain('Could not open this link');
    });

    // GroupTree used to write straight into the object it was handed, which
    // only worked because the parent happened to deep-watch a ref holding it.
    async function mountTree(collapsedGroups = {}, extraProps = {}) {
        const GroupTree = await loadVueComponent(
            'src/components/GroupTree.vue',
        );
        const state = reactive({ collapsed: collapsedGroups });
        const updates = [];
        const { root } = mount(GroupTree, () => ({
            ...extraProps,
            groups: [
                {
                    uuid: 'group-1',
                    name: 'Parent',
                    entryCount: 0,
                    recursiveEntryCount: 1,
                    children: [
                        {
                            uuid: 'group-2',
                            name: 'Child',
                            entryCount: 1,
                            children: [],
                        },
                    ],
                },
            ],
            selectedGroupUuid: 'group-1',
            allEntriesCount: 1,
            refreshKey: 0,
            collapsedGroups: state.collapsed,
            'onUpdate:collapsedGroups': (value) => {
                updates.push(value);
                state.collapsed = value;
            },
        }));
        await nextTick();

        // The collapse chevron of that row, not the row itself — clicking the
        // row selects the group.
        const row = findFirst(
            root,
            (n) => n.props?.['data-group-uuid'] === 'group-1',
        );
        const chevron = findFirst(row, (n) =>
            String(n.props?.class || '').includes('collapse-toggle'),
        );
        const toggle = () =>
            chevron.props.onClick({
                // Both must return undefined like the real DOM methods: Vue's
                // `.stop` modifier treats a truthy guard result as "stop here"
                // and would never reach the handler.
                stopPropagation: () => {},
                target: {},
            });
        return { root, state, updates, toggle };
    }

    // Which rows carry a chevron is the tree's only answer to "can this be
    // expanded?". The row's icon used to be it — and stopped saying anything
    // the moment a group was given a custom icon, which the icon picker made
    // ordinary.
    function slotOf(root, uuid) {
        const row = findFirst(
            root,
            (n) => n.props?.['data-group-uuid'] === uuid,
        );
        return findFirst(row, (n) =>
            String(n.props?.class || '').includes('collapse-'),
        );
    }

    test('GroupTree marks expandable rows and still reserves the slot on leaves', async () => {
        const { root } = await mountTree();

        expect(String(slotOf(root, 'group-1').props.class)).toContain(
            'collapse-toggle',
        );
        // A leaf keeps the box but not the chevron: without the reserved slot
        // its icon would sit a chevron's width left of its siblings'.
        const leaf = slotOf(root, 'group-2');
        expect(String(leaf.props.class)).toContain('collapse-spacer');
        expect(leaf.props.onClick).toBeUndefined();
        // "All Entries" is a UI row with nothing under it, and is aligned the
        // same way.
        expect(String(slotOf(root, 'all').props.class)).toContain(
            'collapse-spacer',
        );
    });

    test('GroupTree counts only entries directly inside each group', async () => {
        const { root } = await mountTree();
        const parent = findByProp(root, 'data-group-uuid', 'group-1');
        const badge = findFirst(parent, (node) =>
            String(node.props?.class || '').includes('group-badge'),
        );

        // The parent has one entry below it, but none directly inside it; zero
        // is omitted rather than adding noise to every empty group row.
        expect(badge).toBeNull();
    });

    test('GroupTree leaves the group icon inert so a click on it selects', async () => {
        const { root } = await mountTree();
        const row = findFirst(
            root,
            (n) => n.props?.['data-group-uuid'] === 'group-1',
        );

        // The icon carried the collapse handler, so clicking a group's icon
        // toggled its branch instead of selecting it — the one part of the row
        // that did not do what the rest of the row does.
        const icon = findFirst(row, (n) =>
            String(n.props?.class || '').includes('group-icon'),
        );
        expect(icon).not.toBeNull();
        expect(icon.props.onClick).toBeUndefined();
    });

    test('GroupTree reports collapse changes instead of mutating the map it was given', async () => {
        const original = {};
        const { state, updates, toggle } = await mountTree(original);

        toggle();
        await nextTick();

        expect(updates).toHaveLength(1);
        expect(state.collapsed).toEqual({ 'group-1': true });
        // The parent's object is untouched: it owns it and persists it.
        expect(original).toEqual({});
        expect(updates[0]).not.toBe(original);
    });

    test('GroupTree drops a uuid on expand rather than storing it as false', async () => {
        const { state, toggle } = await mountTree({ 'group-1': true });

        toggle();
        await nextTick();

        // Storing `false` is what made the per-database record grow for every
        // group the user ever touched.
        expect(state.collapsed).toEqual({});
    });

    // --- Dropping an entry on a group -------------------------------------
    //
    // The drag data store is in *protected mode* for the whole drag: only
    // `dataTransfer.types` is readable, and `getData` returns an empty string
    // until the drop. `GroupNode` used to decide with `getData`, so it never
    // recognised an entry drag, never called `preventDefault()` in `dragover`,
    // and the browser therefore refused the drop — `drop` never fired and an
    // entry could not be moved into a group by dragging at all.
    const ENTRY_DRAG_TYPE = 'application/x-kivarion-entry';

    function dragEvent({ types = [], data = {} } = {}) {
        const event = {
            prevented: false,
            preventDefault() {
                this.prevented = true;
            },
            currentTarget: {
                getBoundingClientRect: () => ({ top: 0, height: 37 }),
            },
            clientY: 18,
            dataTransfer: {
                dropEffect: 'none',
                types,
                getData: (type) => data[type] ?? '',
            },
        };
        return event;
    }

    async function mountTreeForDrag() {
        const moves = [];
        const { root } = await mountTree(
            {},
            { onMoveEntry: (payload) => moves.push(payload) },
        );
        const row = findByProp(root, 'data-group-uuid', 'group-1');
        return { root, row, moves };
    }

    test('GroupNode allows a drop while only the drag types are readable', async () => {
        const { row } = await mountTreeForDrag();

        // Exactly what a real `dragover` offers: the type is listed, the value
        // is not there yet.
        const event = dragEvent({ types: [ENTRY_DRAG_TYPE, 'text/plain'] });
        row.props.onDragover(event);
        await nextTick();

        // Without `preventDefault()` the drop is refused and no `drop` event is
        // ever dispatched.
        expect(event.prevented).toBe(true);
        expect(event.dataTransfer.dropEffect).toBe('move');
        expect(String(row.props.class)).toContain('drag-over-inside');
    });

    test('GroupNode moves the entry the drop actually carries', async () => {
        const { row, moves } = await mountTreeForDrag();

        const over = dragEvent({ types: [ENTRY_DRAG_TYPE, 'text/plain'] });
        row.props.onDragover(over);
        // `drop` is only dispatched on a target that allowed it, so the two
        // handlers have to agree about what counts as an entry drag.
        expect(over.prevented).toBe(true);

        // On drop the store becomes readable, so the uuid arrives here.
        row.props.onDrop(
            dragEvent({
                types: [ENTRY_DRAG_TYPE, 'text/plain'],
                data: { [ENTRY_DRAG_TYPE]: 'entry-7' },
            }),
        );
        await nextTick();

        expect(moves).toEqual([
            { entryUuid: 'entry-7', targetGroupUuid: 'group-1' },
        ]);
        expect(String(row.props.class)).not.toContain('drag-over-inside');
    });

    test('GroupNode refuses an entry drop on "All Entries"', async () => {
        const { root, moves } = await mountTreeForDrag();
        // The pseudo-group is not a real group and holds no entries of its own.
        const row = findFirst(
            root,
            (node) =>
                String(node.props?.class || '').includes('group-node') &&
                allText(node).includes('All Entries'),
        );

        const event = dragEvent({ types: [ENTRY_DRAG_TYPE] });
        row.props.onDragover(event);
        row.props.onDrop(
            dragEvent({
                types: [ENTRY_DRAG_TYPE],
                data: { [ENTRY_DRAG_TYPE]: 'entry-7' },
            }),
        );
        await nextTick();

        expect(event.prevented).toBe(false);
        expect(moves).toEqual([]);
    });

    test('GroupNode ignores a drag that carries no entry', async () => {
        const { row } = await mountTreeForDrag();

        // A file dragged in from the Finder, say. No group drag is in progress
        // either, so nothing should accept it.
        const event = dragEvent({ types: ['Files'] });
        row.props.onDragover(event);
        await nextTick();

        expect(event.prevented).toBe(false);
        expect(String(row.props.class)).not.toContain('drag-over-inside');
    });

    // --- Secrets must not outlive the dialog that collected them ----------
    //
    // Both of these components stay mounted for as long as the database is
    // open — only the modal's contents come and go — so a password left in a
    // ref after Cancel stayed reachable for the whole session. The `BaseModal`
    // stub renders its slot unconditionally, which is what makes the closed
    // state observable here at all.

    // `v-model` on a native input goes through the `vModelText` directive: it
    // writes `el.value` (not a prop) and listens for `input`, reading `el.value`
    // back off the element. So typing means setting the value and firing that.
    function typeInto(input, text) {
        input.value = text;
        input.listeners.input({ target: input });
    }

    function findByProp(root, prop, value) {
        return findFirst(root, (node) => node.props?.[prop] === value);
    }

    // Event handlers land in `props` (the renderer's `patchProp` keeps every
    // prop there); only directives such as `v-model` go through
    // `addEventListener` and end up in `listeners`.
    function clickConfirm(root) {
        findByProp(root, 'class', 'confirm-btn')?.props?.onClick?.();
    }

    test('DatabaseSettingsModal drops the typed passwords when it closes', async () => {
        const DatabaseSettingsModal = await loadVueComponent(
            'src/components/DatabaseSettingsModal.vue',
            {
                './BaseModal.vue': {
                    default: makeStubComponent('BaseModal', {
                        renderSlot: true,
                    }),
                },
                './PasswordStrength.vue': {
                    default: makeStubComponent('PasswordStrength'),
                },
                '@tauri-apps/api/core': { invoke: async () => null },
                '../composables/useSystemInteraction.js': {
                    withSystemInteraction: (action) => action(),
                },
            },
        );
        const state = reactive({ show: false });
        const { root } = mount(DatabaseSettingsModal, () => ({
            show: state.show,
            dbName: 'Vault',
            keyFilePath: null,
            busy: false,
            error: '',
        }));

        state.show = true;
        await nextTick();
        const newPassword = findByProp(root, 'placeholder', 'New password');
        typeInto(newPassword, 'new-master-password');
        await nextTick();
        // The current-password field only appears once a change is pending.
        typeInto(
            findByProp(root, 'placeholder', 'Current password'),
            'old-master-password',
        );
        await nextTick();

        expect(newPassword.value).toBe('new-master-password');

        // Cancel.
        state.show = false;
        await nextTick();

        // This input is unconditional, so the same element is still there.
        expect(newPassword.value).toBe('');

        // The current-password field is conditional and unmounted itself once
        // the new password was cleared, so ask for it again the way a user
        // would: reopen and start another change.
        state.show = true;
        await nextTick();
        typeInto(
            findByProp(root, 'placeholder', 'New password'),
            'another-password',
        );
        await nextTick();

        expect(findByProp(root, 'placeholder', 'Current password').value).toBe(
            '',
        );
    });

    test('DatabaseSettingsModal accepts a key-file-only database without a current password', async () => {
        // A database can be unlocked with a key file alone, and then there is
        // no current password to confirm with. Demanding one made the settings
        // dialog impossible to submit for such a vault.
        const DatabaseSettingsModal = await loadVueComponent(
            'src/components/DatabaseSettingsModal.vue',
            {
                './BaseModal.vue': {
                    default: makeStubComponent('BaseModal', {
                        renderSlot: true,
                    }),
                },
                './PasswordStrength.vue': {
                    default: makeStubComponent('PasswordStrength'),
                },
                '@tauri-apps/api/core': { invoke: async () => null },
                '../composables/useSystemInteraction.js': {
                    withSystemInteraction: (action) => action(),
                },
            },
        );

        // Opening is what seeds the local form state, so `show` has to change.
        async function openWith(keyFilePath) {
            const confirmed = [];
            const state = reactive({ show: false });
            const { root } = mount(DatabaseSettingsModal, () => ({
                show: state.show,
                dbName: 'Vault',
                keyFilePath,
                busy: false,
                error: '',
                onConfirm: (payload) => confirmed.push(payload),
            }));
            state.show = true;
            await nextTick();

            typeInto(
                findByProp(root, 'placeholder', 'New password'),
                'new-secret',
            );
            await nextTick();
            typeInto(
                findByProp(root, 'placeholder', 'Repeat new password'),
                'new-secret',
            );
            await nextTick();

            clickConfirm(root);
            await nextTick();
            return { confirmed, root };
        }

        const keyed = await openWith('/Users/me/vault.key');
        expect(keyed.confirmed).toHaveLength(1);
        expect(keyed.confirmed[0]).toMatchObject({
            password: 'new-secret',
            currentPassword: '',
        });

        // With no key file either, nothing would identify the holder, so the
        // current password stays required.
        const unkeyed = await openWith(null);
        expect(unkeyed.confirmed).toHaveLength(0);
        expect(allText(unkeyed.root)).toContain(
            'Enter the current password to change credentials.',
        );
    });

    test('PasswordGenerator hands over the password it generated, then forgets it', async () => {
        const PasswordGenerator = await loadVueComponent(
            'src/components/entry-detail/PasswordGenerator.vue',
            {
                '../BaseModal.vue': {
                    default: makeStubComponent('BaseModal', {
                        renderSlot: true,
                    }),
                },
            },
        );
        const state = reactive({ show: false });
        const applied = [];
        const { root } = mount(PasswordGenerator, () => ({
            show: state.show,
            onApply: (password) => applied.push(password),
            onClose: () => (state.show = false),
        }));

        state.show = true;
        await nextTick();
        const preview = findFirst(root, (node) =>
            String(node.props?.class || '').includes('generated-password'),
        );
        const generated = allText(preview);
        expect(generated).toMatch(/^\S{20}$/);

        findByProp(root, 'class', 'apply-btn').props.onClick();
        await nextTick();

        // Clearing on close must not turn "Use Password" into an empty string.
        expect(applied).toEqual([generated]);
        // …and the generated value is gone from the still-mounted component.
        expect(allText(preview)).toBe('');
    });

    test('GroupTree follows the tree it is handed when the view model is rebuilt', async () => {
        // `buildDatabaseView` builds fresh nodes on every `dbVersion` change
        // and never mutates the ones it already handed out, so replacing them
        // is the only way this tree ever changes. GroupTree and GroupNode used
        // to take a `refreshKey` prop and read it for its side effect, which
        // suggested they were watching live kdbxweb objects — they are not, and
        // the nodes below are `markRaw` for the same reason.
        const GroupTree = await loadVueComponent(
            'src/components/GroupTree.vue',
        );
        const node = (name, entryCount) =>
            markRaw({ uuid: 'group-1', name, entryCount, children: [] });
        const state = reactive({ groups: [node('Old group', 1)] });
        const { root } = mount(GroupTree, () => ({
            groups: state.groups,
            selectedGroupUuid: 'group-1',
            allEntriesCount: 1,
        }));
        await nextTick();

        expect(allText(root)).toContain('Old group');
        expect(allText(root)).toContain('1');

        state.groups = [node('New group', 2)];
        await nextTick();

        expect(allText(root)).toContain('New group');
        expect(allText(root)).toContain('2');
    });
});

// The header used to line four bordered icon buttons up beside the search box,
// where "Close database" looked exactly as ordinary as "Lock". The three that
// act on the file now hang off its name in a menu, and Lock — frequent, and
// about safety — is the only button left.
describe('DatabaseHeader actions', () => {
    async function mountHeader() {
        const DatabaseHeader = await loadVueComponent(
            'src/components/DatabaseHeader.vue',
            {
                '../composables/usePlatform': {
                    usePlatform: () => ({ isMac: ref(true) }),
                },
            },
        );
        const emitted = [];
        const record = (name) => () => emitted.push(name);
        const { root } = mount(DatabaseHeader, () => ({
            dbName: 'Vault',
            filePath: '/Users/me/Vault.kdbx',
            search: '',
            onLock: record('lock'),
            onClose: record('close'),
            onEditDb: record('edit-db'),
            onSettings: record('settings'),
        }));
        await nextTick();
        return { root, emitted };
    }

    async function openMenu(root) {
        findFirst(root, (node) =>
            String(node.props?.class || '').includes('db-trigger'),
        ).props.onClick();
        await nextTick();
    }

    test('keeps Lock out of the menu and reachable in one click', async () => {
        const { root, emitted } = await mountHeader();

        expect(menuItem(root, 'Close Database')).toBe(null);
        const lock = findFirst(root, (node) =>
            String(node.props?.class || '').includes('lock-btn'),
        );
        lock.props.onClick();

        expect(emitted).toEqual(['lock']);
        // The shortcut is worded for the platform, ⌘ here.
        expect(lock.props.title).toBe('Lock database (⌘L)');
    });

    test('hangs the database-level actions off the database name', async () => {
        const { root, emitted } = await mountHeader();
        await openMenu(root);

        menuItem(root, 'Database Settings…').props.onClick();
        await nextTick();
        expect(emitted).toEqual(['edit-db']);

        // Choosing an item closes the menu, so each one needs it reopened.
        await openMenu(root);
        menuItem(root, 'App Settings…').props.onClick();
        await nextTick();
        expect(emitted).toEqual(['edit-db', 'settings']);

        await openMenu(root);
        menuItem(root, 'Close Database').props.onClick();
        await nextTick();
        expect(emitted).toEqual(['edit-db', 'settings', 'close']);

        expect(menuItem(root, 'Close Database')).toBe(null);
    });
});

// `BaseModal` is what keeps the app-wide open-modal count honest, and that
// count is what stops a global shortcut from acting on the page behind a
// dialog. The component is mounted for real here rather than the count being
// driven by hand, because the bug this guards against is the registration
// going out of step with `show` — which only the component can get wrong.
describe('BaseModal open-modal accounting', () => {
    let modalState;

    beforeEach(async () => {
        modalState = await import('../src/modalState.js');
        modalState.resetModalState();
    });

    async function mountModal() {
        const BaseModal = await loadVueComponent(
            'src/components/BaseModal.vue',
        );
        const show = ref(false);
        const mounted = mount(BaseModal, () => ({ show: show.value }));
        await nextTick();
        return { ...mounted, show };
    }

    test('counts a dialog only while it is showing', async () => {
        const { show, unmount } = await mountModal();
        expect(modalState.isAnyModalOpen()).toBe(false);

        show.value = true;
        await nextTick();
        expect(modalState.isAnyModalOpen()).toBe(true);

        show.value = false;
        await nextTick();
        expect(modalState.isAnyModalOpen()).toBe(false);

        unmount();
    });

    test('releases the count when auto-lock unmounts an open dialog', async () => {
        // Locking tears down the whole page subtree, so `show` never turns
        // false on the way out. Without the unmount hook the count would stay
        // raised for the rest of the session and every shortcut would be dead.
        const { show, unmount } = await mountModal();
        show.value = true;
        await nextTick();
        expect(modalState.isAnyModalOpen()).toBe(true);

        unmount();
        await nextTick();
        expect(modalState.isAnyModalOpen()).toBe(false);
    });

    test('counts the attachment preview, which is not a BaseModal', async () => {
        // The preview owns its own full-window frame instead of rendering
        // through BaseModal, and so went uncounted: DatabasePage's global
        // shortcuts kept firing behind it, and Cmd+C put the entry's password
        // on the clipboard where the user could not see it happen.
        const AttachmentPreviewModal = await loadVueComponent(
            'src/components/entry-detail/AttachmentPreviewModal.vue',
            { vue: await vueWithoutTransitions() },
        );
        const show = ref(false);
        const { unmount } = mount(AttachmentPreviewModal, () => ({
            show: show.value,
            name: 'report.pdf',
            url: 'blob:preview',
        }));
        await nextTick();
        expect(modalState.isAnyModalOpen()).toBe(false);

        show.value = true;
        await nextTick();
        expect(modalState.isAnyModalOpen()).toBe(true);

        show.value = false;
        await nextTick();
        expect(modalState.isAnyModalOpen()).toBe(false);

        // Auto-lock unmounts the subtree with the preview still open.
        show.value = true;
        await nextTick();
        unmount();
        await nextTick();
        expect(modalState.isAnyModalOpen()).toBe(false);
    });

    test('does not double-count repeated truthy updates of show', async () => {
        const BaseModal = await loadVueComponent(
            'src/components/BaseModal.vue',
        );
        const props = ref({ show: true, ariaLabel: 'first' });
        const { unmount } = mount(BaseModal, () => props.value);
        await nextTick();
        expect(modalState.isAnyModalOpen()).toBe(true);

        // A re-render that leaves `show` true must not register a second time,
        // or closing the dialog would leave the count stuck above zero.
        props.value = { show: true, ariaLabel: 'second' };
        await nextTick();

        unmount();
        await nextTick();
        expect(modalState.isAnyModalOpen()).toBe(false);
    });
});
