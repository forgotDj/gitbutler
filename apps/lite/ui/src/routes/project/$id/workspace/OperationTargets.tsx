import {
	attachInstruction,
	extractInstruction,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/list-item";
import { classes } from "#ui/classes.ts";
import { changeFileParent, commitFileParent } from "#ui/domain/FileParent.ts";
import { getInsertionSide, useRunOperation, type Operation } from "#ui/Operation.ts";
import { projectActions } from "#ui/routes/project/$id/state/projectSlice.ts";
import { useAppDispatch } from "#ui/state/hooks.ts";
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

	return useDroppable((args): DropData => {
		const operationSource = parseDragData(args.source.data);
		if (!operationSource) return null;

		const resolvedOperationSource = resolveOperationSource({
			operationSource,
			queryClient,
			projectId,
		});
		if (!resolvedOperationSource) return null;

		return {
			source: operationSource,
			operation: getOperation({ ...args, resolvedOperationSource }),
		};
	});
};

type OperationModeTarget = {
	source: Item;
	operation: Operation | null;
	controls:
		| {
				onConfirm: () => void;
				onCancel: () => void;
		  }
		| undefined;
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
	const dispatch = useAppDispatch();
	const runOperation = useRunOperation();
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

	const confirm = () => {
		dispatch(projectActions.exitMode({ projectId }));

		if (!operation) return;

		runOperation(projectId, operation);
	};

	const cancel = () => dispatch(projectActions.exitMode({ projectId }));

	return {
		source: operationMode.source,
		operation,
		controls: { onConfirm: confirm, onCancel: cancel },
	};
};

type TargetData = {
	isActiveTarget: boolean;
	source: OperationSource | undefined;
	operation: Operation | null;
};

const merge = (dropData: DropData, operationModeTarget: OperationModeTarget | null): TargetData => {
	if (dropData?.operation)
		return { isActiveTarget: true, operation: dropData.operation, source: dropData.source };
	if (operationModeTarget)
		return {
			isActiveTarget: true,
			operation: operationModeTarget.operation,
			source: itemOperationSource(operationModeTarget.source),
		};
	return { isActiveTarget: false, source: undefined, operation: null };
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
			Commit: ({ commitId }) =>
				getCombineOperation({
					resolvedOperationSource,
					target: commitFileParent({ commitId }),
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

	const targetData = merge(dropData, operationModeTarget);

	const target = useRender({
		render,
		ref: dropRef,
		props: mergeProps<"div">(props, {
			className: classes(targetData.isActiveTarget && styles.activeTarget),
		}),
	});

	return (
		<OperationTooltip
			controls={operationModeTarget?.controls}
			enabled={targetData.isActiveTarget}
			item={item}
			operation={targetData.operation}
			render={target}
			source={targetData.source}
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

	const targetData = merge(dropData, operationModeTarget);

	const dragInsertionSide = dropData?.operation ? getInsertionSide(dropData.operation) : null;

	const targetTooltipOperation = dragInsertionSide === null ? targetData.operation : null;

	const target = useRender({
		render,
		ref: dropRef,
		props: mergeProps<"div">(props, {
			className: classes(targetTooltipOperation && styles.activeTarget),
		}),
	});

	return (
		<div className={styles.commit}>
			<OperationTooltip
				controls={operationModeTarget?.controls}
				enabled={targetData.isActiveTarget}
				item={item}
				operation={targetTooltipOperation}
				render={target}
				source={targetData.source}
			/>

			{dropData && dragInsertionSide !== null && (
				<OperationTooltip
					controls={operationModeTarget?.controls}
					enabled={!!dropData.operation}
					item={item}
					operation={dropData.operation}
					source={dropData.source}
					className={classes(
						styles.commitInsertionTarget,
						pipe(
							dragInsertionSide,
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
