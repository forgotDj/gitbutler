import { FC, ReactNode } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { classes } from "#ui/classes.ts";
import {
	getFocus,
	getVisiblePanels,
	isPreviewPanelVisible,
	Panel as PanelType,
} from "#ui/routes/project/$id/state/layout.ts";
import {
	projectActions,
	selectProjectLayoutState,
} from "#ui/routes/project/$id/state/projectSlice.ts";
import { useAppDispatch, useAppSelector } from "#ui/state/hooks.ts";
import styles from "./ProjectPreviewLayout.module.css";

export const ProjectPreviewLayout: FC<{
	projectId: string;
	children: ReactNode;
	preview: ReactNode | null;
}> = ({ children, projectId, preview }) => {
	const dispatch = useAppDispatch();
	const layoutState = useAppSelector((state) => selectProjectLayoutState(state, projectId));
	const panelIds = getVisiblePanels(layoutState);
	const focus = getFocus(layoutState);
	const focusPrimary = () => dispatch(projectActions.focusPrimary({ projectId }));
	const focusPreview = () => dispatch(projectActions.focusPreview({ projectId }));
	const { defaultLayout, onLayoutChanged } = useDefaultLayout({
		id: `project:${projectId}:layout`,
		panelIds,
	});

	return (
		<Group
			className={styles.pageWithPreview}
			defaultLayout={defaultLayout}
			onLayoutChange={onLayoutChanged}
		>
			<Panel
				id={"primary" satisfies PanelType}
				minSize={400}
				onPointerDown={focusPrimary}
				className={classes(
					styles.panel,
					styles.primaryPanel,
					focus === "primary" && styles.focusedPanel,
				)}
			>
				{children}
			</Panel>
			{isPreviewPanelVisible(layoutState) && (
				<>
					<Separator className={styles.previewResizeHandle} />
					<Panel
						id={"preview" satisfies PanelType}
						minSize={300}
						defaultSize="70%"
						onPointerDown={focusPreview}
						className={classes(
							styles.panel,
							styles.previewPanel,
							focus === "preview" && styles.focusedPanel,
						)}
					>
						{preview}
					</Panel>
				</>
			)}
		</Group>
	);
};
