import {
	attachInstruction,
	extractInstruction,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/list-item";
import { classes } from "#ui/classes.ts";
import { changeFileParent, commitFileParent } from "#ui/domain/FileParent.ts";
import { getInsertionSide, type Operation } from "#ui/Operation.ts";
import { mergeProps, useRender } from "@base-ui/react";
import { Match, pipe } from "effect";
import { FC } from "react";
import { type GetDataParams, DropData, parseDragData, useDroppable } from "./DragAndDrop.tsx";
import { type Item } from "./Item.ts";
import { operationModeToOperation } from "./OperationMode.tsx";
import { OperationTooltip } from "./OperationTooltip.tsx";
import {
	getBranchTargetOperation,
	getCombineOperation,
	getCommitTargetMoveOperation,
	getTearOffBranchTargetOperation,
	resolveOperationSource,
	type ResolvedOperationSource,
} from "./ResolvedOperationSource.ts";
import { type OperationMode } from "./WorkspaceMode.ts";
import styles from "./route.module.css";
import { useQueryClient } from "@tanstack/react-query";
import {
	itemOperationSource,
	OperationSource,
} from "#ui/routes/project/$id/workspace/OperationSource.ts";

type GetOperation = (
	args: GetDataParams[0] & { resolvedOperationSource: ResolvedOperationSource },
) => Operation | null;

const useDropTarget = ({
	projectId,
	getOperation,
}: {
	projectId: string;
	getOperation: GetOperation;
}) => {
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
		if (!resolvedOperationSource) return null;

		return {
			source,
			operation: getOperation({ ...args, resolvedOperationSource }),
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

const dropTargetToOperation = ({
	target,
	resolvedOperationSource,
}: {
	target: Item;
	resolvedOperationSource: ResolvedOperationSource;
}) =>
	Match.value(target).pipe(
		Match.tags({
			ChangesSection: () =>
				getCombineOperation({
					resolvedOperationSource,
					target: changeFileParent,
				}),
			Branch: ({ branchRef }) =>
				getBranchTargetOperation({
					resolvedOperationSource,
					branchRef,
				}),
			BaseCommit: () => getTearOffBranchTargetOperation(resolvedOperationSource),
		}),
		Match.orElse(() => null),
	);

export const OperationTarget: FC<
	{
		projectId: string;
		item: Item;
		operationMode: OperationMode | null;
		isSelected: boolean;
	} & useRender.ComponentProps<"div">
> = ({ projectId, item, operationMode, isSelected, render, ...props }) => {
	const [dropData, dropRef] = useDropTarget({
		projectId,
		getOperation: ({ resolvedOperationSource }) =>
			dropTargetToOperation({ target: item, resolvedOperationSource }),
	});
	const operationModeTarget = useOperationModeTarget({
		projectId,
		item,
		operationMode,
		isSelected,
	});

	const targetData = getTargetData(dropData, operationModeTarget);

	const target = useRender({
		render,
		ref: dropRef,
		props: mergeProps<"div">(props, {
			className: classes(targetData && styles.activeTarget),
		}),
	});

	return (
		<OperationTooltip
			projectId={projectId}
			isOperationMode={!!operationMode}
			item={item}
			operation={targetData?.operation ?? null}
			source={targetData?.source}
			render={target}
		/>
	);
};

const commitDropTargetToOperation =
	(commitId: string): GetOperation =>
	({ input, element, resolvedOperationSource }) => {
		const combine = getCombineOperation({
			resolvedOperationSource,
			target: commitFileParent({ commitId }),
		});
		const insertAbove = getCommitTargetMoveOperation({
			resolvedOperationSource,
			commitId,
			side: "above",
		});
		const insertBelow = getCommitTargetMoveOperation({
			resolvedOperationSource,
			commitId,
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

export const CommitTarget: FC<
	{
		commitId: string;
		item: Item;
		projectId: string;
		operationMode: OperationMode | null;
		isSelected: boolean;
	} & useRender.ComponentProps<"div">
> = ({ commitId, item, projectId, operationMode, isSelected, render, ...props }) => {
	const [dropData, dropRef] = useDropTarget({
		projectId,
		getOperation: commitDropTargetToOperation(commitId),
	});
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
		<div className={styles.commit}>
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
						styles.commitInsertionTarget,
						pipe(
							dropInsertionSide,
							Match.value,
							Match.when("above", () => styles.commitInsertionTargetAbove),
							Match.when("below", () => styles.commitInsertionTargetBelow),
							Match.exhaustive,
						),
					)}
				/>
			)}
		</div>
	);
};
