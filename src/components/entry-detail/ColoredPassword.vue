<template>
    <span class="colored-password"
        ><span
            v-for="(run, index) in runs"
            :key="index"
            :class="'run-' + run.kind"
            >{{ run.text }}</span
        ></span
    >
</template>

<script setup>
import { computed } from 'vue';
import { splitPasswordRuns } from '../../utils';

// Renders a password with one colour per character class, so a random string
// can be read (and dictated) without counting characters. Only ever used for a
// value the user has chosen to reveal — the masked form stays plain text, or
// every bullet would come out in the symbol colour.
//
// The spans carry no separators of their own: the concatenated text is exactly
// the password, so selecting and copying it by hand still yields the password.
const props = defineProps({
    value: { type: String, default: '' },
});

const runs = computed(() => splitPasswordRuns(props.value));
</script>

<style scoped>
.colored-password {
    /* Same colours whatever the surrounding text colour is. */
    font-variant-ligatures: none;
}

.run-letter {
    color: var(--password-letter);
}

.run-digit {
    color: var(--password-digit);
}

.run-symbol {
    color: var(--password-symbol);
}
</style>
