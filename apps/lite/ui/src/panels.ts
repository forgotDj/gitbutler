import { useActiveElement } from "#ui/focus.ts";
import { selectProjectPickerDialogState } from "#ui/projects/state.ts";
import { useAppSelector } from "#ui/store.ts";
import { useRef } from "react";

export type Panel = "outline" | "details";
export const orderedPanels: Array<Panel> = ["outline", "details"];

const getFocusedProjectPanel = (activeElement: Element | null) =>
	(activeElement?.closest("[data-panel]")?.id as Panel | undefined) ?? null;

export const useFocusedProjectPanel = (projectId: string): Panel | null => {
	const activeElement = useActiveElement();
	const focusedPanel = getFocusedProjectPanel(activeElement);
	const pickerDialog = useAppSelector((state) => selectProjectPickerDialogState(state, projectId));
	return pickerDialog._tag === "CommandPalette" ? pickerDialog.focusedPanel : focusedPanel;
};

export const useProjectPanelFocusManager = () => {
	const panelElementsRef = useRef(new Map<Panel, HTMLDivElement>());
	const panelElementRef =
		(panel: Panel) =>
		(element: HTMLDivElement | null): void => {
			if (element) panelElementsRef.current.set(panel, element);
			else panelElementsRef.current.delete(panel);
		};
	const focusPanel = (panel: Panel) => {
		panelElementsRef.current.get(panel)?.focus({ focusVisible: false });
	};
	const focusAdjacentPanel = (offset: -1 | 1) => {
		const currentPanel = getFocusedProjectPanel(document.activeElement);
		if (currentPanel === null) return;
		const nextPanel = orderedPanels[orderedPanels.indexOf(currentPanel) + offset];
		if (nextPanel === undefined) return;
		focusPanel(nextPanel);
	};

	return {
		focusAdjacentPanel,
		focusPanel,
		panelElementRef,
	};
};
