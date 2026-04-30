import { Match } from "effect";
import { branchOperand, commitOperand, operandEquals, type Operand } from "#ui/operands.ts";
import { navigationIndexIncludes, type NavigationIndex } from "#ui/workspace/navigation-index.ts";
import { getOperation, getOperations, OperationType } from "#ui/operations/operation.ts";

/** @public */
export type RubOperationMode = { source: Operand };
/** @public */
export type MoveOperationMode = { source: Operand };
/** @public */
export type DragAndDropOperationMode = { source: Operand; operationType: OperationType | null };
export type OperationMode =
	| ({ _tag: "Rub" } & RubOperationMode)
	| ({ _tag: "Move" } & MoveOperationMode)
	| ({ _tag: "DragAndDrop" } & DragAndDropOperationMode);

/** @public */
export const rubOperationMode = ({ source }: RubOperationMode): OperationMode => ({
	_tag: "Rub",
	source,
});

/** @public */
export const moveOperationMode = ({ source }: MoveOperationMode): OperationMode => ({
	_tag: "Move",
	source,
});

/** @public */
export const dragAndDropOperationMode = ({
	source,
	operationType,
}: DragAndDropOperationMode): OperationMode => ({
	_tag: "DragAndDrop",
	source,
	operationType,
});

/** @public */
export type RewordCommitOutlineMode = { stackId: string; commitId: string };
/** @public */
export type RenameBranchOutlineMode = { stackId: string; branchRef: Array<number> };
export type OutlineMode =
	| { _tag: "Default" }
	| ({ _tag: "RewordCommit" } & RewordCommitOutlineMode)
	| ({ _tag: "RenameBranch" } & RenameBranchOutlineMode)
	| { _tag: "Operation"; value: OperationMode };

/** @public */
export const defaultOutlineMode: OutlineMode = {
	_tag: "Default",
};

/** @public */
export const operationOutlineMode = (value: OperationMode): OutlineMode => ({
	_tag: "Operation",
	value,
});

/** @public */
export const rewordCommitOutlineMode = ({
	stackId,
	commitId,
}: RewordCommitOutlineMode): OutlineMode => ({
	_tag: "RewordCommit",
	stackId,
	commitId,
});

/** @public */
export const renameBranchOutlineMode = ({
	stackId,
	branchRef,
}: RenameBranchOutlineMode): OutlineMode => ({
	_tag: "RenameBranch",
	stackId,
	branchRef,
});

export const getOperationMode = (mode: OutlineMode): OperationMode | null =>
	Match.value(mode).pipe(
		Match.withReturnType<OperationMode | null>(),
		Match.tags({ Operation: ({ value }) => value }),
		Match.orElse(() => null),
	);

export const operationModeToOperationType = (operationMode: OperationMode): OperationType | null =>
	Match.value(operationMode).pipe(
		Match.withReturnType<OperationType | null>(),
		Match.tags({
			Rub: () => "rub",
			// We should have the ability to move either above or below.
			Move: ({ source }) => (source._tag === "Branch" ? "moveAbove" : "moveBelow"),
			DragAndDrop: ({ operationType }) => operationType,
		}),
		Match.exhaustive,
	);

export const isValidOutlineMode = ({
	mode,
	navigationIndex,
}: {
	mode: OutlineMode;
	navigationIndex: NavigationIndex;
}): boolean =>
	Match.value(mode).pipe(
		Match.tagsExhaustive({
			Default: () => true,
			Operation: ({ value }) =>
				Match.value(value).pipe(
					Match.tagsExhaustive({
						Rub: (mode) => navigationIndexIncludes(navigationIndex, mode.source),
						Move: (mode) => navigationIndexIncludes(navigationIndex, mode.source),
						// Once we have keyboard selectable hunks, this should check the
						// navigation index(es).
						DragAndDrop: () => true,
					}),
				),
			RewordCommit: (mode) =>
				navigationIndexIncludes(
					navigationIndex,
					commitOperand({
						stackId: mode.stackId,
						commitId: mode.commitId,
					}),
				),
			RenameBranch: (mode) =>
				navigationIndexIncludes(
					navigationIndex,
					branchOperand({
						stackId: mode.stackId,
						branchRef: mode.branchRef,
					}),
				),
		}),
	);

export const isValidOutlineModeForSelection = ({
	mode,
	selection,
}: {
	mode: OutlineMode;
	selection: Operand;
}): boolean =>
	Match.value(mode).pipe(
		Match.tagsExhaustive({
			Default: () => true,
			Operation: () => true,
			RewordCommit: (mode) =>
				operandEquals(
					selection,
					commitOperand({
						stackId: mode.stackId,
						commitId: mode.commitId,
					}),
				),
			RenameBranch: (mode) =>
				operandEquals(
					selection,
					branchOperand({
						stackId: mode.stackId,
						branchRef: mode.branchRef,
					}),
				),
		}),
	);

export const includeOperandForOutlineMode = ({
	mode,
	operand,
}: {
	mode: OutlineMode;
	operand: Operand;
}): boolean =>
	Match.value(mode).pipe(
		Match.tagsExhaustive({
			Default: () => true,
			Operation: ({ value }) =>
				Match.value(value).pipe(
					Match.tagsExhaustive({
						DragAndDrop: ({ source }) => {
							const operations = getOperations(source, operand);
							return !!operations.rub || !!operations.moveAbove || !!operations.moveBelow;
						},
						Move: (mode) =>
							!!getOperation({
								source: mode.source,
								target: operand,
								operationType: operationModeToOperationType(mode),
							}),
						Rub: (mode) =>
							!!getOperation({
								source: mode.source,
								target: operand,
								operationType: operationModeToOperationType(mode),
							}),
					}),
				),
			RenameBranch: (mode) =>
				operandEquals(
					operand,
					branchOperand({
						stackId: mode.stackId,
						branchRef: mode.branchRef,
					}),
				),
			RewordCommit: (mode) =>
				operandEquals(
					operand,
					commitOperand({
						stackId: mode.stackId,
						commitId: mode.commitId,
					}),
				),
		}),
	);
