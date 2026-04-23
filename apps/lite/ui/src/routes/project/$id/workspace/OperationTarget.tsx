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
import { useAppDispatch } from "#ui/state/hooks.ts";
import { projectActions } from "#ui/routes/project/$id/state/projectSlice.ts";

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
	const dispatch = useAppDispatch();

	const [isDragOver, dropRef] = useDroppable((args) => {
		const dragData = parseDragData(args.source.data);
		if (!dragData) return null;

		const { source } = dragData;
		const operationType = getDropOperationType(source, item)(args);
		if (operationType == null) return null;

		dispatch(projectActions.enterDragAndDropMode({ operationType, projectId, source }));

		return {};
	});
	const isActive =
		!!operationMode &&
		Match.value(operationMode).pipe(
			Match.tagsExhaustive({
				DragAndDrop: () => !!isDragOver,
				Rub: () => isSelected,
				Move: () => isSelected,
			}),
		);
	const targetData = ((): TargetData | null => {
		if (!isActive) return null;

		const { source } = operationMode;
		const operationType = operationModeToOperationType(operationMode);

		return { source, item, operationType };
	})();
	const dropMoveOperationType =
		isDragOver &&
		targetData &&
		(targetData.operationType === "moveAbove" || targetData.operationType === "moveBelow")
			? targetData.operationType
			: null;

	const mainTargetData = dropMoveOperationType === null ? targetData : null;

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
				isDropTarget={!!isDragOver}
				targetData={mainTargetData}
				render={target}
			/>

			{dropMoveOperationType !== null && (
				<OperationTooltip
					projectId={projectId}
					isDropTarget
					targetData={targetData}
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
