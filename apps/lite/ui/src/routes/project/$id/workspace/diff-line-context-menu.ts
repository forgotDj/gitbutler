import type { SelectionSide } from "@pierre/diffs";
import type { CodeViewHandle } from "@pierre/diffs/react";
import { useEffectEvent, useLayoutEffect, type RefObject } from "react";

export type DiffLineContextMenuTarget = {
	event: MouseEvent;
	itemId: string;
	lineNumber: number;
	side: SelectionSide;
};

const selectionSideFromLineNumber = (element: HTMLElement): SelectionSide | null => {
	switch (element.getAttribute("data-line-type")) {
		case "change-addition":
			return "additions";
		case "change-deletion":
			return "deletions";
		default:
			return null;
	}
};

const contextMenuTarget = (
	event: MouseEvent,
	viewerRef: RefObject<CodeViewHandle<undefined> | null>,
): DiffLineContextMenuTarget | null => {
	// Pierre renders every diff item into its own open shadow root. Context-menu events are
	// composed, so inspecting their path lets us delegate from the stable CodeView container
	// instead of observing renders or attaching listeners to every line number.
	const path = event.composedPath();
	const lineNumberElement = path.find(
		(target): target is HTMLElement =>
			target instanceof HTMLElement && target.hasAttribute("data-column-number"),
	);
	if (!lineNumberElement) return null;

	const side = selectionSideFromLineNumber(lineNumberElement);
	if (side === null) return null;

	const lineNumber = Number.parseInt(
		lineNumberElement.getAttribute("data-column-number") ?? "",
		10,
	);
	if (!Number.isFinite(lineNumber)) return null;

	const item = viewerRef.current
		?.getInstance()
		?.getRenderedItems()
		.find(({ element }) => path.includes(element));
	if (item?.type !== "diff") return null;

	return {
		event,
		itemId: item.id,
		lineNumber,
		side,
	};
};

export const useDiffLineContextMenu = ({
	viewerRef,
	onContextMenu,
}: {
	viewerRef: RefObject<CodeViewHandle<undefined> | null>;
	onContextMenu: (target: DiffLineContextMenuTarget) => void;
}): void => {
	const handleContextMenu = useEffectEvent((event: MouseEvent) => {
		const target = contextMenuTarget(event, viewerRef);
		if (target) onContextMenu(target);
	});

	useLayoutEffect(() => {
		const container = viewerRef.current?.getInstance()?.getContainerElement();
		if (!container) return;

		container.addEventListener("contextmenu", handleContextMenu);
		return () => container.removeEventListener("contextmenu", handleContextMenu);
	}, [viewerRef]);
};
