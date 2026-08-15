import { ref } from 'vue';

/**
 * The app-wide list of error messages shown in the top-right corner.
 *
 * They used to be rendered wherever they happened to be raised: at the foot of
 * the entry edit form, inside the icon picker, under a settings row. Several of
 * those spots sit in a scrolling column, so the message could land below the
 * fold — a rejected save looked like nothing happening at all. Anything that is
 * a *report* ("this did not work") is therefore raised here instead, and the
 * host renders it over the whole window.
 *
 * Field-level validation deliberately stays where it is: the wrong master
 * password on the home screen, the current password in Database Settings and
 * the name inputs in `InputModal` all sit directly under the field the user has
 * to correct and must stay on screen for as long as that takes — which is the
 * one thing a self-dismissing toast cannot promise. The failed-save banner
 * stays too: it carries Retry, so it is a control, not a message.
 *
 * Module level rather than a store or a composable: it is called from plain
 * functions in composables that have no component instance of their own.
 */
export const TOAST_TIMEOUT = 6000;

/** Beyond this the oldest is dropped — a stack taller than this hides itself. */
const MAX_TOASTS = 4;

export const toasts = ref([]);

const timers = new Map();
let nextToastId = 0;

function stopTimer(id) {
    const timer = timers.get(id);
    if (timer === undefined) return;
    clearTimeout(timer);
    timers.delete(id);
}

function startTimer(id, timeout) {
    stopTimer(id);
    if (!(timeout > 0)) return;
    timers.set(
        id,
        setTimeout(() => {
            timers.delete(id);
            dismissToast(id);
        }, timeout),
    );
}

/**
 * Show `message`, or — if it is already on screen — restart its timer instead
 * of stacking a second copy: submitting the same invalid form twice is a repeat
 * of one complaint, not two.
 *
 * @returns {number} the toast's id, for dismissing it early.
 */
export function showErrorToast(message, { timeout = TOAST_TIMEOUT } = {}) {
    const text = (message ?? '').toString().trim();
    if (!text) return -1;

    const existing = toasts.value.find((toast) => toast.message === text);
    if (existing) {
        startTimer(existing.id, timeout);
        return existing.id;
    }

    const id = nextToastId++;
    toasts.value = [...toasts.value, { id, message: text }];
    while (toasts.value.length > MAX_TOASTS) {
        dismissToast(toasts.value[0].id);
    }
    startTimer(id, timeout);
    return id;
}

export function dismissToast(id) {
    stopTimer(id);
    toasts.value = toasts.value.filter((toast) => toast.id !== id);
}

/**
 * Drop everything on screen. Called on lock as well as by the tests: a message
 * can name a custom field or an attachment of the database that was open, and
 * that must not be left readable on the home screen once it is locked.
 */
export function clearToasts() {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    toasts.value = [];
}

/** Test seam: `clearToasts` plus the id counter, so ids stay predictable. */
export function resetToasts() {
    clearToasts();
    nextToastId = 0;
}

/** Hover holds a message on screen; leaving hands it the full timeout again. */
export function pauseToast(id) {
    stopTimer(id);
}

export function resumeToast(id, timeout = TOAST_TIMEOUT) {
    if (!toasts.value.some((toast) => toast.id === id)) return;
    startTimer(id, timeout);
}
