import { Dialog } from "@base-ui/react";
import { FC, ReactNode, use, useState } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { ShortcutButton } from "#ui/ShortcutButton.tsx";
import { isPreviewPanelVisible, Panel as PanelType } from "#ui/routes/project/$id/-state/layout.ts";
import { ProjectStateContext } from "#ui/routes/project/$id/-ProjectState.tsx";
import { ShortcutsBarPortalContext } from "#ui/routes/project/$id/-ShortcutsBar.tsx";
import { assert } from "#ui/routes/project/$id/-shared.tsx";
import uiStyles from "#ui/ui.module.css";
import { closePreviewBinding } from "./workspace/-WorkspaceShortcuts.ts";
import sharedStyles from "./-shared.module.css";

export const ProjectPreviewLayout: FC<{
	projectId: string;
	children: ReactNode;
	preview: ReactNode | null;
}> = ({ children, projectId, preview }) => {
	const [projectState, dispatchProjectState] = assert(use(ProjectStateContext));
	const inheritedShortcutsBarPortalNode = use(ShortcutsBarPortalContext);
	const [dialogShortcutsBarPortalNode, setDialogShortcutsBarPortalNode] =
		useState<HTMLElement | null>(null);
	const panelIds: Array<PanelType> = isPreviewPanelVisible(projectState.layout)
		? ["primary", "preview"]
		: ["primary"];
	const { defaultLayout, onLayoutChanged } = useDefaultLayout({
		id: `project:${projectId}:layout`,
		panelIds,
	});

	return (
		<ShortcutsBarPortalContext
			value={
				projectState.layout.isFullscreenPreviewOpen
					? (dialogShortcutsBarPortalNode ?? inheritedShortcutsBarPortalNode)
					: inheritedShortcutsBarPortalNode
			}
		>
			<Group
				className={sharedStyles.pageWithPreview}
				defaultLayout={defaultLayout}
				onLayoutChange={onLayoutChanged}
			>
				<Panel
					id={"primary" satisfies PanelType}
					minSize={500}
					className={sharedStyles.primaryPanel}
				>
					{children}
				</Panel>
				{isPreviewPanelVisible(projectState.layout) && (
					<>
						<Separator className={sharedStyles.previewResizeHandle} />
						<Panel
							id={"preview" satisfies PanelType}
							minSize={300}
							defaultSize="30%"
							className={sharedStyles.previewPanel}
						>
							{
								// There can only be one user of the ref at a time.
								projectState.layout.isFullscreenPreviewOpen ? null : preview
							}
						</Panel>
					</>
				)}
			</Group>
			{projectState.layout.isFullscreenPreviewOpen && (
				<Dialog.Root
					open
					onOpenChange={(open) => {
						dispatchProjectState({
							_tag: open ? "OpenFullscreenPreview" : "CloseFullscreenPreview",
						});
					}}
				>
					<Dialog.Portal>
						<Dialog.Popup aria-label="Preview" className={sharedStyles.previewDialogPopup}>
							<div className={sharedStyles.previewDialogBody}>
								<ShortcutButton
									binding={closePreviewBinding}
									type="button"
									className={uiStyles.button}
									onClick={() => dispatchProjectState({ _tag: "ClosePreview" })}
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
