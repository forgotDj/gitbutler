import { bytesEqual } from "#ui/api/bytes.ts";
import { rewrittenCommitOperand, rewrittenCommitSelection } from "#ui/commit.ts";
import {
	branchOperand,
	commitOperand,
	hunkOperand,
	operandEquals,
	type BranchOperand,
	type CommitOperand,
	type HunkOperand,
	type Operand,
} from "#ui/operands.ts";
import type { OperationType } from "#ui/operations/operation.ts";
import {
	absorbOutlineMode,
	defaultOutlineMode,
	isValidOutlineModeForSelection,
	keyboardTransferMode,
	pointerTransferMode,
	renameBranchOutlineMode,
	rewordCommitOutlineMode,
	transferOutlineMode,
	type OutlineMode,
	type TransferMode,
} from "#ui/outline/mode.ts";
import type { AbsorptionTarget, RefInfo, RelativeTo } from "@gitbutler/but-sdk";
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { Match } from "effect";

type Dialog =
	| { _tag: "None" }
	| { _tag: "ApplyBranchPicker" }
	| { _tag: "BranchPicker" }
	| { _tag: "CommandPalette" }
	| { _tag: "ProjectPicker" }
	| { _tag: "Settings" };

export type SelectionState = {
	outline: Operand | null;
	files: string | null;
	diff: HunkOperand | null;
};

type WorkspaceState = {
	checkedCommitIds: Record<string, true>;
	commitTarget: RelativeTo | null;
	highlightedCommitIds: Array<string>;
	mode: OutlineMode;
	selection: SelectionState;
};

const createInitialSelectionState = (): SelectionState => ({
	outline: null,
	files: null,
	diff: null,
});

const createInitialWorkspaceState = (): WorkspaceState => ({
	checkedCommitIds: {},
	commitTarget: null,
	highlightedCommitIds: [],
	mode: defaultOutlineMode,
	selection: createInitialSelectionState(),
});

type ProjectState = {
	detailsFullWindow: boolean;
	dialog: Dialog;
	filesVisible: boolean;
	workspace: WorkspaceState;
};

type ProjectSliceState = {
	byProjectId: Record<string, ProjectState>;
};

const createInitialProjectState = (): ProjectState => ({
	detailsFullWindow: false,
	dialog: { _tag: "None" },
	filesVisible: false,
	workspace: createInitialWorkspaceState(),
});

const initialProjectState: ProjectState = createInitialProjectState();

const initialState: ProjectSliceState = {
	byProjectId: {},
};

const ensureProjectState = (state: ProjectSliceState, projectId: string): ProjectState => {
	const existingState = state.byProjectId[projectId];
	if (existingState) return existingState;

	const projectState = createInitialProjectState();
	state.byProjectId[projectId] = projectState;
	return projectState;
};

const selectProjectState = (state: ProjectSliceState, projectId: string): ProjectState =>
	state.byProjectId[projectId] ?? initialProjectState;

const selectProjectWorkspaceState = (state: ProjectSliceState, projectId: string) =>
	selectProjectState(state, projectId).workspace;

const enterTransferMode = (state: WorkspaceState, mode: TransferMode) => {
	state.mode = transferOutlineMode(mode);
};

const enterKeyboardTransferMode = (
	state: WorkspaceState,
	source: Operand,
	operationType?: OperationType,
) => {
	state.mode = transferOutlineMode(
		keyboardTransferMode({
			source,
			operationType: operationType ?? "into",
			restoreSelection: {
				outline: state.selection.outline,
				files: state.selection.files,
				diff: state.selection.diff,
			},
		}),
	);
};

const enterAbsorbMode = (
	state: WorkspaceState,
	source: Operand,
	sourceTarget: AbsorptionTarget,
) => {
	state.mode = absorbOutlineMode({
		source,
		restoreSelection: {
			outline: state.selection.outline,
			files: state.selection.files,
			diff: state.selection.diff,
		},
		sourceTarget,
	});
};

const updatePointerTransfer = (
	state: WorkspaceState,
	target: Operand | null,
	operationType: OperationType | null,
) => {
	Match.value(state.mode).pipe(
		Match.when({ _tag: "Transfer", value: { _tag: "Pointer" } }, ({ value: mode }) => {
			const sameTarget =
				target === null
					? mode.target === null
					: mode.target !== null && operandEquals(mode.target, target);
			if (sameTarget && mode.operationType === operationType) return;

			state.mode = transferOutlineMode(
				pointerTransferMode({
					source: mode.source,
					target,
					operationType,
				}),
			);
		}),
		Match.orElse(() => {}),
	);
};

const updateTransferOperationType = (state: WorkspaceState, operationType: OperationType) => {
	Match.value(state.mode).pipe(
		Match.when({ _tag: "Transfer", value: { _tag: "Keyboard" } }, ({ value: mode }) => {
			state.mode = transferOutlineMode(
				keyboardTransferMode({
					source: mode.source,
					operationType,
					restoreSelection: mode.restoreSelection,
				}),
			);
		}),
		Match.orElse(() => {}),
	);
};

const exitMode = (state: WorkspaceState) => {
	state.mode = defaultOutlineMode;
};

const cancelMode = (state: WorkspaceState) => {
	const restoreSelection = Match.value(state.mode).pipe(
		Match.tags({
			Absorb: (mode) => mode.restoreSelection,
			Transfer: (mode) => (mode.value._tag === "Keyboard" ? mode.value.restoreSelection : null),
		}),
		Match.orElse(() => null),
	);
	exitMode(state);

	if (!restoreSelection) return;

	state.selection = restoreSelection;
};

const selectOutline = (state: WorkspaceState, selection: Operand | null) => {
	if (selection && state.selection.outline && operandEquals(state.selection.outline, selection))
		return;

	state.selection.outline = selection;
	state.selection.files = null;
	state.selection.diff = null;

	if (!selection || !isValidOutlineModeForSelection({ mode: state.mode, selection }))
		exitMode(state);
};

const selectFiles = (state: WorkspaceState, selection: string | null) => {
	if (state.selection.files === selection) return;

	state.selection.files = selection;
};

const selectDiff = (state: WorkspaceState, selection: HunkOperand | null) => {
	if (
		selection &&
		state.selection.diff &&
		operandEquals(hunkOperand(state.selection.diff), hunkOperand(selection))
	)
		return;

	state.selection.diff = selection;
};

const setHighlightedCommitIds = (state: WorkspaceState, commitIds: Array<string> | null) => {
	state.highlightedCommitIds = commitIds ?? [];
};

const setCommitChecked = (state: WorkspaceState, commitId: string, checked: boolean) => {
	if (checked) state.checkedCommitIds[commitId] = true;
	else delete state.checkedCommitIds[commitId];
};

const setCommitsChecked = (state: WorkspaceState, commitIds: Array<string>, checked: boolean) => {
	for (const commitId of commitIds) {
		if (checked) state.checkedCommitIds[commitId] = true;
		else delete state.checkedCommitIds[commitId];
	}
};

const clearCheckedCommits = (state: WorkspaceState) => {
	state.checkedCommitIds = {};
};

const setCommitTarget = (state: WorkspaceState, commitTarget: RelativeTo | null) => {
	state.commitTarget = commitTarget;
};

const updateRewrittenCommitReferences = (
	state: WorkspaceState,
	replacedCommits: Record<string, string>,
	headInfo: RefInfo,
) => {
	const commit = rewrittenCommitSelection({
		selection: state.selection.outline,
		replacedCommits,
		headInfo,
	});
	if (commit) state.selection.outline = commit;

	if (state.commitTarget?.type === "commit") {
		const commitId = replacedCommits[state.commitTarget.subject];
		if (commitId !== undefined) state.commitTarget = { type: "commit", subject: commitId };
	}

	for (const oldId of Object.keys(state.checkedCommitIds)) {
		const newId = replacedCommits[oldId];
		if (newId !== undefined) {
			delete state.checkedCommitIds[oldId];
			state.checkedCommitIds[newId] = true;
		}
	}

	if (state.mode._tag === "RewordCommit") {
		const commit = rewrittenCommitOperand({
			commit: state.mode.operand,
			replacedCommits,
			headInfo,
		});
		if (commit) state.mode = rewordCommitOutlineMode({ operand: commit });
	}
};

const startRenameBranch = (state: WorkspaceState, branch: BranchOperand) => {
	selectOutline(state, branchOperand(branch));
	state.mode = renameBranchOutlineMode({ operand: branch });
};

const updateRewrittenBranchReferences = (
	state: WorkspaceState,
	oldBranch: BranchOperand,
	newBranch: BranchOperand,
) => {
	const oldBranchOperand = branchOperand(oldBranch);
	const newBranchOperand = branchOperand(newBranch);

	if (
		state.selection.outline?._tag === "Branch" &&
		operandEquals(state.selection.outline, oldBranchOperand)
	)
		state.selection.outline = newBranchOperand;

	if (
		state.commitTarget?.type === "referenceBytes" &&
		bytesEqual(state.commitTarget.subject, oldBranch.branchRef)
	)
		state.commitTarget = { type: "referenceBytes", subject: newBranch.branchRef };

	if (
		state.mode._tag === "RenameBranch" &&
		operandEquals(branchOperand(state.mode.operand), oldBranchOperand)
	)
		state.mode = renameBranchOutlineMode({ operand: newBranch });
};

const startRewordCommit = (state: WorkspaceState, commit: CommitOperand) => {
	selectOutline(state, commitOperand(commit));
	state.mode = rewordCommitOutlineMode({ operand: commit });
};

export const projectSlice = createSlice({
	name: "project",
	initialState,
	reducers: {
		selectOutline: (
			state,
			action: PayloadAction<{ projectId: string; selection: Operand | null }>,
		) => {
			const { projectId, selection } = action.payload;
			const projectState = ensureProjectState(state, projectId);
			selectOutline(projectState.workspace, selection);
		},
		selectFiles: (
			state,
			action: PayloadAction<{ projectId: string; selection: string | null }>,
		) => {
			const { projectId, selection } = action.payload;
			const projectState = ensureProjectState(state, projectId);
			selectFiles(projectState.workspace, selection);
		},
		selectDiff: (
			state,
			action: PayloadAction<{ projectId: string; selection: HunkOperand | null }>,
		) => {
			const { projectId, selection } = action.payload;
			const projectState = ensureProjectState(state, projectId);
			selectDiff(projectState.workspace, selection);
		},
		startRewordCommit: (
			state,
			action: PayloadAction<{ projectId: string; commit: CommitOperand }>,
		) => {
			const { projectId, commit } = action.payload;
			const projectState = ensureProjectState(state, projectId);
			startRewordCommit(projectState.workspace, commit);
		},
		startRenameBranch: (
			state,
			action: PayloadAction<{ projectId: string; branch: BranchOperand }>,
		) => {
			const { projectId, branch } = action.payload;
			const projectState = ensureProjectState(state, projectId);
			startRenameBranch(projectState.workspace, branch);
		},
		updateRewrittenBranchReferences: (
			state,
			action: PayloadAction<{
				projectId: string;
				oldBranch: BranchOperand;
				newBranch: BranchOperand;
			}>,
		) => {
			const { projectId, oldBranch, newBranch } = action.payload;
			const projectState = ensureProjectState(state, projectId);
			updateRewrittenBranchReferences(projectState.workspace, oldBranch, newBranch);
		},
		enterTransferMode: (
			state,
			action: PayloadAction<{ projectId: string; mode: TransferMode }>,
		) => {
			const { projectId, mode } = action.payload;
			const projectState = ensureProjectState(state, projectId);
			enterTransferMode(projectState.workspace, mode);
		},
		enterKeyboardTransferMode: (
			state,
			action: PayloadAction<{ projectId: string; source: Operand; operationType?: OperationType }>,
		) => {
			const { projectId, source, operationType } = action.payload;
			const projectState = ensureProjectState(state, projectId);
			enterKeyboardTransferMode(projectState.workspace, source, operationType);
		},
		enterAbsorbMode: (
			state,
			action: PayloadAction<{
				projectId: string;
				source: Operand;
				sourceTarget: AbsorptionTarget;
			}>,
		) => {
			const { projectId, source, sourceTarget } = action.payload;
			const projectState = ensureProjectState(state, projectId);
			enterAbsorbMode(projectState.workspace, source, sourceTarget);
		},
		updatePointerTransfer: (
			state,
			action: PayloadAction<{
				projectId: string;
				target: Operand | null;
				operationType: OperationType | null;
			}>,
		) => {
			const { projectId, target, operationType } = action.payload;
			const projectState = ensureProjectState(state, projectId);
			updatePointerTransfer(projectState.workspace, target, operationType);
		},
		updateTransferOperationType: (
			state,
			action: PayloadAction<{
				projectId: string;
				operationType: OperationType;
			}>,
		) => {
			const { projectId, operationType } = action.payload;
			const projectState = ensureProjectState(state, projectId);
			updateTransferOperationType(projectState.workspace, operationType);
		},
		exitMode: (state, action: PayloadAction<{ projectId: string }>) => {
			exitMode(ensureProjectState(state, action.payload.projectId).workspace);
		},
		cancelMode: (state, action: PayloadAction<{ projectId: string }>) => {
			cancelMode(ensureProjectState(state, action.payload.projectId).workspace);
		},
		setHighlightedCommitIds: (
			state,
			action: PayloadAction<{ projectId: string; commitIds: Array<string> | null }>,
		) => {
			const { projectId, commitIds } = action.payload;
			setHighlightedCommitIds(ensureProjectState(state, projectId).workspace, commitIds);
		},
		setCommitChecked: (
			state,
			action: PayloadAction<{ projectId: string; commitId: string; checked: boolean }>,
		) => {
			const { projectId, commitId, checked } = action.payload;
			setCommitChecked(ensureProjectState(state, projectId).workspace, commitId, checked);
		},
		setCommitsChecked: (
			state,
			action: PayloadAction<{ projectId: string; commitIds: Array<string>; checked: boolean }>,
		) => {
			const { projectId, commitIds, checked } = action.payload;
			setCommitsChecked(ensureProjectState(state, projectId).workspace, commitIds, checked);
		},
		clearCheckedCommits: (state, action: PayloadAction<{ projectId: string }>) => {
			clearCheckedCommits(ensureProjectState(state, action.payload.projectId).workspace);
		},
		setCommitTarget: (
			state,
			action: PayloadAction<{ projectId: string; commitTarget: RelativeTo | null }>,
		) => {
			const { projectId, commitTarget } = action.payload;
			setCommitTarget(ensureProjectState(state, projectId).workspace, commitTarget);
		},
		updateRewrittenCommitReferences: (
			state,
			action: PayloadAction<{
				projectId: string;
				replacedCommits: Record<string, string>;
				headInfo: RefInfo;
			}>,
		) => {
			const { projectId, replacedCommits, headInfo } = action.payload;
			updateRewrittenCommitReferences(
				ensureProjectState(state, projectId).workspace,
				replacedCommits,
				headInfo,
			);
		},
		toggleFiles: (state, action: PayloadAction<{ projectId: string }>) => {
			const projectState = ensureProjectState(state, action.payload.projectId);
			projectState.filesVisible = !projectState.filesVisible;
		},
		setDetailsFullWindow: (
			state,
			action: PayloadAction<{ projectId: string; fullWindow: boolean }>,
		) => {
			const { projectId, fullWindow } = action.payload;
			ensureProjectState(state, projectId).detailsFullWindow = fullWindow;
		},
		toggleDetailsFullWindow: (state, action: PayloadAction<{ projectId: string }>) => {
			const projectState = ensureProjectState(state, action.payload.projectId);
			projectState.detailsFullWindow = !projectState.detailsFullWindow;
		},
		openDialog: (state, action: PayloadAction<{ projectId: string; dialog: Dialog }>) => {
			const { projectId, dialog } = action.payload;
			ensureProjectState(state, projectId).dialog = dialog;
		},
		closeDialog: (state, action: PayloadAction<{ projectId: string }>) => {
			ensureProjectState(state, action.payload.projectId).dialog = { _tag: "None" };
		},
	},
	selectors: {
		selectFilesVisible: (state, projectId: string) =>
			selectProjectState(state, projectId).filesVisible,
		selectDetailsFullWindow: (state, projectId: string) =>
			selectProjectState(state, projectId).detailsFullWindow,
		selectDialogState: (state, projectId: string) => selectProjectState(state, projectId).dialog,
		selectSelectionOutline: (state, projectId: string) =>
			selectProjectWorkspaceState(state, projectId).selection.outline,
		selectSelectionFiles: (state, projectId: string) =>
			selectProjectWorkspaceState(state, projectId).selection.files,
		selectSelectionDiff: (state, projectId: string) =>
			selectProjectWorkspaceState(state, projectId).selection.diff,
		selectOutlineModeState: (state, projectId: string) =>
			selectProjectWorkspaceState(state, projectId).mode,
		selectHighlightedCommitIds: (state, projectId: string) =>
			selectProjectWorkspaceState(state, projectId).highlightedCommitIds,
		selectCommitChecked: (state, projectId: string, commitId: string) =>
			selectProjectWorkspaceState(state, projectId).checkedCommitIds[commitId] === true,
		selectCheckedCommitCount: (state, projectId: string) =>
			Object.keys(selectProjectWorkspaceState(state, projectId).checkedCommitIds).length,
		selectHasCheckedCommits: (state, projectId: string) =>
			Object.keys(selectProjectWorkspaceState(state, projectId).checkedCommitIds).length > 0,
		selectCommitTarget: (state, projectId: string) =>
			selectProjectWorkspaceState(state, projectId).commitTarget,
	},
});
