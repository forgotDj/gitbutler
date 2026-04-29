/* oxlint-disable */

/**
 * https://github.com/TanStack/hotkeys/blob/d5df8c5c234b8b8edad6324f230c482f1c9b5473/packages/hotkeys/src/manager.utils.ts#L48
 */
export const isInputElement = (element: EventTarget | null): boolean => {
	if (!element) {
		return false;
	}

	if (element instanceof HTMLInputElement) {
		const type = element.type.toLowerCase();
		if (type === "button" || type === "submit" || type === "reset") {
			return false;
		}
		return true;
	}

	if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
		return true;
	}

	// Check for contenteditable elements (includes "true", "", "plaintext-only",
	// and inherited contenteditable from ancestor elements)
	if (element instanceof HTMLElement && element.isContentEditable) {
		return true;
	}

	return false;
};
