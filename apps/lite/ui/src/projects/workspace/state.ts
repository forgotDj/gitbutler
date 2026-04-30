import { OperationType } from "#ui/operations/operation.ts";
import { Match } from "effect";
import {
	branchOperand,
	changesSectionOperand,
	commitOperand,
	type BranchOperand,
	type CommitOperand,
	type Operand,
} from "#ui/operands.ts";
import {
	defaultOutlineMode,
	dragAndDropOperationMode,
	getOperationMode,
	isValidOutlineModeForSelection,
	moveOperationMode,
	operationOutlineMode,
	renameBranchOutlineMode,
	rewordCommitOutlineMode,
	rubOperationMode,
	type OutlineMode,
} from "#ui/outline/mode.ts";

const createInitialWorkspaceSelectionState = (): Operand => changesSectionOperand;

export type WorkspaceState = {
	expandedCommitId: string | null;
	highlightedCommitIds: Array<string>;
	mode: OutlineMode;
	selection: Operand;
};

export const createInitialState = (): WorkspaceState => ({
	expandedCommitId: null,
	highlightedCommitIds: [],
	mode: defaultOutlineMode,
	selection: createInitialWorkspaceSelectionState(),
});

export const initialState: WorkspaceState = createInitialState();

export const closeCommitFiles = (state: WorkspaceState) => {
	state.expandedCommitId = null;
};

export const enterMoveMode = (state: WorkspaceState, source: Operand) => {
	state.mode = operationOutlineMode(moveOperationMode({ source }));
};

export const enterRubMode = (state: WorkspaceState, source: Operand) => {
	state.mode = operationOutlineMode(rubOperationMode({ source }));
};

export const enterDragAndDropMode = (state: WorkspaceState, source: Operand) => {
	state.mode = operationOutlineMode(dragAndDropOperationMode({ source, operationType: null }));
};

export const updateDragAndDropMode = (
	state: WorkspaceState,
	operationType: OperationType | null,
) => {
	Match.value(state.mode).pipe(
		Match.tags({
			Operation: ({ value }) => {
				Match.value(value).pipe(
					Match.tags({
						DragAndDrop: (mode) => {
							state.mode = operationOutlineMode(
								dragAndDropOperationMode({ source: mode.source, operationType }),
							);
						},
					}),
					Match.orElse(() => {}),
				);
			},
		}),
		Match.orElse(() => {}),
	);
};

export const exitMode = (state: WorkspaceState) => {
	state.mode = defaultOutlineMode;
};

export const openCommitFiles = (state: WorkspaceState, commit: CommitOperand) => {
	state.expandedCommitId = commit.commitId;
};

export const select = (state: WorkspaceState, selection: Operand) => {
	state.selection = selection;
	if (!isValidOutlineModeForSelection({ mode: state.mode, selection }))
		state.mode = defaultOutlineMode;
};

export const setExpandedCommitId = (state: WorkspaceState, commitId: string | null) => {
	state.expandedCommitId = commitId;
};

export const setHighlightedCommitIds = (state: WorkspaceState, commitIds: Array<string> | null) => {
	state.highlightedCommitIds = commitIds ?? [];
};

export const startRenameBranch = (state: WorkspaceState, branch: BranchOperand) => {
	select(state, branchOperand(branch));
	state.mode = renameBranchOutlineMode({
		stackId: branch.stackId,
		branchRef: branch.branchRef,
	});
};

export const startRewordCommit = (state: WorkspaceState, commit: CommitOperand) => {
	select(state, commitOperand(commit));
	state.mode = rewordCommitOutlineMode({
		stackId: commit.stackId,
		commitId: commit.commitId,
	});
};

export const toggleCommitFiles = (state: WorkspaceState, commit: CommitOperand) => {
	if (state.expandedCommitId === commit.commitId) {
		closeCommitFiles(state);
		return;
	}

	openCommitFiles(state, commit);
};

export const selectSelectionState = (state: WorkspaceState): Operand => state.selection;

export const selectMode = (state: WorkspaceState): OutlineMode => state.mode;

export const selectOperationMode = (state: WorkspaceState) => getOperationMode(state.mode);

export const selectExpandedCommitId = (state: WorkspaceState): string | null =>
	state.expandedCommitId;

export const selectHighlightedCommitIds = (state: WorkspaceState): Array<string> =>
	state.highlightedCommitIds;
