<template>
    <div
        class="entry-row"
        :class="{ active: selected }"
        role="button"
        tabindex="0"
        :aria-pressed="selected"
        :data-entry-uuid="entry.uuid"
        draggable="true"
        @click="$emit('select')"
        @keydown.enter="$emit('select')"
        @keydown.space.prevent="$emit('select')"
        @dragstart="onDragStart"
    >
        <div class="entry-icon">
            <img
                v-if="entry.iconSrc"
                :src="entry.iconSrc"
                class="custom-icon-img"
                alt=""
            />
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
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
        </div>
        <div class="entry-info">
            <span class="entry-title">{{ entry.title || 'No title' }}</span>
            <div class="entry-meta">
                <span class="entry-date">{{ formattedDate }}</span>
            </div>
        </div>
        <button
            v-if="canRestore"
            class="restore-btn"
            title="Restore entry"
            aria-label="Restore entry"
            @click.stop="$emit('restore')"
            @keydown.stop
        >
            <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
            >
                <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                <path d="M3 3v5h5" />
            </svg>
        </button>
    </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
    entry: { type: Object, required: true },
    selected: { type: Boolean, default: false },
    canRestore: { type: Boolean, default: false },
});

defineEmits(['select', 'restore']);

// The drop target (`GroupNode`) reads the dragged entry straight off the drag
// event, so the payload below is the whole mechanism — there is no drag-start
// event for a parent to listen to.
function onDragStart(event) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(
        'application/x-kivarion-entry',
        props.entry.uuid,
    );
    event.dataTransfer.setData('text/plain', props.entry.uuid);
}

const formattedDate = computed(() => {
    const date = props.entry.modifiedAt;
    if (!date) return '';
    return new Intl.DateTimeFormat('default', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
});
</script>

<style scoped>
.entry-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.3rem 0.3rem;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s;
    background: var(--card-bg);
    border: 1px solid transparent;
}

.entry-row:hover {
    background: var(--badge-bg);
    border-color: var(--border-color);
}

.entry-row.active {
    background: rgba(99, 102, 241, 0.1);
    border-color: rgba(99, 102, 241, 0.3);
}

.entry-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 6px;
    background: var(--badge-bg);
    color: var(--text-secondary);
    flex-shrink: 0;
    overflow: hidden;
}

.custom-icon-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.entry-row.active .entry-icon {
    background: rgba(99, 102, 241, 0.15);
    color: var(--accent-color);
}

.restore-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
}

.restore-btn:hover {
    border-color: var(--accent-color);
    color: var(--accent-color);
    background: rgba(99, 102, 241, 0.1);
}

.entry-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
}

.entry-title {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.entry-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    overflow: hidden;
}

.entry-date {
    font-size: 0.7rem;
    color: var(--text-secondary);
    opacity: 0.7;
    white-space: nowrap;
}
</style>
