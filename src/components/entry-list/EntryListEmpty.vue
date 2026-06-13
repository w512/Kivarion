<template>
    <div class="empty-state">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
        </svg>
        <p>{{ message }}</p>
    </div>
</template>

<script setup>
defineProps({
    message: { type: String, default: 'No entries in this group' },
});
</script>

<style scoped>
.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 3rem 2rem;
    color: var(--text-secondary);
    text-align: center;
}

.empty-state p {
    font-size: 0.85rem;
    max-width: 200px;
}
</style>
