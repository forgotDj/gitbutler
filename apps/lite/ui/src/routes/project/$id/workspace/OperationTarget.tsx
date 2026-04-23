import {
	attachInstruction,
	extractInstruction,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/list-item";
import { classes } from "#ui/classes.ts";
import { mergeProps, useRender } from "@base-ui/react";
import { Match, pipe } from "effect";
import { FC } from "react";
import { type GetDataParams, useDroppable } from "./DragAndDrop.tsx";
import { parseDragData } from "./OperationDragAndDrop.tsx";
import { type Item } from "./Item.ts";
import { OperationTooltip } from "./OperationTooltip.tsx";
import { type OperationMode } from "./WorkspaceMode.ts";
import styles from "./OperationTarget.module.css";
import { getOperations, OperationType, TargetData } from "#ui/Operation.ts";
import { operationModeToOperationType } from "#ui/routes/project/$id/workspace/OperationMode.tsx";

const getDropOperationType =
	(source: Item, target: Item) =>
	({ input, element }: GetDataParams[0]): OperationType | null => {
		const { rub, moveAbove, moveBelow } = getOperations(source, target);

		const instruction = extractInstruction(
			attachInstruction(
				{},
				{
					input,
					element,
					operations: {
						"reorder-before": moveAbove ? "available" : "not-available",
						"reorder-after": moveBelow ? "available" : "not-available",
						combine: rub ? "available" : "not-available",
					},
				},
			),
		);

		if (!instruction) return null;

		return Match.value(instruction.operation).pipe(
			Match.withReturnType<OperationType | null>(),
			Match.when("combine", () => "rub"),
			Match.when("reorder-before", () => "moveAbove"),
			Match.when("reorder-after", () => "moveBelow"),
			Match.exhaustive,
		);
	};

export const OperationTarget: FC<
	{
		item: Item;
		projectId: string;
		operationMode: OperationMode | null;
		isSelected: boolean;
	} & useRender.ComponentProps<"div">
> = ({ item, projectId, operationMode, isSelected, render, ...props }) => {
	const [dropTarget, dropRef] = useDroppable((args): TargetData | null => {
		const dragData = parseDragData(args.source.data);
		if (!dragData) return null;

		const { source } = dragData;
		const operationType = getDropOperationType(source, item)(args);

		return { source, item, operationType };
	});
	const dropMoveOperationType =
		dropTarget && dropTarget.operationType !== "rub" ? dropTarget.operationType : null;

	const getOperationModeTarget = (): TargetData | null => {
		if (!isSelected) return null;
		if (!operationMode) return null;

		const { source } = operationMode;
		const operationType = operationModeToOperationType(operationMode);

		return { source, item, operationType };
	};

	const mainTargetData =
		dropMoveOperationType === null ? (dropTarget ?? getOperationModeTarget()) : null;

	const target = useRender({
		render,
		ref: dropRef,
		props: mergeProps<"div">(props, {
			className: classes(mainTargetData != null && styles.activeTarget),
		}),
	});

	return (
		<div className={styles.target}>
			<OperationTooltip
				projectId={projectId}
				isDropTarget={!!dropTarget}
				item={item}
				operationType={mainTargetData?.operationType ?? null}
				source={mainTargetData?.source}
				render={target}
			/>

			{dropMoveOperationType !== null && (
				<OperationTooltip
					projectId={projectId}
					isDropTarget
					item={item}
					operationType={dropMoveOperationType}
					source={dropTarget?.source}
					className={classes(
						styles.insertionTarget,
						pipe(
							dropMoveOperationType,
							Match.value,
							Match.when("moveAbove", () => styles.insertionTargetAbove),
							Match.when("moveBelow", () => styles.insertionTargetBelow),
							Match.exhaustive,
						),
					)}
				/>
			)}
		</div>
	);
};
