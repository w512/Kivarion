<template>
    <BaseModal
        :show="show"
        width="380px"
        labelledby="db-settings-title"
        @close="$emit('cancel')"
    >
        <div class="db-settings">
            <h3 id="db-settings-title">Database Settings</h3>

            <div class="form-group">
                <label>Database Name</label>
                <input
                    v-model="localName"
                    placeholder="Database name"
                    class="modal-input"
                    autofocus
                />
            </div>

            <div class="form-group">
                <label>Change Password (leave empty to keep current)</label>
                <div class="password-wrapper">
                    <input
                        v-model="localPassword"
                        :type="showPassword ? 'text' : 'password'"
                        placeholder="New password"
                        class="modal-input"
                    />
                    <button
                        type="button"
                        class="toggle-password"
                        :title="
                            showPassword ? 'Hide password' : 'Show password'
                        "
                        @click="showPassword = !showPassword"
                    >
                        <svg
                            v-if="showPassword"
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <path
                                d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"
                            ></path>
                            <line x1="1" y1="1" x2="23" y2="23"></line>
                        </svg>
                        <svg
                            v-else
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <path
                                d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"
                            ></path>
                            <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                    </button>
                </div>
            </div>

            <div v-if="hasPasswordChange" class="form-group">
                <label>Confirm New Password</label>
                <input
                    v-model="localPasswordConfirm"
                    :type="showPassword ? 'text' : 'password'"
                    placeholder="Repeat new password"
                    class="modal-input"
                />
                <p class="password-warning">
                    Make sure you remember this password. If it is lost, the
                    database cannot be recovered.
                </p>
            </div>

            <p v-if="settingsError" class="modal-error">
                {{ settingsError }}
            </p>

            <div class="modal-actions">
                <button class="confirm-btn" @click="handleConfirm">
                    Save Changes
                </button>
                <button class="cancel-btn" @click="$emit('cancel')">
                    Cancel
                </button>
            </div>
        </div>
    </BaseModal>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import BaseModal from './BaseModal.vue';

const props = defineProps({
    show: { type: Boolean, default: false },
    dbName: { type: String, default: '' },
});

const emit = defineEmits(['confirm', 'cancel']);

const localName = ref('');
const localPassword = ref('');
const localPasswordConfirm = ref('');
const settingsError = ref('');
const showPassword = ref(false);

const hasPasswordChange = computed(
    () =>
        localPassword.value.length > 0 || localPasswordConfirm.value.length > 0,
);

watch(
    () => props.show,
    (isShowing) => {
        if (isShowing) {
            localName.value = props.dbName;
            localPassword.value = '';
            localPasswordConfirm.value = '';
            settingsError.value = '';
            showPassword.value = false;
        }
    },
);

watch([localPassword, localPasswordConfirm], () => {
    settingsError.value = '';
});

function handleConfirm() {
    const password = localPassword.value;
    if (hasPasswordChange.value) {
        if (!password) {
            settingsError.value = 'Enter the new password first.';
            return;
        }
        if (password !== localPasswordConfirm.value) {
            settingsError.value = 'New passwords do not match.';
            return;
        }
    }

    emit('confirm', {
        name: localName.value.trim(),
        password,
    });
}
</script>

<style scoped>
.db-settings h3 {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0 0 1.5rem;
    text-align: center;
}

.form-group {
    margin-bottom: 1.25rem;
}

.form-group label {
    display: block;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-secondary);
    margin-bottom: 0.5rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

.modal-input {
    width: 100%;
    padding: 0.7rem 0.85rem;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: var(--input-bg);
    color: var(--text-primary);
    font-size: 0.9rem;
    outline: none;
    transition: all 0.2s;
    box-sizing: border-box;
}

.modal-input:focus {
    border-color: var(--accent-color);
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12);
}

.password-wrapper {
    position: relative;
}

.modal-input {
    padding-right: 2.5rem !important;
}

.toggle-password {
    position: absolute;
    right: 0.5rem;
    top: 50%;
    transform: translateY(-50%);
    background: none !important;
    border: none !important;
    color: var(--text-secondary) !important;
    padding: 0.4rem !important;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.6;
    transition: opacity 0.2s;
    box-shadow: none !important;
}

.toggle-password:hover {
    opacity: 1;
}

.password-warning {
    margin-top: 0.5rem;
    color: var(--text-secondary);
    font-size: 0.78rem;
    line-height: 1.35;
}

.modal-error {
    padding: 0.55rem 0.7rem;
    border-radius: 8px;
    background: rgba(239, 68, 68, 0.12);
    color: var(--error-color);
    font-size: 0.82rem;
    line-height: 1.35;
}

.modal-actions {
    display: flex;
    gap: 0.75rem;
    margin-top: 2rem;
}

.confirm-btn {
    flex: 2;
    padding: 0.65rem;
    border-radius: 8px;
    border: none;
    background: var(--accent-color);
    color: #fff;
    font-weight: 600;
    font-size: 0.9rem;
    cursor: pointer;
    transition: all 0.15s;
}

.confirm-btn:hover {
    background: var(--accent-hover);
    transform: translateY(-1px);
}

.cancel-btn {
    flex: 1;
    padding: 0.65rem;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: var(--card-bg);
    color: var(--text-secondary);
    font-size: 0.9rem;
    cursor: pointer;
    transition: all 0.15s;
}

.cancel-btn:hover {
    border-color: var(--text-secondary);
    color: var(--text-primary);
}
</style>
