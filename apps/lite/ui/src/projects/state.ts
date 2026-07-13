import {
	type BranchOperand,
	type CommitOperand,
	type HunkOperand,
	type Operand,
} from "#ui/operands.ts";
import { type OperationType } from "#ui/operations/operation.ts";
import { type TransferMode } from "#ui/outline/mode.ts";
import * as workspace from "#ui/projects/workspace/state.ts";
import { type AbsorptionTarget, type RefInfo, type RelativeTo } from "@gitbutler/but-sdk";
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

type Dialog =
	| { _tag: "None" }
	| { _tag: "ApplyBranchPicker" }
	| { _tag: "BranchPicker" }
	| { _tag: "CommandPalette" }
	| { _tag: "ProjectPicker" }
	| { _tag: "Settings" };

type ProjectState = {
	detailsFullWindow: boolean;
	dialog: Dialog;
	filesVisible: boolean;
	workspace: workspace.WorkspaceState;
};

type ProjectSliceState = {
	byProjectId: Record<string, ProjectState>;
};

const createInitialProjectState = (): ProjectState => ({
	detailsFullWindow: false,
	dialog: { _tag: "None" },
	filesVisible: false,
	workspace: workspace.createInitialState(),
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

const projectSlice = createSlice({
	name: "project",
	initialState,
	reducers: {
		selectOutline: (
			state,
			action: PayloadAction<{ projectId: string; selection: Operand | null }>,
		) => {
			const { projectId, selection } = action.payload;
			const projectState = ensureProjectState(state, projectId);
			workspace.selectOutline(projectState.workspace, selection);
		},
		selectFiles: (
			state,
			action: PayloadAction<{ projectId: string; selection: string | null }>,
		) => {
			const { projectId, selection } = action.payload;
			const projectState = ensureProjectState(state, projectId);
			workspace.selectFiles(projectState.workspace, selection);
		},
		selectDiff: (
			state,
			action: PayloadAction<{ projectId: string; selection: HunkOperand | null }>,
		) => {
			const { projectId, selection } = action.payload;
			const projectState = ensureProjectState(state, projectId);
			workspace.selectDiff(projectState.workspace, selection);
		},
		startRewordCommit: (
			state,
			action: PayloadAction<{ projectId: string; commit: CommitOperand }>,
		) => {
			const { projectId, commit } = action.payload;
			const projectState = ensureProjectState(state, projectId);
			workspace.startRewordCommit(projectState.workspace, commit);
		},
		startRenameBranch: (
			state,
			action: PayloadAction<{ projectId: string; branch: BranchOperand }>,
		) => {
			const { projectId, branch } = action.payload;
			const projectState = ensureProjectState(state, projectId);
			workspace.startRenameBranch(projectState.workspace, branch);
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
			workspace.updateRewrittenBranchReferences(projectState.workspace, oldBranch, newBranch);
		},
		enterTransferMode: (
			state,
			action: PayloadAction<{ projectId: string; mode: TransferMode }>,
		) => {
			const { projectId, mode } = action.payload;
			const projectState = ensureProjectState(state, projectId);
			workspace.enterTransferMode(projectState.workspace, mode);
		},
		enterKeyboardTransferMode: (
			state,
			action: PayloadAction<{ projectId: string; source: Operand; operationType?: OperationType }>,
		) => {
			const { projectId, source, operationType } = action.payload;
			const projectState = ensureProjectState(state, projectId);
			workspace.enterKeyboardTransferMode(projectState.workspace, source, operationType);
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
			workspace.enterAbsorbMode(projectState.workspace, source, sourceTarget);
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
			workspace.updatePointerTransfer(projectState.workspace, target, operationType);
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
			workspace.updateTransferOperationType(projectState.workspace, operationType);
		},
		exitMode: (state, action: PayloadAction<{ projectId: string }>) => {
			workspace.exitMode(ensureProjectState(state, action.payload.projectId).workspace);
		},
		cancelMode: (state, action: PayloadAction<{ projectId: string }>) => {
			workspace.cancelMode(ensureProjectState(state, action.payload.projectId).workspace);
		},
		setHighlightedCommitIds: (
			state,
			action: PayloadAction<{ projectId: string; commitIds: Array<string> | null }>,
		) => {
			const { projectId, commitIds } = action.payload;
			workspace.setHighlightedCommitIds(ensureProjectState(state, projectId).workspace, commitIds);
		},
		setCommitChecked: (
			state,
			action: PayloadAction<{ projectId: string; commitId: string; checked: boolean }>,
		) => {
			const { projectId, commitId, checked } = action.payload;
			workspace.setCommitChecked(ensureProjectState(state, projectId).workspace, commitId, checked);
		},
		setCommitsChecked: (
			state,
			action: PayloadAction<{ projectId: string; commitIds: Array<string>; checked: boolean }>,
		) => {
			const { projectId, commitIds, checked } = action.payload;
			workspace.setCommitsChecked(
				ensureProjectState(state, projectId).workspace,
				commitIds,
				checked,
			);
		},
		clearCheckedCommits: (state, action: PayloadAction<{ projectId: string }>) => {
			workspace.clearCheckedCommits(ensureProjectState(state, action.payload.projectId).workspace);
		},
		setCommitTarget: (
			state,
			action: PayloadAction<{ projectId: string; commitTarget: RelativeTo | null }>,
		) => {
			const { projectId, commitTarget } = action.payload;
			workspace.setCommitTarget(ensureProjectState(state, projectId).workspace, commitTarget);
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
			workspace.updateRewrittenCommitReferences(
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
		selectProjectFilesVisible: (state, projectId: string) =>
			selectProjectState(state, projectId).filesVisible,
		selectProjectDetailsFullWindow: (state, projectId: string) =>
			selectProjectState(state, projectId).detailsFullWindow,
		selectProjectDialogState: (state, projectId: string) =>
			selectProjectState(state, projectId).dialog,
		selectProjectSelectionOutline: (state, projectId: string) =>
			workspace.selectSelectionOutlineState(selectProjectWorkspaceState(state, projectId)),
		selectProjectSelectionFiles: (state, projectId: string) =>
			workspace.selectSelectionFilesState(selectProjectWorkspaceState(state, projectId)),
		selectProjectSelectionDiff: (state, projectId: string) =>
			workspace.selectSelectionDiffState(selectProjectWorkspaceState(state, projectId)),
		selectProjectOutlineModeState: (state, projectId: string) =>
			workspace.selectMode(selectProjectWorkspaceState(state, projectId)),
		selectProjectHighlightedCommitIds: (state, projectId: string) =>
			workspace.selectHighlightedCommitIds(selectProjectWorkspaceState(state, projectId)),
		selectProjectCommitChecked: (state, projectId: string, commitId: string) =>
			workspace.selectCommitChecked(selectProjectWorkspaceState(state, projectId), commitId),
		selectProjectCheckedCommitCount: (state, projectId: string) =>
			workspace.selectCheckedCommitCount(selectProjectWorkspaceState(state, projectId)),
		selectProjectHasCheckedCommits: (state, projectId: string) =>
			workspace.selectHasCheckedCommits(selectProjectWorkspaceState(state, projectId)),
		selectProjectCommitTarget: (state, projectId: string) =>
			workspace.selectCommitTarget(selectProjectWorkspaceState(state, projectId)),
	},
});

export const projectActions = projectSlice.actions;
export const projectReducer = projectSlice.reducer;
export const {
	selectProjectFilesVisible,
	selectProjectDetailsFullWindow,
	selectProjectDialogState,
	selectProjectSelectionOutline,
	selectProjectSelectionFiles,
	selectProjectSelectionDiff,
	selectProjectOutlineModeState,
	selectProjectHighlightedCommitIds,
	selectProjectCommitChecked,
	selectProjectCheckedCommitCount,
	selectProjectHasCheckedCommits,
	selectProjectCommitTarget,
} = projectSlice.selectors;
