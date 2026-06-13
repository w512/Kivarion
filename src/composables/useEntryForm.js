import { ref, watch } from 'vue';
import * as kdbxweb from 'kdbxweb';
import { getField } from '../utils';

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

    function loadForm() {
        form.value = {
            Title: getField(props.entry, 'Title'),
            UserName: getField(props.entry, 'UserName'),
            Password: getField(props.entry, 'Password'),
            URL: getField(props.entry, 'URL'),
            Notes: getField(props.entry, 'Notes'),
            CustomFields: customFields.value.map(f => ({ ...f })),
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
        const needsIcon = form.value.URL && (!entry.customIcon || getField(entry, 'URL') !== form.value.URL);

        entry.pushHistory();
        entry.fields.set('Title', form.value.Title);
        entry.fields.set('UserName', form.value.UserName);
        entry.fields.set('Password', kdbxweb.ProtectedValue.fromString(form.value.Password));
        entry.fields.set('URL', form.value.URL);
        entry.fields.set('Notes', form.value.Notes);

        const standardFields = ['Title', 'UserName', 'Password', 'URL', 'Notes'];
        const newKeys = new Set(form.value.CustomFields.map(f => f.key));
        
        // Remove old custom fields not present in form
        for (const [key] of entry.fields) {
            if (!standardFields.includes(key) && !newKeys.has(key)) {
                entry.fields.delete(key);
            }
        }
        
        // Add/Update fields from form
        for (const field of form.value.CustomFields) {
            if (field.key) {
                entry.fields.set(field.key, field.value);
            }
        }

        entry.times.update();
        isEditing.value = false;
        emit('updated');
        
        if (needsIcon && downloadIconCallback) {
            downloadIconCallback(entry);
        }
    }

    return {
        isEditing,
        form,
        startEdit,
        cancelEdit,
        saveEdit
    };
}
