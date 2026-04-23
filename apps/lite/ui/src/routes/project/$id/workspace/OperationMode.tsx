import { moveOperation, rubOperation, type Operation } from "#ui/Operation.ts";
import { Match } from "effect";
import { type Item } from "./Item.ts";
import { type OperationMode } from "./WorkspaceMode.ts";

export const operationModeToOperation = ({
	operationMode,
	target,
}: {
	operationMode: OperationMode;
	target: Item;
}): Operation | null =>
	Match.value(operationMode).pipe(
		Match.tagsExhaustive({
			Rub: ({ source }) => rubOperation({ source, target }),
			Move: ({ source }) => moveOperation({ source, target, side: "below" }),
		}),
	);
