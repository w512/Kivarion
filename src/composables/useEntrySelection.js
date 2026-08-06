import { computed, onUnmounted, ref, toValue, watch } from 'vue';
import {
    ALL_ENTRIES_UUID,
    findEntryByUuid,
    findGroupByUuid,
    getObjectUuid,
    isObjectInRecycleBin,
} from '../kdbxView.js';

const SEARCH_DEBOUNCE_MS = 150;

/**
 * What the user is looking at — the selected group, the search query, the list
 * those two produce, the open entry — together with the guard that keeps a
 * half-typed entry from being thrown away by a change of any of it.
 *
 * These belong together because they are one question. `EntryDetail` reloads
 * its form whenever `props.entry` changes, so *every* action that changes the
 * selection has to pass through `requestNavigation` first; and selecting a
 * group clears the search box, so the box is part of the same state rather
 * than something the page holds beside it.
 *
 * This object is the shared dependency of the group and entry actions: they
 * mutate the vault, and almost all of them move the selection while doing it.
 *
 * @param {object} store - the Pinia store.
 * @param {import('vue').Ref|(() => object)} databaseView - the view model built
 *   by `buildDatabaseView`; read through `toValue` so a computed or a getter
 *   both work.
 */
export function useEntrySelection(store, databaseView) {
    const selectedEntryUuid = ref(null);
    // Bound with `ref="entryDetailRef"` in the template. The draft lives in
    // that component; everything here can only ask it.
    const entryDetailRef = ref(null);
    const showUnsavedEditConfirm = ref(false);
    const pendingNavigation = ref(null);

    const searchQuery = ref('');
    const debouncedSearchQuery = ref('');
    let searchDebounceTimer = null;

    const view = () => toValue(databaseView);

    // Keep typing responsive: the input updates immediately, while the
    // full-vault search runs only after a short pause. Clearing remains instant.
    watch(searchQuery, (value) => {
        clearTimeout(searchDebounceTimer);
        if (!value.trim()) {
            debouncedSearchQuery.value = '';
            return;
        }
        searchDebounceTimer = setTimeout(() => {
            debouncedSearchQuery.value = value;
        }, SEARCH_DEBOUNCE_MS);
    });

    onUnmounted(() => clearTimeout(searchDebounceTimer));

    const selectedGroup = computed(() => {
        if (!store.db || !store.selectedGroupUuid) return null;
        if (store.selectedGroupUuid === ALL_ENTRIES_UUID)
            return { uuid: ALL_ENTRIES_UUID };
        return findGroupByUuid(view(), store.selectedGroupUuid);
    });

    const selectedEntry = computed(() =>
        findEntryByUuid(view(), selectedEntryUuid.value),
    );

    const selectedGroupIsInRecycleBin = computed(() =>
        isObjectInRecycleBin(view(), selectedGroup.value),
    );

    const filteredEntries = computed(() => {
        const current = view();
        const q = debouncedSearchQuery.value.trim().toLocaleLowerCase();
        if (q) {
            return current.searchIndex
                .filter((row) => row.text.includes(q))
                .map((row) => current.entryItems.get(getObjectUuid(row.entry)));
        }

        const rawEntries =
            store.selectedGroupUuid === ALL_ENTRIES_UUID
                ? current.entries
                : current.entriesByGroup.get(store.selectedGroupUuid) || [];
        return rawEntries.map((entry) =>
            current.entryItems.get(getObjectUuid(entry)),
        );
    });

    // "All Entries" is a UI row, not a group: adding under it means the root.
    function resolveTargetGroup(groupUuid) {
        return groupUuid === ALL_ENTRIES_UUID
            ? view().rootGroup
            : findGroupByUuid(view(), groupUuid);
    }

    function hasDraft() {
        return entryDetailRef.value?.hasUnsavedChanges?.() ?? false;
    }

    function discardDraft() {
        entryDetailRef.value?.discardPendingEdit?.();
    }

    /**
     * Run `action`, unless an entry edit is open — then park it behind the
     * save/discard/keep-editing modal and run it only once the user answers.
     *
     * @returns {boolean} whether the action ran now.
     */
    function requestNavigation(action) {
        if (hasDraft()) {
            pendingNavigation.value = action;
            showUnsavedEditConfirm.value = true;
            return false;
        }

        action();
        return true;
    }

    async function saveUnsavedEditAndContinue() {
        const action = pendingNavigation.value;
        if (!entryDetailRef.value?.savePendingEdit?.()) {
            // Validation failed; return to the edit form so its inline error is
            // visible.
            pendingNavigation.value = null;
            showUnsavedEditConfirm.value = false;
            return;
        }

        pendingNavigation.value = null;
        showUnsavedEditConfirm.value = false;
        await action?.();
    }

    async function discardUnsavedEditAndContinue() {
        const action = pendingNavigation.value;
        discardDraft();

        pendingNavigation.value = null;
        showUnsavedEditConfirm.value = false;
        await action?.();
    }

    function continueEditing() {
        pendingNavigation.value = null;
        showUnsavedEditConfirm.value = false;
    }

    function selectGroup(groupUuid) {
        requestNavigation(() => {
            store.selectedGroupUuid = groupUuid;
            selectedEntryUuid.value = null;
            searchQuery.value = '';
        });
    }

    function selectEntry(entryUuid) {
        if (entryUuid === selectedEntryUuid.value) return;
        requestNavigation(() => {
            selectedEntryUuid.value = entryUuid;
        });
    }

    function requestCloseEntryDetail() {
        requestNavigation(() => {
            selectedEntryUuid.value = null;
        });
    }

    // UUIDs survive a reload, but the selected group or entry may not exist in
    // the version that was on disk.
    function restoreSelectionAfterReload() {
        if (
            store.selectedGroupUuid !== ALL_ENTRIES_UUID &&
            !findGroupByUuid(view(), store.selectedGroupUuid)
        ) {
            store.selectedGroupUuid = getObjectUuid(view().rootGroup);
        }
        if (!findEntryByUuid(view(), selectedEntryUuid.value)) {
            selectedEntryUuid.value = null;
        }
    }

    /** Drop everything a lock invalidates: the draft, the parked action, the
     * selection. The search box is left alone — locking unmounts the page. */
    function reset() {
        discardDraft();
        pendingNavigation.value = null;
        showUnsavedEditConfirm.value = false;
        selectedEntryUuid.value = null;
    }

    return {
        selectedEntryUuid,
        entryDetailRef,
        searchQuery,
        selectedGroup,
        selectedEntry,
        selectedGroupIsInRecycleBin,
        filteredEntries,
        showUnsavedEditConfirm,
        requestNavigation,
        resolveTargetGroup,
        hasDraft,
        discardDraft,
        selectGroup,
        selectEntry,
        requestCloseEntryDetail,
        saveUnsavedEditAndContinue,
        discardUnsavedEditAndContinue,
        continueEditing,
        restoreSelectionAfterReload,
        reset,
    };
}
