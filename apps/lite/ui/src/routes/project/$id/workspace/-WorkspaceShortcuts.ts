import { getAction, type ShortcutBinding } from "#ui/shortcuts.ts";
import { isTypingTarget } from "#ui/routes/project/$id/-shared.tsx";
import { projectActions } from "#ui/routes/project/$id/-state/projectSlice.ts";
import { useAppDispatch } from "#ui/state/hooks.ts";
import { AbsorptionTarget } from "@gitbutler/but-sdk";
import { Match } from "effect";
import { RefObject, useEffect, useEffectEvent } from "react";
import {
	type ChangeItem,
	changesSectionItem,
	getParentSection,
	type ChangesSectionItem,
	type Item,
	type CommitFileItem,
	type CommitItem,
	type SegmentItem,
} from "./-Item.ts";
import { operationSourceFromItem } from "./-OperationSource.ts";
import { useResolveOperationSource } from "./-ResolvedOperationSource.ts";
import { getAdjacentItem, getAdjacentSection, type NavigationIndex } from "./-WorkspaceModel.ts";
import { getFocus, type ProjectLayoutState } from "#ui/routes/project/$id/-state/layout.ts";
import { PreviewImperativeHandle } from "./route.tsx";
import { OperationMode, type WorkspaceMode } from "./-WorkspaceMode.ts";
import { operationModeToOperation } from "./-OperationMode.tsx";
import { useRunOperation } from "#ui/Operation.ts";

type EnterRubModeAction = { _tag: "EnterRubMode" };
type EnterMoveModeAction = { _tag: "EnterMoveMode" };

const enterRubModeBinding: ShortcutBinding<EnterRubModeAction> = {
	id: "enter-rub-mode",
	description: "Rub",
	keys: ["r"],
	action: { _tag: "EnterRubMode" },
	repeat: false,
};

const enterMoveModeBinding: ShortcutBinding<EnterMoveModeAction> = {
	id: "enter-move-mode",
	description: "Move",
	keys: ["m"],
	action: { _tag: "EnterMoveMode" },
	repeat: false,
};

type ItemSelectionAction =
	| { _tag: "Move"; offset: -1 | 1 }
	| { _tag: "PreviousSection" }
	| { _tag: "NextSection" }
	| EnterRubModeAction
	| EnterMoveModeAction;

const itemSelectionBindings: Array<ShortcutBinding<ItemSelectionAction>> = [
	{
		id: "move-up",
		description: "up",
		keys: ["ArrowUp", "k"],
		action: { _tag: "Move", offset: -1 },
	},
	{
		id: "move-down",
		description: "down",
		keys: ["ArrowDown", "j"],
		action: { _tag: "Move", offset: 1 },
	},
	{
		id: "previous-section",
		description: "Previous section",
		keys: ["Shift+ArrowUp", "Shift+k"],
		action: { _tag: "PreviousSection" },
		showInShortcutsBar: false,
	},
	{
		id: "next-section",
		description: "Next section",
		keys: ["Shift+ArrowDown", "Shift+j"],
		action: { _tag: "NextSection" },
		showInShortcutsBar: false,
	},
	enterRubModeBinding,
	enterMoveModeBinding,
];

type PrimaryPanelAction =
	| ItemSelectionAction
	| { _tag: "SelectUnassignedChanges" }
	| { _tag: "FocusPreview" }
	| { _tag: "ToggleFullscreenPreview" }
	| { _tag: "TogglePreview" };

type ChangesAction = PrimaryPanelAction | { _tag: "Absorb" };

type CommitAction = PrimaryPanelAction | CommitToggleFilesAction | { _tag: "EditMessage" };

type CommitFileAction = PrimaryPanelAction | CommitToggleFilesAction | { _tag: "CloseFiles" };

type HunkSelectionAction = { _tag: "Move"; offset: -1 | 1 };

type PreviewAction =
	| HunkSelectionAction
	| { _tag: "FocusPrimary" }
	| { _tag: "ToggleFullscreenPreview" }
	| { _tag: "ClosePreview" }
	| { _tag: "TogglePreview" };

export const togglePreviewBinding: ShortcutBinding<PrimaryPanelAction> = {
	id: "toggle-preview",
	description: "Preview",
	keys: ["p"],
	action: { _tag: "TogglePreview" },
	repeat: false,
};

export const toggleFullscreenPreviewBinding: ShortcutBinding<PrimaryPanelAction> = {
	id: "toggle-fullscreen-preview",
	description: "Fullscreen preview",
	keys: ["d"],
	action: { _tag: "ToggleFullscreenPreview" },
	repeat: false,
};

const focusPreviewBinding: ShortcutBinding<PrimaryPanelAction> = {
	id: "focus-preview",
	description: "Focus preview",
	keys: ["l"],
	action: { _tag: "FocusPreview" },
	repeat: false,
};

const focusPrimaryBinding: ShortcutBinding<PreviewAction> = {
	id: "focus-primary",
	description: "Focus primary",
	keys: ["h"],
	action: { _tag: "FocusPrimary" },
	repeat: false,
};

const primaryPanelBindings: Array<ShortcutBinding<PrimaryPanelAction>> = [
	...itemSelectionBindings,
	{
		id: "select-unassigned-changes",
		description: "Unassigned changes",
		keys: ["z"],
		action: { _tag: "SelectUnassignedChanges" },
		repeat: false,
	},
	focusPreviewBinding,
	toggleFullscreenPreviewBinding,
	togglePreviewBinding,
];

export const closePreviewBinding: ShortcutBinding<PreviewAction> = {
	id: "close-preview",
	description: "Close",
	keys: ["Escape"],
	action: { _tag: "ClosePreview" },
	repeat: false,
};

const previewBindings: Array<ShortcutBinding<PreviewAction>> = [
	{
		id: "preview-move-up",
		description: "up",
		keys: ["ArrowUp", "k"],
		action: { _tag: "Move", offset: -1 },
	},
	{
		id: "preview-move-down",
		description: "down",
		keys: ["ArrowDown", "j"],
		action: { _tag: "Move", offset: 1 },
	},
	focusPrimaryBinding,
	{
		id: "preview-toggle-fullscreen",
		description: "Fullscreen preview",
		keys: ["d"],
		action: { _tag: "ToggleFullscreenPreview" },
		repeat: false,
	},
	{
		id: "preview-toggle",
		description: "Preview",
		keys: ["p"],
		action: { _tag: "TogglePreview" },
		repeat: false,
	},
	closePreviewBinding,
];

const fullscreenPreviewBindings: Array<ShortcutBinding<PreviewAction>> = previewBindings
	// The preview panel is not visible as it sits behind the fullscreen dialog, so
	// there's no point having the toggle preview shortcut here.
	.filter((binding) => binding.action._tag !== "TogglePreview");

const absorbChangesBinding: ShortcutBinding<ChangesAction> = {
	id: "changes-absorb",
	description: "Absorb",
	keys: ["a"],
	action: { _tag: "Absorb" },
	repeat: false,
};

const changesBindings: Array<ShortcutBinding<ChangesAction>> = [
	...primaryPanelBindings,
	absorbChangesBinding,
];

type OperationModeAction = PrimaryPanelAction | { _tag: "Run" } | { _tag: "Cancel" };

const operationModeBindings: Array<ShortcutBinding<OperationModeAction>> = [
	...primaryPanelBindings.filter(
		(binding) => binding.action._tag !== "EnterRubMode" && binding.action._tag !== "EnterMoveMode",
	),
	{
		id: "operation-mode-run",
		description: "Run",
		keys: ["Enter"],
		action: { _tag: "Run" },
		repeat: false,
	},
	{
		id: "operation-mode-exit",
		description: "Cancel",
		keys: ["Escape"],
		action: { _tag: "Cancel" },
		repeat: false,
	},
];

const editCommitMessageBinding: ShortcutBinding<CommitAction> = {
	id: "commit-edit-message",
	description: "Reword",
	keys: ["Enter"],
	action: { _tag: "EditMessage" },
	repeat: false,
};

type CommitToggleFilesAction = { _tag: "ToggleFiles" };

const toggleCommitFilesBinding: ShortcutBinding<CommitToggleFilesAction> = {
	id: "commit-toggle-files",
	description: "Files",
	keys: ["f"],
	action: { _tag: "ToggleFiles" },
	repeat: false,
};

const commitDefaultBindings: Array<ShortcutBinding<CommitAction>> = [
	...primaryPanelBindings,
	toggleCommitFilesBinding,
	editCommitMessageBinding,
];

const closeCommitFilesBinding: ShortcutBinding<CommitFileAction> = {
	id: "commit-close-files",
	description: "Close",
	keys: ["Escape"],
	action: { _tag: "CloseFiles" },
	repeat: false,
};

const commitFilesBindings: Array<ShortcutBinding<CommitFileAction>> = [
	...primaryPanelBindings,
	toggleCommitFilesBinding,
	closeCommitFilesBinding,
];

type BranchAction = PrimaryPanelAction | { _tag: "RenameBranch" };

const branchBindings: Array<ShortcutBinding<BranchAction>> = [
	...primaryPanelBindings,
	{
		id: "segment-rename-branch",
		description: "Rename",
		keys: ["Enter"],
		action: { _tag: "RenameBranch" },
		repeat: false,
	},
];

type CommitEditingMessageAction = { _tag: "Save" } | { _tag: "Cancel" };

export const commitEditingMessageBindings: Array<ShortcutBinding<CommitEditingMessageAction>> = [
	{
		id: "commit-editing-message-save",
		description: "Save",
		keys: ["Enter"],
		action: { _tag: "Save" },
		repeat: false,
	},
	{
		id: "commit-editing-message-cancel",
		description: "Cancel",
		keys: ["Escape"],
		action: { _tag: "Cancel" },
		repeat: false,
	},
];

type RenameBranchAction = { _tag: "Save" } | { _tag: "Cancel" };

export const renameBranchBindings: Array<ShortcutBinding<RenameBranchAction>> = [
	{
		id: "rename-branch-save",
		description: "Save",
		keys: ["Enter"],
		action: { _tag: "Save" },
		repeat: false,
	},
	{
		id: "rename-branch-cancel",
		description: "Cancel",
		keys: ["Escape"],
		action: { _tag: "Cancel" },
		repeat: false,
	},
];

type Scope =
	| {
			_tag: "BaseCommit";
			bindings: Array<ShortcutBinding<PrimaryPanelAction>>;
	  }
	| {
			_tag: "ChangesSection";
			bindings: Array<ShortcutBinding<ChangesAction>>;
			context: ChangesSectionItem;
	  }
	| {
			_tag: "Change";
			bindings: Array<ShortcutBinding<ChangesAction>>;
			context: ChangeItem;
	  }
	| {
			_tag: "RubMode";
			bindings: Array<ShortcutBinding<OperationModeAction>>;
			context: Item | null;
	  }
	| {
			_tag: "MoveMode";
			bindings: Array<ShortcutBinding<OperationModeAction>>;
			context: Item | null;
	  }
	| {
			_tag: "CommitFile";
			bindings: Array<ShortcutBinding<CommitFileAction>>;
			context: CommitFileItem;
	  }
	| {
			_tag: "CommitReword";
			bindings: Array<ShortcutBinding<CommitEditingMessageAction>>;
			context: CommitItem;
	  }
	| {
			_tag: "BranchRename";
			bindings: Array<ShortcutBinding<RenameBranchAction>>;
			context: SegmentItem;
	  }
	| {
			_tag: "Commit";
			bindings: Array<ShortcutBinding<CommitAction>>;
			context: CommitItem;
	  }
	| {
			_tag: "Segment";
			bindings: Array<ShortcutBinding<PrimaryPanelAction>>;
			context: SegmentItem;
	  }
	| {
			_tag: "Branch";
			bindings: Array<ShortcutBinding<BranchAction>>;
			context: SegmentItem;
	  }
	| {
			_tag: "Preview";
			bindings: Array<ShortcutBinding<PreviewAction>>;
			context: { isFullscreen: boolean };
	  };

export const getScope = ({
	selectedItem,
	layoutState,
	workspaceMode,
}: {
	selectedItem: Item | null;
	layoutState: ProjectLayoutState;
	workspaceMode: WorkspaceMode;
}): Scope | null => {
	if (getFocus(layoutState) === "preview")
		return {
			_tag: "Preview",
			bindings: layoutState.isFullscreenPreviewOpen ? fullscreenPreviewBindings : previewBindings,
			context: { isFullscreen: layoutState.isFullscreenPreviewOpen },
		};

	const getDefaultScopeForSelectedItem = (selectedItem: Item): Scope =>
		Match.value(selectedItem).pipe(
			Match.tag(
				"ChangesSection",
				(selectedItem): Scope => ({
					_tag: "ChangesSection",
					bindings: changesBindings,
					context: selectedItem,
				}),
			),
			Match.tag(
				"Change",
				(selectedItem): Scope => ({
					_tag: "Change",
					bindings: changesBindings,
					context: selectedItem,
				}),
			),
			Match.tag(
				"Commit",
				(selectedItem): Scope => ({
					_tag: "Commit",
					bindings: commitDefaultBindings,
					context: selectedItem,
				}),
			),
			Match.tag(
				"CommitFile",
				(selectedItem): Scope => ({
					_tag: "CommitFile",
					bindings: commitFilesBindings,
					context: selectedItem,
				}),
			),
			Match.tag(
				"BaseCommit",
				(): Scope => ({
					_tag: "BaseCommit",
					bindings: primaryPanelBindings,
				}),
			),
			Match.tag(
				"Segment",
				(selectedItem): Scope =>
					selectedItem.branchRef === null
						? {
								_tag: "Segment",
								bindings: primaryPanelBindings,
								context: selectedItem,
							}
						: {
								_tag: "Branch",
								bindings: branchBindings,
								context: selectedItem,
							},
			),
			Match.exhaustive,
		);

	return Match.value(workspaceMode).pipe(
		Match.tag(
			"Rub",
			(): Scope => ({
				_tag: "RubMode",
				bindings: operationModeBindings,
				context: selectedItem,
			}),
		),
		Match.tag(
			"Move",
			(): Scope => ({
				_tag: "MoveMode",
				bindings: operationModeBindings,
				context: selectedItem,
			}),
		),
		Match.tag("RewordCommit", (workspaceMode): Scope | null =>
			selectedItem?._tag === "Commit" && workspaceMode.commitId === selectedItem.commitId
				? {
						_tag: "CommitReword",
						bindings: commitEditingMessageBindings,
						context: selectedItem,
					}
				: null,
		),
		Match.tag("RenameBranch", (workspaceMode): Scope | null =>
			selectedItem?._tag === "Segment" &&
			workspaceMode.stackId === selectedItem.stackId &&
			workspaceMode.segmentIndex === selectedItem.segmentIndex
				? {
						_tag: "BranchRename",
						bindings: renameBranchBindings,
						context: selectedItem,
					}
				: null,
		),
		Match.tag("Default", (): Scope | null =>
			selectedItem ? getDefaultScopeForSelectedItem(selectedItem) : null,
		),
		Match.exhaustive,
	);
};

export const getLabel = (scope: Scope): string =>
	Match.value(scope).pipe(
		Match.tagsExhaustive({
			BaseCommit: () => "Base commit",
			BranchRename: () => "Rename branch",
			Change: () => "Change",
			ChangesSection: () => "Changes",
			RubMode: () => "Rub mode",
			MoveMode: () => "Move mode",
			CommitFile: () => "Commit file",
			CommitReword: () => "Reword commit",
			Commit: () => "Commit",
			Branch: () => "Branch",
			Segment: () => "Segment",
			Preview: () => "Preview",
		}),
	);

export const useWorkspaceShortcuts = ({
	branchRenameFormRef,
	commitMessageFormRef,
	projectId,
	scope,
	navigationIndex,
	requestAbsorptionPlan,
	operationMode,
	previewRef,
}: {
	branchRenameFormRef: RefObject<HTMLFormElement | null>;
	commitMessageFormRef: RefObject<HTMLFormElement | null>;
	projectId: string;
	scope: Scope | null;
	navigationIndex: NavigationIndex;
	requestAbsorptionPlan: (target: AbsorptionTarget) => void;
	operationMode: OperationMode | null;
	previewRef: RefObject<PreviewImperativeHandle | null>;
}) => {
	const dispatch = useAppDispatch();
	const resolveOperationSource = useResolveOperationSource(projectId);

	const runOperation = useRunOperation();
	const resolvedOperationModeSource = operationMode
		? resolveOperationSource(operationMode.source)
		: null;
	const confirmOperationMode = (selectedItem: Item | null) => {
		dispatch(projectActions.exitMode({ projectId }));

		const operationModeOperation =
			operationMode && selectedItem && resolvedOperationModeSource
				? operationModeToOperation({
						operationMode,
						resolvedOperationSource: resolvedOperationModeSource,
						target: selectedItem,
					})
				: null;

		if (!operationModeOperation) return;

		runOperation(projectId, operationModeOperation);
	};

	const requestAbsorptionPlanForItem = (selectedItem: Item) => {
		const operationSource = operationSourceFromItem(selectedItem);

		const resolvedOperationSource = resolveOperationSource(operationSource);
		if (resolvedOperationSource?._tag !== "TreeChanges") return;
		if (resolvedOperationSource.parent._tag !== "ChangesSection") return;

		requestAbsorptionPlan({
			type: "treeChanges",
			subject: {
				changes: resolvedOperationSource.changes.map(({ change }) => change),
				assigned_stack_id: resolvedOperationSource.parent.stackId,
			},
		});
	};

	const move = (offset: -1 | 1, selectedItem: Item) =>
		dispatch(
			projectActions.selectItem({
				projectId,
				item: (() => {
					const nextItem = getAdjacentItem(navigationIndex, selectedItem, offset);
					return nextItem ?? null;
				})(),
			}),
		);
	const previousSection = (selectedItem: Item) =>
		dispatch(
			projectActions.selectItem({
				projectId,
				item: (() => {
					const nextItem =
						getParentSection(selectedItem) ?? getAdjacentSection(navigationIndex, selectedItem, -1);
					return nextItem ?? null;
				})(),
			}),
		);
	const nextSection = (selectedItem: Item) =>
		dispatch(
			projectActions.selectItem({
				projectId,
				item: (() => {
					const nextItem = getAdjacentSection(navigationIndex, selectedItem, 1);
					return nextItem ?? null;
				})(),
			}),
		);

	const handleItemSelectionAction = (action: ItemSelectionAction, selectedItem: Item) =>
		Match.value(action).pipe(
			Match.tagsExhaustive({
				Move: ({ offset }) => move(offset, selectedItem),
				PreviousSection: () => previousSection(selectedItem),
				NextSection: () => nextSection(selectedItem),
				EnterRubMode: () => {
					dispatch(
						projectActions.enterRubMode({
							projectId,
							source: operationSourceFromItem(selectedItem),
						}),
					);
				},
				EnterMoveMode: () =>
					dispatch(
						projectActions.enterMoveMode({
							projectId,
							source: operationSourceFromItem(selectedItem),
						}),
					),
			}),
		);

	const handlePrimaryPanelAction = (action: PrimaryPanelAction, selectedItem: Item) =>
		Match.value(action).pipe(
			Match.tags({
				SelectUnassignedChanges: () =>
					dispatch(
						projectActions.selectItem({
							projectId,
							item: changesSectionItem(null),
						}),
					),
				FocusPreview: () => dispatch(projectActions.focusPreview({ projectId })),
				ToggleFullscreenPreview: () =>
					dispatch(projectActions.toggleFullscreenPreview({ projectId })),
				TogglePreview: () => dispatch(projectActions.togglePreview({ projectId })),
			}),
			Match.orElse((action) => handleItemSelectionAction(action, selectedItem)),
		);

	const handleHunkSelectionAction = (action: HunkSelectionAction) =>
		Match.value(action).pipe(
			Match.tagsExhaustive({
				Move: ({ offset }) => previewRef.current?.moveSelection(offset),
			}),
		);

	const handlePreviewAction = (action: PreviewAction) =>
		Match.value(action).pipe(
			Match.tags({
				FocusPrimary: () => dispatch(projectActions.focusPrimary({ projectId })),
				ToggleFullscreenPreview: () =>
					dispatch(projectActions.toggleFullscreenPreview({ projectId })),
				ClosePreview: () => dispatch(projectActions.closePreview({ projectId })),
				TogglePreview: () => dispatch(projectActions.togglePreview({ projectId })),
			}),
			Match.orElse((action) => handleHunkSelectionAction(action)),
		);

	const handleChangesAction = (action: ChangesAction, selectedItem: Item) =>
		Match.value(action).pipe(
			Match.tags({
				Absorb: () => requestAbsorptionPlanForItem(selectedItem),
			}),
			Match.orElse((action) => handlePrimaryPanelAction(action, selectedItem)),
		);

	const handleOperationModeAction = (action: OperationModeAction, selectedItem: Item | null) =>
		Match.value(action).pipe(
			Match.tags({
				Run: () => confirmOperationMode(selectedItem),
				Cancel: () => dispatch(projectActions.exitMode({ projectId })),
			}),
			Match.orElse((action) => {
				if (!selectedItem) return;
				handlePrimaryPanelAction(action, selectedItem);
			}),
		);

	const handleCommitAction = (action: CommitAction, selectedItem: CommitItem) =>
		Match.value(action).pipe(
			Match.tags({
				EditMessage: () =>
					dispatch(
						projectActions.startRewordCommit({
							projectId,
							item: selectedItem,
						}),
					),
				ToggleFiles: () =>
					dispatch(projectActions.toggleCommitFiles({ projectId, item: selectedItem })),
			}),
			Match.orElse((action) =>
				handlePrimaryPanelAction(action, { _tag: "Commit", ...selectedItem }),
			),
		);

	const handleCommitFileAction = (action: CommitFileAction, selectedItem: CommitFileItem) =>
		Match.value(action).pipe(
			Match.tags({
				ToggleFiles: () =>
					dispatch(projectActions.toggleCommitFiles({ projectId, item: selectedItem })),
				CloseFiles: () =>
					dispatch(projectActions.closeCommitFiles({ projectId, item: selectedItem })),
			}),
			Match.orElse((action) =>
				handlePrimaryPanelAction(action, { _tag: "CommitFile", ...selectedItem }),
			),
		);

	const handleCommitEditingMessageAction = (action: CommitEditingMessageAction) =>
		Match.value(action).pipe(
			Match.tagsExhaustive({
				Save: () => commitMessageFormRef.current?.requestSubmit(),
				Cancel: () => dispatch(projectActions.exitMode({ projectId })),
			}),
		);

	const handleBranchAction = (action: BranchAction, selectedItem: SegmentItem) =>
		Match.value(action).pipe(
			Match.tags({
				RenameBranch: () =>
					dispatch(
						projectActions.startRenameBranch({
							projectId,
							item: selectedItem,
						}),
					),
			}),
			Match.orElse((action) =>
				handlePrimaryPanelAction(action, { _tag: "Segment", ...selectedItem }),
			),
		);

	const handleRenameBranchAction = (action: RenameBranchAction) =>
		Match.value(action).pipe(
			Match.tagsExhaustive({
				Save: () => branchRenameFormRef.current?.requestSubmit(),
				Cancel: () => dispatch(projectActions.exitMode({ projectId })),
			}),
		);

	const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
		if (event.defaultPrevented) return;
		if (!scope) return;
		if (
			scope._tag !== "CommitReword" &&
			scope._tag !== "BranchRename" &&
			isTypingTarget(event.target)
		)
			return;

		Match.value(scope).pipe(
			Match.tagsExhaustive({
				ChangesSection: (scope) => {
					const action = getAction(scope.bindings, event);
					if (!action) return;
					event.preventDefault();
					handleChangesAction(action, { _tag: "ChangesSection", ...scope.context });
				},
				Change: (scope) => {
					const action = getAction(scope.bindings, event);
					if (!action) return;
					event.preventDefault();
					handleChangesAction(action, { _tag: "Change", ...scope.context });
				},
				RubMode: (scope) => {
					const action = getAction(scope.bindings, event);
					if (!action) return;
					event.preventDefault();
					handleOperationModeAction(action, scope.context);
				},
				MoveMode: (scope) => {
					const action = getAction(scope.bindings, event);
					if (!action) return;
					event.preventDefault();
					handleOperationModeAction(action, scope.context);
				},
				BaseCommit: (scope) => {
					const action = getAction(scope.bindings, event);
					if (!action) return;
					event.preventDefault();
					handlePrimaryPanelAction(action, { _tag: "BaseCommit" });
				},
				Segment: (scope) => {
					const action = getAction(scope.bindings, event);
					if (!action) return;
					event.preventDefault();
					handlePrimaryPanelAction(action, { _tag: "Segment", ...scope.context });
				},
				Branch: (scope) => {
					const action = getAction(scope.bindings, event);
					if (!action) return;
					event.preventDefault();
					handleBranchAction(action, scope.context);
				},
				Preview: (scope) => {
					const action = getAction(scope.bindings, event);
					if (!action) return;
					event.preventDefault();
					handlePreviewAction(action);
				},
				BranchRename: (scope) => {
					const action = getAction(scope.bindings, event);
					if (!action) return;
					event.preventDefault();
					handleRenameBranchAction(action);
				},
				Commit: (scope) => {
					const action = getAction(scope.bindings, event);
					if (!action) return;
					event.preventDefault();
					handleCommitAction(action, scope.context);
				},
				CommitFile: (scope) => {
					const action = getAction(scope.bindings, event);
					if (!action) return;
					event.preventDefault();
					handleCommitFileAction(action, scope.context);
				},
				CommitReword: (scope) => {
					const action = getAction(scope.bindings, event);
					if (!action) return;
					event.preventDefault();
					handleCommitEditingMessageAction(action);
				},
			}),
		);
	});

	useEffect(() => {
		window.addEventListener("keydown", handleKeyDown);

		return () => {
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, []);
};
