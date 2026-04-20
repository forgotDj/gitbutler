import {
	attachInstruction,
	extractInstruction,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/list-item";
import { classes } from "#ui/classes.ts";
import { getInsertionSide, type Operation } from "#ui/Operation.ts";
import { mergeProps, useRender } from "@base-ui/react";
import { Match, pipe } from "effect";
import { FC } from "react";
import { type GetDataParams, DropData, parseDragData, useDroppable } from "./DragAndDrop.tsx";
import { type Item } from "./Item.ts";
import { operationModeToOperation } from "./OperationMode.tsx";
import { OperationTooltip } from "./OperationTooltip.tsx";
import {
	moveOperationSourceToOperation,
	resolveOperationSource,
	rubOperationSourceToOperation,
	type ResolvedOperationSource,
} from "./ResolvedOperationSource.ts";
import { type OperationMode } from "./WorkspaceMode.ts";
import styles from "./route.module.css";
import { useQueryClient } from "@tanstack/react-query";
import {
	itemOperationSource,
	OperationSource,
} from "#ui/routes/project/$id/workspace/OperationSource.ts";

type GetOperation = (args: GetDataParams[0]) => Operation | null;

const dropTargetToOperation =
	(item: Item, resolvedOperationSource: ResolvedOperationSource): GetOperation =>
	({ input, element }) => {
		const combine = rubOperationSourceToOperation({
			resolvedOperationSource,
			target: item,
		});
		const insertAbove = moveOperationSourceToOperation({
			resolvedOperationSource,
			target: item,
			side: "above",
		});
		const insertBelow = moveOperationSourceToOperation({
			resolvedOperationSource,
			target: item,
			side: "below",
		});

		const instruction = extractInstruction(
			attachInstruction(
				{ resolvedOperationSource },
				{
					input,
					element,
					operations: {
						"reorder-before": insertAbove ? "available" : "not-available",
						"reorder-after": insertBelow ? "available" : "not-available",
						combine: combine ? "available" : "not-available",
					},
				},
			),
		);

		if (!instruction) return null;

		return Match.value(instruction.operation).pipe(
			Match.when("combine", () => combine),
			Match.when("reorder-before", () => insertAbove),
			Match.when("reorder-after", () => insertBelow),
			Match.exhaustive,
		);
	};

const useDropTarget = ({ projectId, item }: { projectId: string; item: Item }) => {
	const queryClient = useQueryClient();

	return useDroppable((args): DropData | null => {
		const dragData = parseDragData(args.source.data);
		if (!dragData) return null;

		const { source } = dragData;

		const resolvedOperationSource = resolveOperationSource({
			operationSource: source,
			queryClient,
			projectId,
		});

		const operation = resolvedOperationSource
			? dropTargetToOperation(item, resolvedOperationSource)(args)
			: null;

		return {
			source,
			operation,
		};
	});
};

type OperationModeTarget = {
	source: Item;
	operation: Operation | null;
};

const useOperationModeTarget = ({
	projectId,
	item,
	operationMode,
	isSelected,
}: {
	projectId: string;
	item: Item;
	operationMode: OperationMode | null;
	isSelected: boolean;
}): OperationModeTarget | null => {
	const queryClient = useQueryClient();

	const isActiveTarget = !!operationMode && isSelected;

	if (!isActiveTarget) return null;

	const resolvedOperationSource = resolveOperationSource({
		operationSource: itemOperationSource(operationMode.source),
		queryClient,
		projectId,
	});

	const operation = resolvedOperationSource
		? operationModeToOperation({
				operationMode,
				resolvedOperationSource,
				target: item,
			})
		: null;

	return {
		source: operationMode.source,
		operation,
	};
};

type TargetData = {
	source: OperationSource;
	operation: Operation | null;
};

const getTargetData = (
	dropData: DropData | null,
	operationModeTarget: OperationModeTarget | null,
): TargetData | null => {
	if (dropData?.operation) return { operation: dropData.operation, source: dropData.source };
	if (operationModeTarget)
		return {
			operation: operationModeTarget.operation,
			source: itemOperationSource(operationModeTarget.source),
		};
	return null;
};

export const OperationTarget: FC<
	{
		item: Item;
		projectId: string;
		operationMode: OperationMode | null;
		isSelected: boolean;
	} & useRender.ComponentProps<"div">
> = ({ item, projectId, operationMode, isSelected, render, ...props }) => {
	const [dropData, dropRef] = useDropTarget({ projectId, item });
	const operationModeTarget = useOperationModeTarget({
		projectId,
		item,
		operationMode,
		isSelected,
	});

	const targetData = getTargetData(dropData, operationModeTarget);

	const dropInsertionSide = dropData?.operation ? getInsertionSide(dropData.operation) : null;

	const combineOperation = dropInsertionSide === null ? (targetData?.operation ?? null) : null;

	const target = useRender({
		render,
		ref: dropRef,
		props: mergeProps<"div">(props, {
			className: classes(combineOperation && styles.activeTarget),
		}),
	});

	return (
		<div className={styles.target}>
			<OperationTooltip
				projectId={projectId}
				isOperationMode={!!operationMode}
				item={item}
				operation={combineOperation}
				source={combineOperation ? targetData?.source : undefined}
				render={target}
			/>

			{dropData && dropInsertionSide !== null && (
				<OperationTooltip
					projectId={projectId}
					isOperationMode={false}
					item={item}
					operation={dropData.operation}
					source={dropData.source}
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
