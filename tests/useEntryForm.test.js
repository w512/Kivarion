import { describe, expect, mock, test } from 'bun:test';
import { ref } from 'vue';
import { useEntryForm } from '../src/composables/useEntryForm.js';

function makeEntry(fields = {}) {
    return {
        fields: new Map(Object.entries(fields)),
        times: { update: mock(() => {}) },
        pushHistory: mock(() => {}),
    };
}

function protectedValue(text) {
    return { getText: () => text };
}

describe('useEntryForm custom fields', () => {
    test('tracks dirty edit state and resets after cancel/save', () => {
        const entry = makeEntry({ Title: 'Entry' });
        const emit = mock(() => {});
        const customFields = ref([]);
        const form = useEntryForm({ entry }, emit, customFields);

        expect(form.isDirty.value).toBe(false);
        form.startEdit();
        expect(form.isDirty.value).toBe(false);

        form.form.value.Title = 'Changed';
        expect(form.isDirty.value).toBe(true);

        form.cancelEdit();
        expect(form.isDirty.value).toBe(false);

        form.startEdit();
        form.form.value.Title = 'Saved';
        expect(form.isDirty.value).toBe(true);
        expect(form.saveEdit()).toBe(true);
        expect(form.isDirty.value).toBe(false);
    });

    test('keeps empty custom field values instead of deleting them', () => {
        const entry = makeEntry({
            Title: 'Entry',
            EmptyCustom: '',
        });
        const emit = mock(() => {});
        const customFields = ref([{ key: 'EmptyCustom', value: '', protected: false }]);
        const form = useEntryForm({ entry }, emit, customFields);

        form.startEdit();
        const saved = form.saveEdit();

        expect(saved).toBe(true);
        expect(entry.fields.has('EmptyCustom')).toBe(true);
        expect(entry.fields.get('EmptyCustom')).toBe('');
        expect(emit).toHaveBeenCalledWith('updated');
    });

    test('preserves protected custom fields as ProtectedValue on save', () => {
        const entry = makeEntry({
            Title: 'Entry',
            SecretCustom: protectedValue('hidden'),
        });
        const emit = mock(() => {});
        const customFields = ref([{ key: 'SecretCustom', value: 'hidden', protected: true }]);
        const form = useEntryForm({ entry }, emit, customFields);

        form.startEdit();
        form.form.value.CustomFields[0].value = 'new hidden';
        const saved = form.saveEdit();

        const savedValue = entry.fields.get('SecretCustom');
        expect(saved).toBe(true);
        expect(typeof savedValue.getText).toBe('function');
        expect(savedValue.getText()).toBe('new hidden');
    });

    test('rejects custom fields that collide with standard field names', () => {
        const entry = makeEntry({ Title: 'Entry', Password: protectedValue('secret') });
        const emit = mock(() => {});
        const customFields = ref([{ key: ' password ', value: 'plain leak', protected: false }]);
        const form = useEntryForm({ entry }, emit, customFields);

        form.startEdit();
        const saved = form.saveEdit();

        expect(saved).toBe(false);
        expect(form.formError.value).toContain('standard field');
        expect(entry.pushHistory).not.toHaveBeenCalled();
        expect(entry.fields.get('Password').getText()).toBe('secret');
        expect(emit).not.toHaveBeenCalled();
    });

    test('rejects duplicate custom field names', () => {
        const entry = makeEntry({ Title: 'Entry' });
        const emit = mock(() => {});
        const customFields = ref([
            { key: 'ApiKey', value: 'one', protected: false },
            { key: ' apikey ', value: 'two', protected: true },
        ]);
        const form = useEntryForm({ entry }, emit, customFields);

        form.startEdit();
        const saved = form.saveEdit();

        expect(saved).toBe(false);
        expect(form.formError.value).toContain('duplicated');
        expect(entry.pushHistory).not.toHaveBeenCalled();
        expect(emit).not.toHaveBeenCalled();
    });
});
