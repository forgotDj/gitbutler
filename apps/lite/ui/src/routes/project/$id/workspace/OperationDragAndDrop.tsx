import { type Operation, useRunOperation } from "#ui/Operation.ts";
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { useEffect } from "react";
import { type OperationSource } from "./OperationSource.ts";

export type DragData = {
	source: OperationSource;
};

export const parseDragData = (data: unknown): DragData | null => {
	if (typeof data !== "object" || data === null || !("source" in data)) return null;
	return data as DragData;
};

export type DropData = {
	operation: Operation | null;
	source: OperationSource;
};

const parseDropData = (data: unknown): DropData | null => {
	if (typeof data !== "object" || data === null || !("operation" in data)) return null;
	return data as DropData;
};

export const useMonitorDraggedOperationSource = ({ projectId }: { projectId: string }) => {
	const runOperation = useRunOperation();

	useEffect(
		() =>
			monitorForElements({
				canMonitor: ({ source }) => parseDragData(source.data) !== null,
				onDrop: ({ location }) => {
					const dropData = location.current.dropTargets
						.map((dropTarget) => parseDropData(dropTarget.data))
						.find((dropData) => dropData?.operation);

					if (!dropData?.operation) return;

					runOperation(projectId, dropData.operation);
				},
			}),
		[runOperation, projectId],
	);
};
