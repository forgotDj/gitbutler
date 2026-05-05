import { Match } from "effect";
import {
	BranchOperand,
	branchOperand,
	CommitOperand,
	commitOperand,
	operandEquals,
	type Operand,
} from "#ui/operands.ts";
import { getOperation, getOperations, OperationType } from "#ui/operations/operation.ts";
import { filterNavigationIndex, NavigationIndex } from "#ui/workspace/navigation-index.ts";

/** @public */
export type RubOperationMode = { source: Operand };
/** @public */
export type CutOperationMode = { source: Operand };
/** @public */
export type MoveOperationMode = { source: Operand };
/** @public */
export type DragAndDropOperationMode = { source: Operand; operationType: OperationType | null };
export type OperationMode =
	| ({ _tag: "Rub" } & RubOperationMode)
	| ({ _tag: "Cut" } & CutOperationMode)
	| ({ _tag: "Move" } & MoveOperationMode)
	| ({ _tag: "DragAndDrop" } & DragAndDropOperationMode);

/** @public */
export const rubOperationMode = ({ source }: RubOperationMode): OperationMode => ({
	_tag: "Rub",
	source,
});

/** @public */
export const cutOperationMode = ({ source }: CutOperationMode): OperationMode => ({
	_tag: "Cut",
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
export type RewordCommitOutlineMode = { operand: CommitOperand };
/** @public */
export type RenameBranchOutlineMode = { operand: BranchOperand };
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
export const rewordCommitOutlineMode = ({ operand }: RewordCommitOutlineMode): OutlineMode => ({
	_tag: "RewordCommit",
	operand,
});

/** @public */
export const renameBranchOutlineMode = ({ operand }: RenameBranchOutlineMode): OutlineMode => ({
	_tag: "RenameBranch",
	operand,
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
			Cut: () => null,
			// We should have the ability to move either above or below.
			Move: ({ source }) => (source._tag === "Branch" ? "moveAbove" : "moveBelow"),
			DragAndDrop: ({ operationType }) => operationType,
		}),
		Match.exhaustive,
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
			RewordCommit: (mode) => operandEquals(selection, commitOperand(mode.operand)),
			RenameBranch: (mode) => operandEquals(selection, branchOperand(mode.operand)),
		}),
	);

const hasAnyOperation = (source: Operand, target: Operand) => {
	const operations = getOperations(source, target);
	return !!operations.rub || !!operations.moveAbove || !!operations.moveBelow;
};

const includeOperandForOutlineMode = ({
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
						DragAndDrop: ({ source }) => hasAnyOperation(source, operand),
						Cut: ({ source }) => hasAnyOperation(source, operand),
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
			RenameBranch: (mode) => operandEquals(operand, branchOperand(mode.operand)),
			RewordCommit: (mode) => operandEquals(operand, commitOperand(mode.operand)),
		}),
	);

export const filterNavigationIndexForOutlineMode = ({
	navigationIndex: navigationIndexUnfiltered,
	selection,
	outlineMode,
	operationMode,
}: {
	navigationIndex: NavigationIndex;
	selection: Operand;
	outlineMode: OutlineMode;
	operationMode: OperationMode | null;
}) =>
	outlineMode._tag !== "Default"
		? filterNavigationIndex(
				navigationIndexUnfiltered,
				(operand) =>
					// When entering operation mode, the selection must still be
					// selectable otherwise the details panel will suddenly appear to
					// change and the user may lose sight of their source operand (e.g.
					// hunk).
					operandEquals(selection, operand) ||
					// After selection moves, allow returning selection to the source operand.
					(operationMode?.source && operandEquals(operationMode.source, operand)) ||
					includeOperandForOutlineMode({ mode: outlineMode, operand }),
			)
		: navigationIndexUnfiltered;
