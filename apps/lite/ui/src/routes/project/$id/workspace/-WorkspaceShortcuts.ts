import { getAction, type ShortcutActionBase, type ShortcutBinding } from "#ui/shortcuts.ts";
import { useRunOperation } from "#ui/Operation.ts";
import { isTypingTarget } from "#ui/routes/project/$id/-shared.tsx";
import { getFocus, type ProjectLayoutState } from "#ui/routes/project/$id/-state/layout.ts";
import { projectActions } from "#ui/routes/project/$id/-state/projectSlice.ts";
import { useAppDispatch } from "#ui/state/hooks.ts";
import { AbsorptionTarget } from "@gitbutler/but-sdk";
import { Match } from "effect";
import { RefObject, useEffect, useEffectEvent } from "react";
import {
	type ChangeItem,
	changesSectionItem,
	type ChangesSectionItem,
	type CommitFileItem,
	type CommitItem,
	getParentSection,
	type Item,
	type SegmentItem,
} from "./-Item.ts";
import { operationModeToOperation } from "./-OperationMode.tsx";
import { operationSourceFromItem } from "./-OperationSource.ts";
import { useResolveOperationSource } from "./-ResolvedOperationSource.ts";
import { PreviewImperativeHandle } from "./route.tsx";
import { getAdjacentItem, getAdjacentSection, type NavigationIndex } from "./-WorkspaceModel.ts";
import { OperationMode, type WorkspaceMode } from "./-WorkspaceMode.ts";

type EnterMoveModeAction = { _tag: "EnterMoveMode" };
type EnterRubModeAction = { _tag: "EnterRubMode" };

type ItemSelectionAction =
	| EnterMoveModeAction
	| EnterRubModeAction
	| { _tag: "Move"; offset: -1 | 1 }
	| { _tag: "NextSection" }
	| { _tag: "PreviousSection" };

const itemSelectionBindings: Array<ShortcutBinding<ItemSelectionAction>> = [
	{
		id: "item-selection-move-up",
		description: "up",
		keys: ["ArrowUp", "k"],
		action: { _tag: "Move", offset: -1 },
	},
	{
		id: "item-selection-move-down",
		description: "down",
		keys: ["ArrowDown", "j"],
		action: { _tag: "Move", offset: 1 },
	},
	{
		id: "item-selection-previous-section",
		description: "Previous section",
		keys: ["Shift+ArrowUp", "Shift+k"],
		action: { _tag: "PreviousSection" },
		showInShortcutsBar: false,
	},
	{
		id: "item-selection-next-section",
		description: "Next section",
		keys: ["Shift+ArrowDown", "Shift+j"],
		action: { _tag: "NextSection" },
		showInShortcutsBar: false,
	},
	{
		id: "item-selection-enter-rub-mode",
		description: "Rub",
		keys: ["r"],
		action: { _tag: "EnterRubMode" },
		repeat: false,
	},
	{
		id: "item-selection-enter-move-mode",
		description: "Move",
		keys: ["m"],
		action: { _tag: "EnterMoveMode" },
		repeat: false,
	},
];

type PrimaryPanelAction =
	| ItemSelectionAction
	| { _tag: "FocusPreview" }
	| { _tag: "SelectUnassignedChanges" }
	| { _tag: "ToggleFullscreenPreview" }
	| { _tag: "TogglePreview" };

export const togglePreviewBinding: ShortcutBinding<PrimaryPanelAction> = {
	id: "primary-panel-toggle-preview",
	description: "Preview",
	keys: ["p"],
	action: { _tag: "TogglePreview" },
	repeat: false,
};

export const toggleFullscreenPreviewBinding: ShortcutBinding<PrimaryPanelAction> = {
	id: "primary-panel-toggle-fullscreen-preview",
	description: "Fullscreen preview",
	keys: ["d"],
	action: { _tag: "ToggleFullscreenPreview" },
	repeat: false,
};

const primaryPanelBindings: Array<ShortcutBinding<PrimaryPanelAction>> = [
	...itemSelectionBindings,
	{
		id: "primary-panel-select-unassigned-changes",
		description: "Unassigned changes",
		keys: ["z"],
		action: { _tag: "SelectUnassignedChanges" },
		repeat: false,
	},
	{
		id: "primary-panel-focus-preview",
		description: "Focus preview",
		keys: ["l"],
		action: { _tag: "FocusPreview" },
		repeat: false,
	},
	toggleFullscreenPreviewBinding,
	togglePreviewBinding,
];

type ChangesAction = PrimaryPanelAction | { _tag: "Absorb" };

const changesBindings: Array<ShortcutBinding<ChangesAction>> = [
	...primaryPanelBindings,
	{
		id: "changes-absorb",
		description: "Absorb",
		keys: ["a"],
		action: { _tag: "Absorb" },
		repeat: false,
	},
];

type CommitToggleFilesAction = { _tag: "ToggleFiles" };

const toggleCommitFilesBinding: ShortcutBinding<CommitToggleFilesAction> = {
	id: "commit-toggle-files",
	description: "Files",
	keys: ["f"],
	action: { _tag: "ToggleFiles" },
	repeat: false,
};

type CommitAction = PrimaryPanelAction | CommitToggleFilesAction | { _tag: "EditMessage" };

const commitDefaultBindings: Array<ShortcutBinding<CommitAction>> = [
	...primaryPanelBindings,
	toggleCommitFilesBinding,
	{
		id: "commit-reword",
		description: "Reword",
		keys: ["Enter"],
		action: { _tag: "EditMessage" },
		repeat: false,
	},
];

type CommitFileAction = PrimaryPanelAction | CommitToggleFilesAction | { _tag: "CloseFiles" };

const commitFilesBindings: Array<ShortcutBinding<CommitFileAction>> = [
	...primaryPanelBindings,
	toggleCommitFilesBinding,
	{
		id: "commit-file-close",
		description: "Close",
		keys: ["Escape"],
		action: { _tag: "CloseFiles" },
		repeat: false,
	},
];

type BranchAction = PrimaryPanelAction | { _tag: "RenameBranch" };

const branchBindings: Array<ShortcutBinding<BranchAction>> = [
	...primaryPanelBindings,
	{
		id: "branch-rename",
		description: "Rename",
		keys: ["Enter"],
		action: { _tag: "RenameBranch" },
		repeat: false,
	},
];

type DefaultModeScope =
	| {
			_tag: "BaseCommit";
			bindings: Array<ShortcutBinding<PrimaryPanelAction>>;
	  }
	| {
			_tag: "Branch";
			bindings: Array<ShortcutBinding<BranchAction>>;
			context: SegmentItem;
	  }
	| {
			_tag: "Change";
			bindings: Array<ShortcutBinding<ChangesAction>>;
			context: ChangeItem;
	  }
	| {
			_tag: "ChangesSection";
			bindings: Array<ShortcutBinding<ChangesAction>>;
			context: ChangesSectionItem;
	  }
	| {
			_tag: "Commit";
			bindings: Array<ShortcutBinding<CommitAction>>;
			context: CommitItem;
	  }
	| {
			_tag: "CommitFile";
			bindings: Array<ShortcutBinding<CommitFileAction>>;
			context: CommitFileItem;
	  }
	| {
			_tag: "Segment";
			bindings: Array<ShortcutBinding<PrimaryPanelAction>>;
			context: SegmentItem;
	  };

const getDefaultModeScope = (selectedItem: Item): DefaultModeScope =>
	Match.value(selectedItem).pipe(
		Match.tagsExhaustive({
			BaseCommit: (): DefaultModeScope => ({
				_tag: "BaseCommit",
				bindings: primaryPanelBindings,
			}),
			Change: (selectedItem): DefaultModeScope => ({
				_tag: "Change",
				bindings: changesBindings,
				context: selectedItem,
			}),
			ChangesSection: (selectedItem): DefaultModeScope => ({
				_tag: "ChangesSection",
				bindings: changesBindings,
				context: selectedItem,
			}),
			Commit: (selectedItem): DefaultModeScope => ({
				_tag: "Commit",
				bindings: commitDefaultBindings,
				context: selectedItem,
			}),
			CommitFile: (selectedItem): DefaultModeScope => ({
				_tag: "CommitFile",
				bindings: commitFilesBindings,
				context: selectedItem,
			}),
			Segment: (selectedItem): DefaultModeScope =>
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
		}),
	);

const getDefaultModeScopeLabel = (scope: DefaultModeScope): string =>
	Match.value(scope).pipe(
		Match.tagsExhaustive({
			BaseCommit: () => "Base commit",
			Branch: () => "Branch",
			Change: () => "Change",
			ChangesSection: () => "Changes",
			Commit: () => "Commit",
			CommitFile: () => "Commit file",
			Segment: () => "Segment",
		}),
	);

type HunkSelectionAction = { _tag: "Move"; offset: -1 | 1 };

type PreviewAction =
	| { _tag: "ClosePreview" }
	| { _tag: "FocusPrimary" }
	| HunkSelectionAction
	| { _tag: "ToggleFullscreenPreview" }
	| { _tag: "TogglePreview" };

export const closePreviewBinding: ShortcutBinding<PreviewAction> = {
	id: "preview-close",
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
	{
		id: "preview-focus-primary",
		description: "Focus primary",
		keys: ["h"],
		action: { _tag: "FocusPrimary" },
		repeat: false,
	},
	{
		id: "preview-toggle-fullscreen-preview",
		description: "Fullscreen preview",
		keys: ["d"],
		action: { _tag: "ToggleFullscreenPreview" },
		repeat: false,
	},
	{
		id: "preview-toggle-preview",
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

type PreviewScope = {
	_tag: "Preview";
	bindings: Array<ShortcutBinding<PreviewAction>>;
	context: { isFullscreen: boolean };
};

type OperationModeAction = PrimaryPanelAction | { _tag: "Cancel" } | { _tag: "Run" };

const operationModeBindings: Array<ShortcutBinding<OperationModeAction>> = [
	...primaryPanelBindings.filter(
		(binding) => binding.action._tag !== "EnterRubMode" && binding.action._tag !== "EnterMoveMode",
	),
	{
		id: "operation-mode-confirm",
		description: "Run",
		keys: ["Enter"],
		action: { _tag: "Run" },
		repeat: false,
	},
	{
		id: "operation-mode-cancel",
		description: "Cancel",
		keys: ["Escape"],
		action: { _tag: "Cancel" },
		repeat: false,
	},
];

type OperationModeScope =
	| {
			_tag: "Move";
			bindings: Array<ShortcutBinding<OperationModeAction>>;
			context: Item | null;
	  }
	| {
			_tag: "Rub";
			bindings: Array<ShortcutBinding<OperationModeAction>>;
			context: Item | null;
	  };

const getOperationModeScopeLabel = (scope: OperationModeScope): string =>
	Match.value(scope).pipe(
		Match.tagsExhaustive({
			Move: () => "Move mode",
			Rub: () => "Rub mode",
		}),
	);

type RewordCommitAction = { _tag: "Cancel" } | { _tag: "Save" };

export const rewordCommitBindings: Array<ShortcutBinding<RewordCommitAction>> = [
	{
		id: "commit-reword-save",
		description: "Save",
		keys: ["Enter"],
		action: { _tag: "Save" },
		repeat: false,
	},
	{
		id: "commit-reword-cancel",
		description: "Cancel",
		keys: ["Escape"],
		action: { _tag: "Cancel" },
		repeat: false,
	},
];

type RenameBranchAction = { _tag: "Cancel" } | { _tag: "Save" };

export const renameBranchBindings: Array<ShortcutBinding<RenameBranchAction>> = [
	{
		id: "branch-rename-save",
		description: "Save",
		keys: ["Enter"],
		action: { _tag: "Save" },
		repeat: false,
	},
	{
		id: "branch-rename-cancel",
		description: "Cancel",
		keys: ["Escape"],
		action: { _tag: "Cancel" },
		repeat: false,
	},
];

type ModeScope =
	| {
			_tag: "Default";
			scope: DefaultModeScope;
	  }
	| {
			_tag: "RenameBranch";
			bindings: Array<ShortcutBinding<RenameBranchAction>>;
			context: SegmentItem;
	  }
	| {
			_tag: "RewordCommit";
			bindings: Array<ShortcutBinding<RewordCommitAction>>;
			context: CommitItem;
	  }
	| OperationModeScope;

const getModeScope = ({
	selectedItem,
	workspaceMode,
}: {
	selectedItem: Item | null;
	workspaceMode: WorkspaceMode;
}): ModeScope | null =>
	Match.value(workspaceMode).pipe(
		Match.tagsExhaustive({
			Default: (): ModeScope | null =>
				selectedItem
					? {
							_tag: "Default",
							scope: getDefaultModeScope(selectedItem),
						}
					: null,
			Move: (): ModeScope => ({
				_tag: "Move",
				bindings: operationModeBindings,
				context: selectedItem,
			}),
			RenameBranch: (workspaceMode): ModeScope | null =>
				selectedItem?._tag === "Segment" &&
				workspaceMode.stackId === selectedItem.stackId &&
				workspaceMode.segmentIndex === selectedItem.segmentIndex
					? {
							_tag: "RenameBranch",
							bindings: renameBranchBindings,
							context: selectedItem,
						}
					: null,
			RewordCommit: (workspaceMode): ModeScope | null =>
				selectedItem?._tag === "Commit" && workspaceMode.commitId === selectedItem.commitId
					? {
							_tag: "RewordCommit",
							bindings: rewordCommitBindings,
							context: selectedItem,
						}
					: null,
			Rub: (): ModeScope => ({
				_tag: "Rub",
				bindings: operationModeBindings,
				context: selectedItem,
			}),
		}),
	);

type Scope = ModeScope | PreviewScope;

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

	return getModeScope({ selectedItem, workspaceMode });
};

export const getScopeBindings = (scope: Scope): Array<ShortcutBinding<ShortcutActionBase>> =>
	Match.value(scope).pipe(
		Match.tagsExhaustive({
			Default: ({ scope }) => scope.bindings,
			Move: ({ bindings }) => bindings,
			Preview: ({ bindings }) => bindings,
			RenameBranch: ({ bindings }) => bindings,
			RewordCommit: ({ bindings }) => bindings,
			Rub: ({ bindings }) => bindings,
		}),
	);

export const getScopeLabel = (scope: Scope): string =>
	Match.value(scope).pipe(
		Match.tagsExhaustive({
			Default: ({ scope }) => getDefaultModeScopeLabel(scope),
			Move: (scope) => getOperationModeScopeLabel(scope),
			Preview: () => "Preview",
			RenameBranch: () => "Rename branch",
			RewordCommit: () => "Reword commit",
			Rub: (scope) => getOperationModeScopeLabel(scope),
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

	const selectItem = (item: Item | null) =>
		dispatch(
			projectActions.selectItem({
				projectId,
				item,
			}),
		);

	const selectRelativeItem = (selectedItem: Item, offset: -1 | 1) =>
		selectItem(getAdjacentItem(navigationIndex, selectedItem, offset) ?? null);

	const selectPreviousSectionItem = (selectedItem: Item) =>
		selectItem(
			getParentSection(selectedItem) ?? getAdjacentSection(navigationIndex, selectedItem, -1),
		);

	const selectNextSectionItem = (selectedItem: Item) =>
		selectItem(getAdjacentSection(navigationIndex, selectedItem, 1) ?? null);

	const handleItemSelectionAction = (action: ItemSelectionAction, selectedItem: Item) =>
		Match.value(action).pipe(
			Match.tagsExhaustive({
				EnterMoveMode: () =>
					dispatch(
						projectActions.enterMoveMode({
							projectId,
							source: operationSourceFromItem(selectedItem),
						}),
					),
				EnterRubMode: () =>
					dispatch(
						projectActions.enterRubMode({
							projectId,
							source: operationSourceFromItem(selectedItem),
						}),
					),
				Move: ({ offset }) => selectRelativeItem(selectedItem, offset),
				NextSection: () => selectNextSectionItem(selectedItem),
				PreviousSection: () => selectPreviousSectionItem(selectedItem),
			}),
		);

	const handlePrimaryPanelAction = (action: PrimaryPanelAction, selectedItem: Item) =>
		Match.value(action).pipe(
			Match.tags({
				FocusPreview: () => dispatch(projectActions.focusPreview({ projectId })),
				SelectUnassignedChanges: () => selectItem(changesSectionItem(null)),
				ToggleFullscreenPreview: () =>
					dispatch(projectActions.toggleFullscreenPreview({ projectId })),
				TogglePreview: () => dispatch(projectActions.togglePreview({ projectId })),
			}),
			Match.orElse((action) => handleItemSelectionAction(action, selectedItem)),
		);

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

	const handleChangesScopeAction = (action: ChangesAction, selectedItem: Item) =>
		Match.value(action).pipe(
			Match.tags({
				Absorb: () => requestAbsorptionPlanForItem(selectedItem),
			}),
			Match.orElse((action) => handlePrimaryPanelAction(action, selectedItem)),
		);

	const handleCommitScopeAction = (action: CommitAction, selectedItem: CommitItem) =>
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

	const handleCommitFileScopeAction = (action: CommitFileAction, selectedItem: CommitFileItem) =>
		Match.value(action).pipe(
			Match.tags({
				CloseFiles: () =>
					dispatch(projectActions.closeCommitFiles({ projectId, item: selectedItem })),
				ToggleFiles: () =>
					dispatch(projectActions.toggleCommitFiles({ projectId, item: selectedItem })),
			}),
			Match.orElse((action) =>
				handlePrimaryPanelAction(action, { _tag: "CommitFile", ...selectedItem }),
			),
		);

	const handleBranchScopeAction = (action: BranchAction, selectedItem: SegmentItem) =>
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

	const handleDefaultScopeKeyDown = (scope: DefaultModeScope, event: KeyboardEvent) =>
		Match.value(scope).pipe(
			Match.tagsExhaustive({
				BaseCommit: (scope) => {
					const action = getAction(scope.bindings, event);
					if (!action) return;
					event.preventDefault();
					handlePrimaryPanelAction(action, { _tag: "BaseCommit" });
				},
				Branch: (scope) => {
					const action = getAction(scope.bindings, event);
					if (!action) return;
					event.preventDefault();
					handleBranchScopeAction(action, scope.context);
				},
				Change: (scope) => {
					const action = getAction(scope.bindings, event);
					if (!action) return;
					event.preventDefault();
					handleChangesScopeAction(action, { _tag: "Change", ...scope.context });
				},
				ChangesSection: (scope) => {
					const action = getAction(scope.bindings, event);
					if (!action) return;
					event.preventDefault();
					handleChangesScopeAction(action, { _tag: "ChangesSection", ...scope.context });
				},
				Commit: (scope) => {
					const action = getAction(scope.bindings, event);
					if (!action) return;
					event.preventDefault();
					handleCommitScopeAction(action, scope.context);
				},
				CommitFile: (scope) => {
					const action = getAction(scope.bindings, event);
					if (!action) return;
					event.preventDefault();
					handleCommitFileScopeAction(action, scope.context);
				},
				Segment: (scope) => {
					const action = getAction(scope.bindings, event);
					if (!action) return;
					event.preventDefault();
					handlePrimaryPanelAction(action, { _tag: "Segment", ...scope.context });
				},
			}),
		);

	const handlePreviewSelectionAction = (action: HunkSelectionAction) =>
		Match.value(action).pipe(
			Match.tagsExhaustive({
				Move: ({ offset }) => previewRef.current?.moveSelection(offset),
			}),
		);

	const handlePreviewScopeAction = (action: PreviewAction) =>
		Match.value(action).pipe(
			Match.tags({
				ClosePreview: () => dispatch(projectActions.closePreview({ projectId })),
				FocusPrimary: () => dispatch(projectActions.focusPrimary({ projectId })),
				ToggleFullscreenPreview: () =>
					dispatch(projectActions.toggleFullscreenPreview({ projectId })),
				TogglePreview: () => dispatch(projectActions.togglePreview({ projectId })),
			}),
			Match.orElse((action) => handlePreviewSelectionAction(action)),
		);

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

	const handleOperationModeScopeAction = (action: OperationModeAction, selectedItem: Item | null) =>
		Match.value(action).pipe(
			Match.tags({
				Cancel: () => dispatch(projectActions.exitMode({ projectId })),
				Run: () => confirmOperationMode(selectedItem),
			}),
			Match.orElse((action) => {
				if (!selectedItem) return;
				handlePrimaryPanelAction(action, selectedItem);
			}),
		);

	const handleOperationModeScopeKeyDown = (scope: OperationModeScope, event: KeyboardEvent) => {
		const action = getAction(scope.bindings, event);
		if (!action) return;
		event.preventDefault();
		handleOperationModeScopeAction(action, scope.context);
	};

	const handleRewordCommitScopeAction = (action: RewordCommitAction) =>
		Match.value(action).pipe(
			Match.tagsExhaustive({
				Cancel: () => dispatch(projectActions.exitMode({ projectId })),
				Save: () => commitMessageFormRef.current?.requestSubmit(),
			}),
		);

	const handleRenameBranchScopeAction = (action: RenameBranchAction) =>
		Match.value(action).pipe(
			Match.tagsExhaustive({
				Cancel: () => dispatch(projectActions.exitMode({ projectId })),
				Save: () => branchRenameFormRef.current?.requestSubmit(),
			}),
		);

	const handleScopeKeyDown = (scope: Scope, event: KeyboardEvent) =>
		scope._tag === "Move" || scope._tag === "Rub"
			? handleOperationModeScopeKeyDown(scope, event)
			: Match.value(scope).pipe(
					Match.tagsExhaustive({
						Default: ({ scope }) => handleDefaultScopeKeyDown(scope, event),
						Preview: (scope) => {
							const action = getAction(scope.bindings, event);
							if (!action) return;
							event.preventDefault();
							handlePreviewScopeAction(action);
						},
						RenameBranch: (scope) => {
							const action = getAction(scope.bindings, event);
							if (!action) return;
							event.preventDefault();
							handleRenameBranchScopeAction(action);
						},
						RewordCommit: (scope) => {
							const action = getAction(scope.bindings, event);
							if (!action) return;
							event.preventDefault();
							handleRewordCommitScopeAction(action);
						},
					}),
				);

	const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
		if (event.defaultPrevented) return;
		if (!scope) return;
		if (
			scope._tag !== "RewordCommit" &&
			scope._tag !== "RenameBranch" &&
			isTypingTarget(event.target)
		)
			return;

		handleScopeKeyDown(scope, event);
	});

	useEffect(() => {
		window.addEventListener("keydown", handleKeyDown);

		return () => {
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, []);
};
