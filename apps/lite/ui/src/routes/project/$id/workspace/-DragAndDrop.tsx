import { type Operation, useRunOperation } from "#ui/Operation.ts";
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import {
	attachInstruction,
	extractInstruction,
	Instruction,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/list-item";
import { FC, type ReactNode, useEffect } from "react";
import sharedStyles from "../-shared.module.css";
import {
	getCombineOperation,
	getCommitTargetSideOperation,
	type OperationSource,
} from "./-OperationSource.ts";
import { type OperationSourceRef } from "./-OperationSourceRef.ts";

type DragData = {
	operationSourceRef: OperationSourceRef;
};

export const parseDragData = (data: unknown): OperationSourceRef | null => {
	if (typeof data !== "object" || data === null || !("operationSourceRef" in data)) return null;
	return (data as DragData).operationSourceRef;
};

const parseDropTargetData = (data: unknown): Operation | null => {
	if (typeof data !== "object" || data === null || !("_tag" in data)) return null;
	return data as Operation;
};

export const DragPreview: FC<{ children: ReactNode }> = ({ children }) => (
	<div className={sharedStyles.dragPreview}>{children}</div>
);

export const getDragData = (operationSourceRef: OperationSourceRef): DragData => ({
	operationSourceRef,
});

export const getCommitTargetInstruction = ({
	operationSource,
	commitId,
	previousCommitId,
	nextCommitId,
	input,
	element,
}: {
	operationSource: OperationSource;
	commitId: string;
	previousCommitId: string | undefined;
	nextCommitId: string | undefined;
	input: Parameters<typeof attachInstruction>[1]["input"];
	element: Element;
}): Instruction | null => {
	const getSourceCommitId = (item: OperationSource): string | null =>
		item._tag === "Commit"
			? item.commitId
			: item._tag === "TreeChanges" && item.parent._tag === "Commit"
				? item.parent.commitId
				: null;

	const combineOperation = getCombineOperation({
		operationSource,
		target: { _tag: "Commit", commitId },
	});

	return extractInstruction(
		attachInstruction(
			{ operationSource },
			{
				input,
				element,
				operations: {
					"reorder-before": getCommitTargetSideOperation({
						operationSource,
						commitId,
						side: "above",
						previousCommitId,
						nextCommitId,
					})
						? "available"
						: "not-available",
					"reorder-after": getCommitTargetSideOperation({
						operationSource,
						commitId,
						side: "below",
						previousCommitId,
						nextCommitId,
					})
						? "available"
						: "not-available",
					combine:
						combineOperation ||
						// Allow cancelling by dropping back where we started, otherwise
						// this would be interpreted as a reorder.
						getSourceCommitId(operationSource) === commitId
							? "available"
							: "not-available",
				},
			},
		),
	);
};

export const useMonitorDraggedOperationSourceRef = ({ projectId }: { projectId: string }) => {
	const runOperation = useRunOperation();

	useEffect(
		() =>
			monitorForElements({
				canMonitor: ({ source }) => parseDragData(source.data) !== null,
				onDrop: ({ location }) => {
					const operation = location.current.dropTargets
						.map((dropTarget) => parseDropTargetData(dropTarget.data))
						.find((target) => target);

					if (!operation) return;

					runOperation(projectId, operation);
				},
			}),
		[runOperation, projectId],
	);
};
