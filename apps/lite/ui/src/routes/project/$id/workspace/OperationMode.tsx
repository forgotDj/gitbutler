import { OperationType } from "#ui/Operation.ts";
import { Match } from "effect";
import { type OperationMode } from "./WorkspaceMode.ts";

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
