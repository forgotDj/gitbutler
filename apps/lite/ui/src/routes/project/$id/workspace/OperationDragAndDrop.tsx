import { getOperation, OperationType, useRunOperation } from "#ui/Operation.ts";
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { useEffect } from "react";
import { Item } from "./Item";
import { useAppDispatch } from "#ui/state/hooks.ts";
import { projectActions } from "#ui/routes/project/$id/state/projectSlice.ts";

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

export const useMonitorDraggedItem = ({ projectId }: { projectId: string }) => {
	const runOperation = useRunOperation();
	const dispatch = useAppDispatch();

	useEffect(
		() =>
			monitorForElements({
				canMonitor: ({ source }) => parseDragData(source.data) !== null,
				onDrop: ({ source, location }) => {
					dispatch(projectActions.exitMode({ projectId }));

					const dragData = parseDragData(source.data);
					if (!dragData) return;

					const dropTarget = location.current.dropTargets
						.map((x) => parseDropData(x.data))
						.find((dropTarget) => dropTarget?.operationType != null);

					if (!dropTarget) return;

					const operation = getOperation({
						source: dragData.source,
						target: dropTarget.target,
						operationType: dropTarget.operationType,
					});
					if (!operation) return;

					runOperation(projectId, operation);
				},
			}),
		[runOperation, projectId, dispatch],
	);
};
