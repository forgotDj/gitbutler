import { Dialog } from "@base-ui/react";
import { FC, ReactNode, use, useState } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { ShortcutButton } from "#ui/ShortcutButton.tsx";
import { classes } from "#ui/classes.ts";
import {
	getFocus,
	isPreviewPanelVisible,
	Panel as PanelType,
} from "#ui/routes/project/$id/state/layout.ts";
import {
	projectActions,
	selectProjectLayoutState,
} from "#ui/routes/project/$id/state/projectSlice.ts";
import { ShortcutsBarPortalContext } from "#ui/routes/project/$id/ShortcutsBar.tsx";
import { useAppDispatch, useAppSelector } from "#ui/state/hooks.ts";
import uiStyles from "#ui/ui.module.css";
import { closePreviewBinding } from "./workspace/WorkspaceShortcuts.ts";
import styles from "./ProjectPreviewLayout.module.css";

export const ProjectPreviewLayout: FC<{
	projectId: string;
	children: ReactNode;
	preview: ReactNode | null;
}> = ({ children, projectId, preview }) => {
	const dispatch = useAppDispatch();
	const layoutState = useAppSelector((state) => selectProjectLayoutState(state, projectId));
	const inheritedShortcutsBarPortalNode = use(ShortcutsBarPortalContext);
	const [dialogShortcutsBarPortalNode, setDialogShortcutsBarPortalNode] =
		useState<HTMLElement | null>(null);
	const panelIds: Array<PanelType> = isPreviewPanelVisible(layoutState)
		? ["primary", "preview"]
		: ["primary"];
	const focus = getFocus(layoutState);
	const focusPrimary = () => dispatch(projectActions.focusPrimary({ projectId }));
	const focusPreview = () => dispatch(projectActions.focusPreview({ projectId }));
	const { defaultLayout, onLayoutChanged } = useDefaultLayout({
		id: `project:${projectId}:layout`,
		panelIds,
	});

	return (
		<ShortcutsBarPortalContext
			value={
				layoutState.isFullscreenPreviewOpen
					? (dialogShortcutsBarPortalNode ?? inheritedShortcutsBarPortalNode)
					: inheritedShortcutsBarPortalNode
			}
		>
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
			{layoutState.isFullscreenPreviewOpen && (
				<Dialog.Root
					open
					onOpenChange={(open) => {
						dispatch(
							open
								? projectActions.openFullscreenPreview({ projectId })
								: projectActions.closeFullscreenPreview({ projectId }),
						);
					}}
				>
					<Dialog.Portal>
						<Dialog.Popup aria-label="Preview" className={styles.previewDialogPopup}>
							<div className={styles.previewDialogBody}>
								<ShortcutButton
									binding={closePreviewBinding}
									type="button"
									className={uiStyles.button}
									onClick={() => dispatch(projectActions.closePreview({ projectId }))}
								>
									{closePreviewBinding.description}
								</ShortcutButton>
								{preview}
							</div>
							<footer ref={setDialogShortcutsBarPortalNode} />
						</Dialog.Popup>
					</Dialog.Portal>
				</Dialog.Root>
			)}
		</ShortcutsBarPortalContext>
	);
};
