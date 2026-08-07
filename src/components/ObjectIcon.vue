<template>
    <span class="object-icon" :style="{ width: box, height: box }">
        <img v-if="src" :src="src" alt="" class="object-icon-image" />
        <component
            :is="glyph"
            v-else
            :size="size"
            :stroke-width="strokeWidth"
        />
    </span>
</template>

<script setup>
import { computed } from 'vue';
import { DEFAULT_ENTRY_ICON, standardIconComponent } from '../standardIcons.js';

// The icon of one group or entry: the custom image if it has one, otherwise the
// Lucide glyph for its standard `IconID`. Both the tree and the entry list read
// `iconSrc`/`iconId` straight off their view-model rows, so the two never
// disagree about which of the two an object is showing.
const props = defineProps({
    src: { type: String, default: null },
    iconId: { type: Number, default: null },
    // The standard icon to draw when `iconId` is absent or not a KDBX id.
    fallbackIconId: { type: Number, default: DEFAULT_ENTRY_ICON },
    size: { type: Number, default: 16 },
    strokeWidth: { type: Number, default: 2 },
});

const box = computed(() => `${props.size}px`);
const glyph = computed(() =>
    standardIconComponent(props.iconId, props.fallbackIconId),
);
</script>

<style scoped>
.object-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}

/* `contain`, not `cover`: a custom icon is whatever size the program that wrote
   it chose, and cropping one to a square hides half of a wide glyph. */
.object-icon-image {
    width: 100%;
    height: 100%;
    object-fit: contain;
}
</style>
