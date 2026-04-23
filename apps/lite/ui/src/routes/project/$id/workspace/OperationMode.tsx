import { OperationType } from "#ui/Operation.ts";
import { Match } from "effect";
import { type OperationMode } from "./WorkspaceMode.ts";

export const operationModeToOperationType = (operationMode: OperationMode): OperationType =>
	Match.value(operationMode).pipe(
		Match.withReturnType<OperationType>(),
		Match.tags({
			Rub: () => "rub",
			Move: () => "moveBelow",
		}),
		Match.exhaustive,
	);
