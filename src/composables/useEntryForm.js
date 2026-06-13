import { ref, watch } from 'vue';
import * as kdbxweb from 'kdbxweb';
import { getField, STANDARD_FIELDS } from '../utils';

export function useEntryForm(props, emit, customFields, downloadIconCallback) {
    const isEditing = ref(false);
    const form = ref({
        Title: '',
        UserName: '',
        Password: '',
        URL: '',
        Notes: '',
        CustomFields: [],
    });
    const formError = ref('');

    function loadForm() {
        formError.value = '';
        form.value = {
            Title: getField(props.entry, 'Title'),
            UserName: getField(props.entry, 'UserName'),
            Password: getField(props.entry, 'Password'),
            URL: getField(props.entry, 'URL'),
            Notes: getField(props.entry, 'Notes'),
            CustomFields: customFields.value.map(f => ({
                key: f.key,
                value: f.value ?? '',
                protected: !!f.protected,
            })),
        };
    }

    watch(() => props.entry?.uuid?.id, () => {
        isEditing.value = false;
        loadForm();
    }, { immediate: true });

    function startEdit() {
        loadForm();
        isEditing.value = true;
    }

    function cancelEdit() {
        isEditing.value = false;
        loadForm();
    }

    function saveEdit() {
        const entry = props.entry;
        const normalizedCustomFields = validateCustomFields();
        if (!normalizedCustomFields) return false;

        const needsIcon = form.value.URL && (!entry.customIcon || getField(entry, 'URL') !== form.value.URL);

        entry.pushHistory();
        entry.fields.set('Title', form.value.Title);
        entry.fields.set('UserName', form.value.UserName);
        entry.fields.set('Password', kdbxweb.ProtectedValue.fromString(form.value.Password));
        entry.fields.set('URL', form.value.URL);
        entry.fields.set('Notes', form.value.Notes);

        const newKeys = new Set(normalizedCustomFields.map(f => f.key));
        
        // Remove old custom fields not present in form
        for (const [key] of entry.fields) {
            if (!STANDARD_FIELDS.includes(key) && !newKeys.has(key)) {
                entry.fields.delete(key);
            }
        }
        
        // Add/Update fields from form
        for (const field of normalizedCustomFields) {
            entry.fields.set(
                field.key,
                field.protected
                    ? kdbxweb.ProtectedValue.fromString(field.value)
                    : field.value,
            );
        }

        entry.times.update();
        isEditing.value = false;
        emit('updated');
        
        if (needsIcon && downloadIconCallback) {
            downloadIconCallback(entry);
        }
        return true;
    }

    function validateCustomFields() {
        formError.value = '';
        const normalized = [];
        const seenKeys = new Set();

        for (const field of form.value.CustomFields) {
            const key = (field.key || '').trim();
            if (!key) continue;

            if (STANDARD_FIELDS.includes(key)) {
                formError.value = `“${key}” is a standard field and cannot be used as a custom field name.`;
                return null;
            }

            if (seenKeys.has(key)) {
                formError.value = `Custom field “${key}” is duplicated.`;
                return null;
            }

            seenKeys.add(key);
            normalized.push({
                key,
                value: field.value ?? '',
                protected: !!field.protected,
            });
        }

        return normalized;
    }

    return {
        isEditing,
        form,
        formError,
        startEdit,
        cancelEdit,
        saveEdit
    };
}
