import { getOperation, TargetData, useRunOperation } from "#ui/Operation.ts";
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { useEffect } from "react";
import { Item } from "./Item";

export type DragData = {
	source: Item;
};

export const parseDragData = (data: unknown): DragData | null => {
	if (typeof data !== "object" || data === null || !("source" in data)) return null;
	return data as DragData;
};

const parseDropData = (data: unknown): TargetData | null => {
	if (typeof data !== "object" || data === null || !("operationType" in data)) return null;
	return data as TargetData;
};

export const useMonitorDraggedItem = ({ projectId }: { projectId: string }) => {
	const runOperation = useRunOperation();

	useEffect(
		() =>
			monitorForElements({
				canMonitor: ({ source }) => parseDragData(source.data) !== null,
				onDrop: ({ location }) => {
					const dropTarget = location.current.dropTargets
						.map((x) => parseDropData(x.data))
						.find((dropTarget) => dropTarget?.operationType != null);

					if (dropTarget?.operationType == null) return;

					const operation = getOperation(dropTarget);
					if (!operation) return;

					runOperation(projectId, operation);
				},
			}),
		[runOperation, projectId],
	);
};
