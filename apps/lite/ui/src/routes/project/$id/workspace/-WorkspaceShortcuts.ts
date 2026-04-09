import { commitDetailsWithLineStatsQueryOptions } from "#ui/api/queries.ts";
import { getAction, type ShortcutBinding } from "#ui/shortcuts.ts";
import { normalizeSelectedPath } from "#ui/routes/project/$id/-state/selection.ts";
import { isTypingTarget } from "#ui/routes/project/$id/-shared.tsx";
import { AbsorptionTarget } from "@gitbutler/but-sdk";
import { useQueryClient } from "@tanstack/react-query";
import { Match } from "effect";
import { Dispatch, RefObject, useEffect, useEffectEvent } from "react";
import { type ChangeItem, getParentSection, type ChangesSectionItem, Item } from "./-Item.ts";
import {
	type SelectedCommitItem,
	type SelectedItem,
	type SelectedSegmentItem,
	asSelectedItem,
	selectedChangesSectionItem,
	selectedCommitItem,
	selectedSegmentItem,
} from "./-SelectedItem.ts";
import { useResolveOperationSource } from "./-OperationSource.ts";
import { operationSourceRefFromItem } from "./-OperationSourceRef.ts";
import { getAdjacentItem, getAdjacentSection, type NavigationIndex } from "./-WorkspaceModel.ts";
import { getFocus, type ProjectLayoutState } from "#ui/routes/project/$id/-state/layout.ts";
import { type ProjectStateAction } from "#ui/routes/project/$id/-state/project.ts";
import { PreviewImperativeHandle } from "./route.tsx";

type ItemSelectionAction =
	| { _tag: "Move"; offset: -1 | 1 }
	| { _tag: "PreviousSection" }
	| { _tag: "NextSection" };

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
];

type PrimaryPanelAction =
	| ItemSelectionAction
	| { _tag: "SelectUnassignedChanges" }
	| { _tag: "FocusPreview" }
	| { _tag: "ToggleFullscreenPreview" }
	| { _tag: "TogglePreview" };

type ChangesAction = PrimaryPanelAction | { _tag: "Absorb" };

type CommitDefaultAction = PrimaryPanelAction | { _tag: "EditMessage" } | { _tag: "OpenDetails" };

type CommitDetailsAction = PrimaryPanelAction | { _tag: "CloseDetails" };

type HunkSelectionAction = { _tag: "Move"; offset: -1 | 1 };

type PreviewAction =
	| HunkSelectionAction
	| { _tag: "FocusPrimary" }
	| { _tag: "ToggleFullscreenPreview" }
	| { _tag: "ClosePreview" }
	| { _tag: "TogglePreview" };

const getAdjacentPath = ({
	paths,
	currentPath,
	offset,
}: {
	paths: Array<string>;
	currentPath: string | undefined;
	offset: -1 | 1;
}): string | null => {
	if (paths.length === 0) return null;
	if (currentPath === undefined) return offset > 0 ? (paths[0] ?? null) : (paths.at(-1) ?? null);

	const currentIndex = paths.indexOf(currentPath);
	if (currentIndex === -1) return offset > 0 ? (paths[0] ?? null) : (paths.at(-1) ?? null);
	return paths[currentIndex + offset] ?? null;
};

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
	keys: ["Ctrl+l"],
	action: { _tag: "FocusPreview" },
	repeat: false,
};

const focusPrimaryBinding: ShortcutBinding<PreviewAction> = {
	id: "focus-primary",
	description: "Focus primary",
	keys: ["Ctrl+h"],
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

const editCommitMessageBinding: ShortcutBinding<CommitDefaultAction> = {
	id: "commit-edit-message",
	description: "Reword",
	keys: ["Enter"],
	action: { _tag: "EditMessage" },
	repeat: false,
};

const openCommitDetailsBinding: ShortcutBinding<CommitDefaultAction> = {
	id: "commit-open-details",
	description: "Open details",
	keys: ["ArrowRight", "l"],
	action: { _tag: "OpenDetails" },
	repeat: false,
};

const commitDefaultBindings: Array<ShortcutBinding<CommitDefaultAction>> = [
	...primaryPanelBindings,
	editCommitMessageBinding,
	openCommitDetailsBinding,
];

const closeCommitDetailsBinding: ShortcutBinding<CommitDetailsAction> = {
	id: "commit-close-details",
	description: "Close details",
	keys: ["ArrowLeft", "Escape"],
	action: { _tag: "CloseDetails" },
	repeat: false,
};

const commitDetailsBindings: Array<ShortcutBinding<CommitDetailsAction>> = [
	...primaryPanelBindings,
	closeCommitDetailsBinding,
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
			_tag: "CommitDetails";
			bindings: Array<ShortcutBinding<CommitDetailsAction>>;
			context: SelectedCommitItem;
	  }
	| {
			_tag: "CommitReword";
			bindings: Array<ShortcutBinding<CommitEditingMessageAction>>;
			context: SelectedCommitItem;
	  }
	| {
			_tag: "BranchRename";
			bindings: Array<ShortcutBinding<RenameBranchAction>>;
			context: SelectedSegmentItem;
	  }
	| {
			_tag: "CommitDefault";
			bindings: Array<ShortcutBinding<CommitDefaultAction>>;
			context: SelectedCommitItem;
	  }
	| {
			_tag: "Segment";
			bindings: Array<ShortcutBinding<PrimaryPanelAction>>;
			context: SelectedSegmentItem;
	  }
	| {
			_tag: "BranchDefault";
			bindings: Array<ShortcutBinding<BranchAction>>;
			context: SelectedSegmentItem;
	  }
	| {
			_tag: "Preview";
			bindings: Array<ShortcutBinding<PreviewAction>>;
			context: { isFullscreen: boolean };
	  };

export const getScope = ({
	selectedItem,
	layoutState,
}: {
	selectedItem: SelectedItem | null;
	layoutState: ProjectLayoutState;
}): Scope | null => {
	if (getFocus(layoutState) === "preview")
		return {
			_tag: "Preview",
			bindings: layoutState.isFullscreenPreviewOpen ? fullscreenPreviewBindings : previewBindings,
			context: { isFullscreen: layoutState.isFullscreenPreviewOpen },
		};
	if (!selectedItem) return null;

	return Match.value(selectedItem).pipe(
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
			(selectedItem): Scope =>
				Match.value(selectedItem.mode).pipe(
					Match.tagsExhaustive({
						Reword: (): Scope => ({
							_tag: "CommitReword",
							bindings: commitEditingMessageBindings,
							context: selectedItem,
						}),
						Details: (): Scope => ({
							_tag: "CommitDetails",
							bindings: commitDetailsBindings,
							context: selectedItem,
						}),
						Default: (): Scope => ({
							_tag: "CommitDefault",
							bindings: commitDefaultBindings,
							context: selectedItem,
						}),
					}),
				),
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
				selectedItem.mode._tag === "Rename"
					? {
							_tag: "BranchRename",
							bindings: renameBranchBindings,
							context: selectedItem,
						}
					: selectedItem.branchRef === null
						? {
								_tag: "Segment",
								bindings: primaryPanelBindings,
								context: selectedItem,
							}
						: {
								_tag: "BranchDefault",
								bindings: branchBindings,
								context: selectedItem,
							},
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
			CommitDetails: () => "Commit details",
			CommitReword: () => "Reword commit",
			CommitDefault: () => "Commit",
			BranchDefault: () => "Branch",
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
	dispatchProjectState,
	previewRef,
}: {
	branchRenameFormRef: RefObject<HTMLFormElement | null>;
	commitMessageFormRef: RefObject<HTMLFormElement | null>;
	projectId: string;
	scope: Scope | null;
	navigationIndex: NavigationIndex;
	requestAbsorptionPlan: (target: AbsorptionTarget) => void;
	dispatchProjectState: Dispatch<ProjectStateAction>;
	previewRef: RefObject<PreviewImperativeHandle | null>;
}) => {
	const queryClient = useQueryClient();
	const resolveOperationSource = useResolveOperationSource(projectId);

	const requestAbsorptionPlanForItem = (item: Item) => {
		const operationSourceRef = operationSourceRefFromItem(item);

		const operationSource = resolveOperationSource(operationSourceRef);
		if (operationSource?._tag !== "TreeChanges") return;
		if (operationSource.parent._tag !== "ChangesSection") return;

		requestAbsorptionPlan({
			type: "treeChanges",
			subject: {
				changes: operationSource.changes.map(({ change }) => change),
				assigned_stack_id: operationSource.parent.stackId,
			},
		});
	};

	const moveCommitDetailsPath = (offset: -1 | 1, selectedItem: SelectedCommitItem) => {
		if (selectedItem.mode._tag !== "Details") return;

		const commitDetails = queryClient.getQueryData(
			commitDetailsWithLineStatsQueryOptions({
				projectId,
				commitId: selectedItem.commitId,
			}).queryKey,
		);
		if (!commitDetails) return;

		const paths = commitDetails.changes.map((change) => change.path);
		const currentPath = normalizeSelectedPath({
			paths,
			selectedPath: selectedItem.mode.path,
		});
		const nextPath = getAdjacentPath({ paths, currentPath, offset });
		if (nextPath === null) return;

		dispatchProjectState({
			_tag: "SelectItem",
			item: selectedCommitItem({
				...selectedItem,
				mode: { _tag: "Details", path: nextPath },
			}),
		});
	};

	const openCommitDetails = (selectedItem: SelectedCommitItem) => {
		dispatchProjectState({
			_tag: "SelectItem",
			item: selectedCommitItem({
				...selectedItem,
				mode: { _tag: "Details", path: null },
			}),
		});
	};

	const move = (offset: -1 | 1, selectedItem: SelectedItem) =>
		dispatchProjectState({
			_tag: "SelectItem",
			item: (() => {
				const nextItem = getAdjacentItem(navigationIndex, selectedItem, offset);
				return nextItem ? asSelectedItem(nextItem) : null;
			})(),
		});
	const previousSection = (selectedItem: SelectedItem) =>
		dispatchProjectState({
			_tag: "SelectItem",
			item: (() => {
				const nextItem =
					getParentSection(selectedItem) ?? getAdjacentSection(navigationIndex, selectedItem, -1);
				return nextItem ? asSelectedItem(nextItem) : null;
			})(),
		});
	const nextSection = (selectedItem: SelectedItem) =>
		dispatchProjectState({
			_tag: "SelectItem",
			item: (() => {
				const nextItem = getAdjacentSection(navigationIndex, selectedItem, 1);
				return nextItem ? asSelectedItem(nextItem) : null;
			})(),
		});

	const handleItemSelectionAction = (action: ItemSelectionAction, selectedItem: SelectedItem) =>
		Match.value(action).pipe(
			Match.tagsExhaustive({
				Move: ({ offset }) => move(offset, selectedItem),
				PreviousSection: () => previousSection(selectedItem),
				NextSection: () => nextSection(selectedItem),
			}),
		);

	const handlePrimaryPanelAction = (action: PrimaryPanelAction, selectedItem: SelectedItem) =>
		Match.value(action).pipe(
			Match.tags({
				SelectUnassignedChanges: () =>
					dispatchProjectState({
						_tag: "SelectItem",
						item: selectedChangesSectionItem(null),
					}),
				FocusPreview: () => dispatchProjectState({ _tag: "FocusPreview" }),
				ToggleFullscreenPreview: () => dispatchProjectState({ _tag: "ToggleFullscreenPreview" }),
				TogglePreview: () => dispatchProjectState({ _tag: "TogglePreview" }),
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
				FocusPrimary: () => dispatchProjectState({ _tag: "FocusPrimary" }),
				ToggleFullscreenPreview: () => dispatchProjectState({ _tag: "ToggleFullscreenPreview" }),
				ClosePreview: () => dispatchProjectState({ _tag: "ClosePreview" }),
				TogglePreview: () => dispatchProjectState({ _tag: "TogglePreview" }),
			}),
			Match.orElse((action) => handleHunkSelectionAction(action)),
		);

	const handleChangesAction = (action: ChangesAction, selectedItem: SelectedItem) =>
		Match.value(action).pipe(
			Match.tags({
				Absorb: () => requestAbsorptionPlanForItem(selectedItem),
			}),
			Match.orElse((action) => handlePrimaryPanelAction(action, selectedItem)),
		);

	const handleCommitDefaultAction = (
		action: CommitDefaultAction,
		selectedItem: SelectedCommitItem,
	) =>
		Match.value(action).pipe(
			Match.tags({
				EditMessage: () =>
					dispatchProjectState({
						_tag: "SelectItem",
						item: selectedCommitItem({ ...selectedItem, mode: { _tag: "Reword" } }),
					}),
				OpenDetails: () => openCommitDetails(selectedItem),
			}),
			Match.orElse((action) =>
				handlePrimaryPanelAction(action, { _tag: "Commit", ...selectedItem }),
			),
		);

	const handleCommitDetailsAction = (
		action: CommitDetailsAction,
		selectedItem: SelectedCommitItem,
	) =>
		Match.value(action).pipe(
			Match.tags({
				Move: ({ offset }) => moveCommitDetailsPath(offset, selectedItem),
				CloseDetails: () =>
					dispatchProjectState({
						_tag: "SelectItem",
						item: selectedCommitItem({ ...selectedItem, mode: { _tag: "Default" } }),
					}),
			}),
			Match.orElse((action) =>
				handlePrimaryPanelAction(action, { _tag: "Commit", ...selectedItem }),
			),
		);

	const handleCommitEditingMessageAction = (
		action: CommitEditingMessageAction,
		selectedItem: SelectedCommitItem,
	) =>
		Match.value(action).pipe(
			Match.tagsExhaustive({
				Save: () => commitMessageFormRef.current?.requestSubmit(),
				Cancel: () =>
					dispatchProjectState({
						_tag: "SelectItem",
						item: selectedCommitItem({ ...selectedItem, mode: { _tag: "Default" } }),
					}),
			}),
		);

	const handleBranchAction = (action: BranchAction, selectedItem: SelectedSegmentItem) =>
		Match.value(action).pipe(
			Match.tags({
				RenameBranch: () =>
					dispatchProjectState({
						_tag: "SelectItem",
						item: selectedSegmentItem({
							...selectedItem,
							mode: { _tag: "Rename" },
						}),
					}),
			}),
			Match.orElse((action) =>
				handlePrimaryPanelAction(action, { _tag: "Segment", ...selectedItem }),
			),
		);

	const handleRenameBranchAction = (
		action: RenameBranchAction,
		selectedItem: SelectedSegmentItem,
	) =>
		Match.value(action).pipe(
			Match.tagsExhaustive({
				Save: () => branchRenameFormRef.current?.requestSubmit(),
				Cancel: () =>
					dispatchProjectState({
						_tag: "SelectItem",
						item: selectedSegmentItem({ ...selectedItem, mode: { _tag: "Default" } }),
					}),
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
				BranchDefault: (scope) => {
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
					handleRenameBranchAction(action, scope.context);
				},
				CommitDefault: (scope) => {
					const action = getAction(scope.bindings, event);
					if (!action) return;
					event.preventDefault();
					handleCommitDefaultAction(action, scope.context);
				},
				CommitDetails: (scope) => {
					const action = getAction(scope.bindings, event);
					if (!action) return;
					event.preventDefault();
					handleCommitDetailsAction(action, scope.context);
				},
				CommitReword: (scope) => {
					const action = getAction(scope.bindings, event);
					if (!action) return;
					event.preventDefault();
					handleCommitEditingMessageAction(action, scope.context);
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
