import {
	attachInstruction,
	extractInstruction,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/list-item";
import { classes } from "#ui/classes.ts";
import { getInsertionSide, moveOperation, rubOperation, type Operation } from "#ui/Operation.ts";
import { mergeProps, useRender } from "@base-ui/react";
import { Match, pipe } from "effect";
import { FC } from "react";
import { type GetDataParams, useDroppable } from "./DragAndDrop.tsx";
import { parseDragData } from "./OperationDragAndDrop.tsx";
import { type Item } from "./Item.ts";
import { operationModeToOperation } from "./OperationMode.tsx";
import { OperationTooltip } from "./OperationTooltip.tsx";
import { type OperationMode } from "./WorkspaceMode.ts";
import styles from "./OperationTarget.module.css";

const dropTargetOperations = (source: Item, target: Item) => ({
	rub: rubOperation({ source, target }),
	moveAbove: moveOperation({ source, target, side: "above" }),
	moveBelow: moveOperation({ source, target, side: "below" }),
});

const dropTargetToOperation =
	(source: Item, target: Item) =>
	({ input, element }: GetDataParams[0]): Operation | null => {
		const { rub, moveAbove, moveBelow } = dropTargetOperations(source, target);

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
			Match.when("combine", () => rub),
			Match.when("reorder-before", () => moveAbove),
			Match.when("reorder-after", () => moveBelow),
			Match.exhaustive,
		);
	};

export type TargetData = {
	source: Item;
	operation: Operation | null;
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
		const operation = dropTargetToOperation(source, item)(args);

		return { source, operation };
	});
	const dropInsertionSide = dropTarget?.operation ? getInsertionSide(dropTarget.operation) : null;

	const getOperationModeTarget = (): TargetData | null => {
		if (!isSelected) return null;
		if (!operationMode) return null;

		const { source } = operationMode;
		const operation = operationModeToOperation({ operationMode, target: item });

		return { source, operation };
	};

	const mainTargetData =
		dropInsertionSide === null ? (dropTarget ?? getOperationModeTarget()) : null;

	const target = useRender({
		render,
		ref: dropRef,
		props: mergeProps<"div">(props, {
			className: classes(mainTargetData && styles.activeTarget),
		}),
	});

	return (
		<div className={styles.target}>
			<OperationTooltip
				projectId={projectId}
				isDropTarget={!!dropTarget}
				item={item}
				operation={mainTargetData?.operation ?? null}
				source={mainTargetData?.source}
				render={target}
			/>

			{dropInsertionSide !== null && (
				<OperationTooltip
					projectId={projectId}
					isDropTarget
					item={item}
					operation={dropTarget?.operation ?? null}
					source={dropTarget?.source}
					className={classes(
						styles.insertionTarget,
						pipe(
							dropInsertionSide,
							Match.value,
							Match.when("above", () => styles.insertionTargetAbove),
							Match.when("below", () => styles.insertionTargetBelow),
							Match.exhaustive,
						),
					)}
				/>
			)}
		</div>
	);
};
