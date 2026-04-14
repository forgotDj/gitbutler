import posthog from "posthog-js";
import { writable, type Writable } from "svelte/store";
import type { MessageStyle } from "@gitbutler/ui";

type ExtraAction = {
	label: string;
	testId?: string;
	onClick: (dismiss: () => void) => void;
};

export interface Toast {
	id?: string;
	testId?: string;
	message?: string;
	error?: any;
	title?: string;
	style?: MessageStyle;
	extraAction?: ExtraAction;
}

export const toastStore: Writable<Toast[]> = writable([]);

let idCounter = 0;

const TOAST_CAPTURE_LIMIT = 60;
const TOAST_CAPTURE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const toastCaptureTimestamps: number[] = [];

function shouldCaptureToast(): boolean {
	const now = Date.now();
	const cutoff = now - TOAST_CAPTURE_WINDOW_MS;
	while (toastCaptureTimestamps.length > 0 && toastCaptureTimestamps[0]! <= cutoff) {
		toastCaptureTimestamps.shift();
	}
	if (toastCaptureTimestamps.length >= TOAST_CAPTURE_LIMIT) {
		return false;
	}
	toastCaptureTimestamps.push(now);
	return true;
}

export function showToast(toast: Toast) {
	if (toast.error && shouldCaptureToast()) {
		posthog.capture("toast:show_error", {
			error_test_id: toast.testId,
			error_title: toast.title,
			error_message: String(toast.error),
		});
	}

	if (toast.style === "warning" && shouldCaptureToast()) {
		posthog.capture("toast:show_warning", {
			warning_test_id: toast.testId,
			warning_title: toast.title,
			warning_message: toast.message,
		});
	}

	toast.message = toast.message?.replace(/^ */gm, "");
	if (!toast.id) {
		toast = { ...toast, id: `${idCounter++}` };
	}
	toastStore.update((items) => [
		...items.filter((t) => toast.id === undefined || t.id !== toast.id),
		toast,
	]);
}

export function showInfo(title: string, message: string, extraAction?: ExtraAction) {
	showToast({ title, message, style: "info", extraAction });
}

export function showWarning(title: string, message: string, extraAction?: ExtraAction) {
	showToast({ title, message, style: "warning", extraAction });
}

export function dismissToast(messageId: string | undefined) {
	if (!messageId) return;
	toastStore.update((items) => items.filter((m) => m.id !== messageId));
}
