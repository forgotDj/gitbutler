import { FC, ReactNode, useRef } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import {
	isPanelVisible,
	orderedPanels,
	Panel as PanelType,
} from "#ui/routes/project/$id/state/layout.ts";
import {
	selectProjectLayoutState,
	selectProjectPromptState,
} from "#ui/routes/project/$id/state/projectSlice.ts";
import { useAppSelector } from "#ui/state/hooks.ts";
import styles from "./ProjectPreviewLayout.module.css";
import { useMergedRefs } from "@base-ui/utils/useMergedRefs";
import { classes } from "#ui/classes.ts";
import { useActiveElement } from "#ui/focus.ts";

const getFocusedProjectPanel = (activeElement: Element | null) =>
	(activeElement?.closest("[data-panel]")?.id as PanelType | undefined) ?? null;

export const useFocusedProjectPanel = (): PanelType | null => {
	const activeElement = useActiveElement();
	return getFocusedProjectPanel(activeElement);
};

export const useEffectiveFocusedProjectPanel = (projectId: string): PanelType | null => {
	const focusedPanel = useFocusedProjectPanel();
	const prompt = useAppSelector((state) => selectProjectPromptState(state, projectId));
	return prompt._tag === "CommandPalette" ? prompt.focusedPanel : focusedPanel;
};

export const useProjectPanelFocusManager = () => {
	const panelElementsRef = useRef(new Map<PanelType, HTMLDivElement>());
	const panelElementRef =
		(panel: PanelType) =>
		(element: HTMLDivElement | null): void => {
			if (element) panelElementsRef.current.set(panel, element);
			else panelElementsRef.current.delete(panel);
		};
	const focusPanel = (panel: PanelType) => {
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

export const ProjectPreviewLayout: FC<{
	projectId: string;
	primaryActiveDescendantId?: string;
	children: ReactNode;
	show: ReactNode | null;
	panelElementRef: (panel: PanelType) => (element: HTMLDivElement | null) => void;
}> = ({ primaryActiveDescendantId, children, panelElementRef, projectId, show }) => {
	const layoutState = useAppSelector((state) => selectProjectLayoutState(state, projectId));
	const { defaultLayout, onLayoutChanged } = useDefaultLayout({
		id: `project:${projectId}:layout`,
		panelIds: layoutState.visiblePanels,
	});

	return (
		<Group className={styles.page} defaultLayout={defaultLayout} onLayoutChange={onLayoutChanged}>
			<Panel
				id={"primary" satisfies PanelType}
				minSize={400}
				elementRef={useMergedRefs(panelElementRef("primary"), (el) =>
					el?.focus({ focusVisible: false }),
				)}
				tabIndex={0}
				role="tree"
				aria-activedescendant={primaryActiveDescendantId}
				className={classes(styles.panel, styles.primaryPanel)}
			>
				{children}
			</Panel>
			{isPanelVisible(layoutState, "show") && (
				<>
					<Separator className={styles.panelResizeHandle} />
					<Panel
						id={"show" satisfies PanelType}
						minSize={300}
						defaultSize="70%"
						elementRef={panelElementRef("show")}
						tabIndex={0}
						className={styles.panel}
					>
						{show}
					</Panel>
				</>
			)}
		</Group>
	);
};
