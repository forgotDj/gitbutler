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

const selectProjectWorkspaceState = (state: ProjectSliceState, projectId: string): WorkspaceState =>
	selectProjectState(state, projectId).workspace;

export const projectSlice = createSlice({
	name: "project",
	initialState,
	reducers: {
		selectOutline: (
			state,
			action: PayloadAction<{ projectId: string; selection: Operand | null }>,
		) => {
			const { projectId, selection } = action.payload;
			const workspaceState = ensureProjectState(state, projectId).workspace;
			if (
				selection &&
				workspaceState.selection.outline &&
				operandEquals(workspaceState.selection.outline, selection)
			)
				return;

			workspaceState.selection.outline = selection;
			workspaceState.selection.files = null;
			workspaceState.selection.diff = null;

			if (!selection || !isValidOutlineModeForSelection({ mode: workspaceState.mode, selection }))
				workspaceState.mode = defaultOutlineMode;
		},
		selectFiles: (
			state,
			action: PayloadAction<{ projectId: string; selection: string | null }>,
		) => {
			const { projectId, selection } = action.payload;
			const workspaceState = ensureProjectState(state, projectId).workspace;
			if (workspaceState.selection.files === selection) return;

			workspaceState.selection.files = selection;
		},
		selectDiff: (
			state,
			action: PayloadAction<{ projectId: string; selection: HunkOperand | null }>,
		) => {
			const { projectId, selection } = action.payload;
			const workspaceState = ensureProjectState(state, projectId).workspace;
			if (
				selection &&
				workspaceState.selection.diff &&
				operandEquals(hunkOperand(workspaceState.selection.diff), hunkOperand(selection))
			)
				return;

			workspaceState.selection.diff = selection;
		},
		startRewordCommit: (
			state,
			action: PayloadAction<{ projectId: string; commit: CommitOperand }>,
		) => {
			const { projectId, commit } = action.payload;
			const workspaceState = ensureProjectState(state, projectId).workspace;
			const selection = commitOperand(commit);
			if (
				!workspaceState.selection.outline ||
				!operandEquals(workspaceState.selection.outline, selection)
			) {
				workspaceState.selection.outline = selection;
				workspaceState.selection.files = null;
				workspaceState.selection.diff = null;
				if (!isValidOutlineModeForSelection({ mode: workspaceState.mode, selection }))
					workspaceState.mode = defaultOutlineMode;
			}

			workspaceState.mode = rewordCommitOutlineMode({ operand: commit });
		},
		startRenameBranch: (
			state,
			action: PayloadAction<{ projectId: string; branch: BranchOperand }>,
		) => {
			const { projectId, branch } = action.payload;
			const workspaceState = ensureProjectState(state, projectId).workspace;
			const selection = branchOperand(branch);
			if (
				!workspaceState.selection.outline ||
				!operandEquals(workspaceState.selection.outline, selection)
			) {
				workspaceState.selection.outline = selection;
				workspaceState.selection.files = null;
				workspaceState.selection.diff = null;
				if (!isValidOutlineModeForSelection({ mode: workspaceState.mode, selection }))
					workspaceState.mode = defaultOutlineMode;
			}

			workspaceState.mode = renameBranchOutlineMode({ operand: branch });
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
			const workspaceState = ensureProjectState(state, projectId).workspace;
			const oldBranchOperand = branchOperand(oldBranch);
			const newBranchOperand = branchOperand(newBranch);

			if (
				workspaceState.selection.outline?._tag === "Branch" &&
				operandEquals(workspaceState.selection.outline, oldBranchOperand)
			)
				workspaceState.selection.outline = newBranchOperand;

			if (
				workspaceState.commitTarget?.type === "referenceBytes" &&
				bytesEqual(workspaceState.commitTarget.subject, oldBranch.branchRef)
			) {
				workspaceState.commitTarget = {
					type: "referenceBytes",
					subject: newBranch.branchRef,
				};
			}

			if (
				workspaceState.mode._tag === "RenameBranch" &&
				operandEquals(branchOperand(workspaceState.mode.operand), oldBranchOperand)
			)
				workspaceState.mode = renameBranchOutlineMode({ operand: newBranch });
		},
		enterTransferMode: (
			state,
			action: PayloadAction<{ projectId: string; mode: TransferMode }>,
		) => {
			const { projectId, mode } = action.payload;
			ensureProjectState(state, projectId).workspace.mode = transferOutlineMode(mode);
		},
		enterKeyboardTransferMode: (
			state,
			action: PayloadAction<{ projectId: string; source: Operand; operationType?: OperationType }>,
		) => {
			const { projectId, source, operationType } = action.payload;
			const workspaceState = ensureProjectState(state, projectId).workspace;
			workspaceState.mode = transferOutlineMode(
				keyboardTransferMode({
					source,
					operationType: operationType ?? "into",
					restoreSelection: {
						outline: workspaceState.selection.outline,
						files: workspaceState.selection.files,
						diff: workspaceState.selection.diff,
					},
				}),
			);
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
			const workspaceState = ensureProjectState(state, projectId).workspace;
			workspaceState.mode = absorbOutlineMode({
				source,
				restoreSelection: {
					outline: workspaceState.selection.outline,
					files: workspaceState.selection.files,
					diff: workspaceState.selection.diff,
				},
				sourceTarget,
			});
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
			const workspaceState = ensureProjectState(state, projectId).workspace;
			Match.value(workspaceState.mode).pipe(
				Match.when({ _tag: "Transfer", value: { _tag: "Pointer" } }, ({ value: mode }) => {
					const sameTarget =
						target === null
							? mode.target === null
							: mode.target !== null && operandEquals(mode.target, target);
					if (sameTarget && mode.operationType === operationType) return;

					workspaceState.mode = transferOutlineMode(
						pointerTransferMode({
							source: mode.source,
							target,
							operationType,
						}),
					);
				}),
				Match.orElse(() => {}),
			);
		},
		updateTransferOperationType: (
			state,
			action: PayloadAction<{
				projectId: string;
				operationType: OperationType;
			}>,
		) => {
			const { projectId, operationType } = action.payload;
			const workspaceState = ensureProjectState(state, projectId).workspace;
			Match.value(workspaceState.mode).pipe(
				Match.when({ _tag: "Transfer", value: { _tag: "Keyboard" } }, ({ value: mode }) => {
					workspaceState.mode = transferOutlineMode(
						keyboardTransferMode({
							source: mode.source,
							operationType,
							restoreSelection: mode.restoreSelection,
						}),
					);
				}),
				Match.orElse(() => {}),
			);
		},
		exitMode: (state, action: PayloadAction<{ projectId: string }>) => {
			ensureProjectState(state, action.payload.projectId).workspace.mode = defaultOutlineMode;
		},
		cancelMode: (state, action: PayloadAction<{ projectId: string }>) => {
			const workspaceState = ensureProjectState(state, action.payload.projectId).workspace;
			const restoreSelection = Match.value(workspaceState.mode).pipe(
				Match.tags({
					Absorb: (mode) => mode.restoreSelection,
					Transfer: (mode) => (mode.value._tag === "Keyboard" ? mode.value.restoreSelection : null),
				}),
				Match.orElse(() => null),
			);
			workspaceState.mode = defaultOutlineMode;

			if (!restoreSelection) return;

			workspaceState.selection = restoreSelection;
		},
		setHighlightedCommitIds: (
			state,
			action: PayloadAction<{ projectId: string; commitIds: Array<string> | null }>,
		) => {
			const { projectId, commitIds } = action.payload;
			ensureProjectState(state, projectId).workspace.highlightedCommitIds = commitIds ?? [];
		},
		setCommitChecked: (
			state,
			action: PayloadAction<{ projectId: string; commitId: string; checked: boolean }>,
		) => {
			const { projectId, commitId, checked } = action.payload;
			const checkedCommitIds = ensureProjectState(state, projectId).workspace.checkedCommitIds;
			if (checked) checkedCommitIds[commitId] = true;
			else delete checkedCommitIds[commitId];
		},
		setCommitsChecked: (
			state,
			action: PayloadAction<{ projectId: string; commitIds: Array<string>; checked: boolean }>,
		) => {
			const { projectId, commitIds, checked } = action.payload;
			const checkedCommitIds = ensureProjectState(state, projectId).workspace.checkedCommitIds;
			for (const commitId of commitIds) {
				if (checked) checkedCommitIds[commitId] = true;
				else delete checkedCommitIds[commitId];
			}
		},
		clearCheckedCommits: (state, action: PayloadAction<{ projectId: string }>) => {
			ensureProjectState(state, action.payload.projectId).workspace.checkedCommitIds = {};
		},
		setCommitTarget: (
			state,
			action: PayloadAction<{ projectId: string; commitTarget: RelativeTo | null }>,
		) => {
			const { projectId, commitTarget } = action.payload;
			ensureProjectState(state, projectId).workspace.commitTarget = commitTarget;
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
			const workspaceState = ensureProjectState(state, projectId).workspace;
			const commit = rewrittenCommitSelection({
				selection: workspaceState.selection.outline,
				replacedCommits,
				headInfo,
			});
			if (commit) workspaceState.selection.outline = commit;

			if (workspaceState.commitTarget?.type === "commit") {
				const commitId = replacedCommits[workspaceState.commitTarget.subject];
				if (commitId !== undefined)
					workspaceState.commitTarget = { type: "commit", subject: commitId };
			}

			for (const oldId of Object.keys(workspaceState.checkedCommitIds)) {
				const newId = replacedCommits[oldId];
				if (newId !== undefined) {
					delete workspaceState.checkedCommitIds[oldId];
					workspaceState.checkedCommitIds[newId] = true;
				}
			}

			if (workspaceState.mode._tag === "RewordCommit") {
				const commit = rewrittenCommitOperand({
					commit: workspaceState.mode.operand,
					replacedCommits,
					headInfo,
				});
				if (commit) workspaceState.mode = rewordCommitOutlineMode({ operand: commit });
			}
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
