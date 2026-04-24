import { OperationType } from "#ui/Operation.ts";
import { Item } from "./Item";

export type DragData = {
	source: Item;
};

export const parseDragData = (data: unknown): DragData | null => {
	if (typeof data !== "object" || data === null || !("source" in data)) return null;
	return data as DragData;
};

export type DropData = {
	operationType: OperationType;
	target: Item;
};

export const parseDropData = (data: unknown): DropData | null => {
	if (typeof data !== "object" || data === null || !("operationType" in data)) return null;
	return data as DropData;
};
