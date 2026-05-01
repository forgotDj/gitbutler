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

type WorkspaceSelectionState = {
	outline: Operand;
	files: Operand;
};

const createInitialWorkspaceSelectionState = (): WorkspaceSelectionState => ({
	outline: changesSectionOperand,
	files: changesSectionOperand,
});

export type WorkspaceState = {
	highlightedCommitIds: Array<string>;
	mode: OutlineMode;
	selection: WorkspaceSelectionState;
};

export const createInitialState = (): WorkspaceState => ({
	highlightedCommitIds: [],
	mode: defaultOutlineMode,
	selection: createInitialWorkspaceSelectionState(),
});

export const initialState: WorkspaceState = createInitialState();

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

export const selectOutline = (state: WorkspaceState, selection: Operand) => {
	state.selection.outline = selection;
	state.selection.files = selection;

	if (!isValidOutlineModeForSelection({ mode: state.mode, selection }))
		state.mode = defaultOutlineMode;
};

export const selectFiles = (state: WorkspaceState, selection: Operand) => {
	state.selection.files = selection;
};

export const setHighlightedCommitIds = (state: WorkspaceState, commitIds: Array<string> | null) => {
	state.highlightedCommitIds = commitIds ?? [];
};

export const startRenameBranch = (state: WorkspaceState, branch: BranchOperand) => {
	selectOutline(state, branchOperand(branch));
	state.mode = renameBranchOutlineMode({
		stackId: branch.stackId,
		branchRef: branch.branchRef,
	});
};

export const startRewordCommit = (state: WorkspaceState, commit: CommitOperand) => {
	selectOutline(state, commitOperand(commit));
	state.mode = rewordCommitOutlineMode({
		stackId: commit.stackId,
		commitId: commit.commitId,
	});
};

export const selectSelectionOutlineState = (state: WorkspaceState): Operand =>
	state.selection.outline;

export const selectSelectionFilesState = (state: WorkspaceState): Operand => state.selection.files;

export const selectMode = (state: WorkspaceState): OutlineMode => state.mode;

export const selectOperationMode = (state: WorkspaceState) => getOperationMode(state.mode);

export const selectHighlightedCommitIds = (state: WorkspaceState): Array<string> =>
	state.highlightedCommitIds;
