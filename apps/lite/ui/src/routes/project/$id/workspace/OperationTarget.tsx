import {
	attachInstruction,
	extractInstruction,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/list-item";
import { classes } from "#ui/classes.ts";
import { mergeProps, useRender } from "@base-ui/react";
import { Match, pipe } from "effect";
import { FC } from "react";
import { useDroppable } from "./DragAndDrop.tsx";
import { DropData, parseDragData, parseDropData } from "./OperationDragAndDrop.tsx";
import { type Item } from "./Item.ts";
import { OperationTooltip } from "./OperationTooltip.tsx";
import { type OperationMode } from "./WorkspaceMode.ts";
import styles from "./OperationTarget.module.css";
import { getOperations, OperationType } from "#ui/Operation.ts";
import { useAppDispatch } from "#ui/state/hooks.ts";
import { projectActions } from "#ui/routes/project/$id/state/projectSlice.ts";

const getDropOperationType = ({
	source,
	target,
	input,
	element,
}: {
	source: Item;
	target: Item;
	input: Parameters<typeof attachInstruction>[1]["input"];
	element: Parameters<typeof attachInstruction>[1]["element"];
}): OperationType | null => {
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

	const [isActiveDropTarget, dropRef] = useDroppable({
		getData: ({ input, element, source }): DropData | {} => {
			const dragData = parseDragData(source.data);
			if (!dragData) return {};

			const operationType = getDropOperationType({
				source: dragData.source,
				target: item,
				input,
				element,
			});
			if (operationType === null) return {};

			return { operationType, target: item };
		},
		onActiveTargetDrag: (args) => {
			const dropData = parseDropData(args.self.data);

			dispatch(
				projectActions.updateDragAndDropMode({
					projectId,
					operationType: dropData?.operationType ?? null,
				}),
			);
		},
	});

	const insertTargetOperationType = operationMode
		? Match.value(operationMode).pipe(
				Match.tagsExhaustive({
					DragAndDrop: ({ operationType }) =>
						isActiveDropTarget && (operationType === "moveAbove" || operationType === "moveBelow")
							? operationType
							: null,
					Rub: () => null,
					Move: () => null,
				}),
			)
		: null;

	const isMainTargetActive =
		!!operationMode &&
		Match.value(operationMode).pipe(
			Match.tagsExhaustive({
				DragAndDrop: ({ operationType }) => isActiveDropTarget && operationType === "rub",
				Rub: () => isSelected,
				Move: () => isSelected,
			}),
		);

	const target = useRender({
		render,
		ref: dropRef,
		props: mergeProps<"div">(props, {
			className: classes(isMainTargetActive && styles.activeTarget),
		}),
	});

	return (
		<div className={styles.target}>
			<OperationTooltip
				projectId={projectId}
				item={item}
				isActive={isMainTargetActive}
				operationMode={operationMode}
				render={target}
			/>

			{insertTargetOperationType !== null && (
				<OperationTooltip
					projectId={projectId}
					item={item}
					isActive
					operationMode={operationMode}
					className={classes(
						styles.insertionTarget,
						pipe(
							insertTargetOperationType,
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
