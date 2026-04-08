import {
	attachInstruction,
	extractInstruction,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/list-item";
import { classes } from "#ui/classes.ts";
import { type FileParent } from "#ui/domain/FileParent.ts";
import { useDraggable } from "#ui/hooks/useDraggable.tsx";
import { useDroppable } from "#ui/hooks/useDroppable.ts";
import { getInsertionSide, operationLabel, type Operation } from "#ui/Operation.ts";
import {
	CommitLabel,
	decodeRefName,
	formatHunkHeader,
	Patch,
} from "#ui/routes/project/$id/-shared.tsx";
import uiStyles from "#ui/ui.module.css";
import { mergeProps, Tooltip, useRender } from "@base-ui/react";
import { Commit, DiffHunk, TreeChange } from "@gitbutler/but-sdk";
import { Match, pipe } from "effect";
import { FC } from "react";
import {
	DragPreview,
	getCommitTargetOperations,
	makeDragData,
	parseDragData,
} from "./-DragAndDrop.tsx";
import styles from "./route.module.css";
import {
	getBranchTargetOperation,
	getCombineOperation,
	getCommitTargetSideOperation,
	useResolveOperationSource,
} from "./-OperationSource.ts";

export const BranchSource: FC<
	{
		branchRef: Array<number>;
		branchName: string;
	} & useRender.ComponentProps<"div">
> = ({ branchRef, branchName, render, ...props }) => {
	const dragData = makeDragData({ _tag: "Segment", branchRef });
	const [isDragging, dragRef] = useDraggable({
		getInitialData: () => dragData,
		preview: <DragPreview>{branchName}</DragPreview>,
	});
	const isActive = isDragging;

	return useRender({
		render,
		ref: dragRef,
		props: mergeProps<"div">(props, {
			className: classes(isActive && styles.activeSource),
		}),
	});
};

export const CommitSource: FC<
	{
		commit: Commit;
		isEnabled?: boolean;
	} & useRender.ComponentProps<"div">
> = ({ commit, isEnabled = true, render, ...props }) => {
	const [isDragging, dragRef] = useDraggable({
		getInitialData: () => makeDragData({ _tag: "Commit", commitId: commit.id }),
		preview: (
			<DragPreview>
				<CommitLabel commit={commit} />
			</DragPreview>
		),
		canDrag: () => isEnabled,
	});
	const isActive = isDragging;

	return useRender({
		render,
		ref: dragRef,
		props: mergeProps<"div">(props, {
			className: classes(isActive && styles.activeSource),
		}),
	});
};

export const CommitFileSource: FC<
	{
		change: TreeChange;
		fileParent: FileParent;
	} & useRender.ComponentProps<"div">
> = ({ change, fileParent, render, ...props }) => {
	const [isDragging, dragRef] = useDraggable({
		getInitialData: () => makeDragData({ _tag: "File", parent: fileParent, path: change.path }),
		preview: <DragPreview>{change.path}</DragPreview>,
	});
	const isActive = isDragging;

	return useRender({
		render,
		ref: dragRef,
		props: mergeProps<"div">(props, {
			className: classes(isActive && styles.activeSource),
		}),
	});
};

export const ChangesFileSource: FC<
	{
		change: TreeChange;
		fileParent: FileParent;
	} & useRender.ComponentProps<"div">
> = ({ change, fileParent, render, ...props }) => {
	const [isDragging, dragRef] = useDraggable({
		getInitialData: () => makeDragData({ _tag: "File", parent: fileParent, path: change.path }),
		preview: <DragPreview>{change.path}</DragPreview>,
	});
	const isActive = isDragging;

	return useRender({
		render,
		ref: dragRef,
		props: mergeProps<"div">(props, {
			className: classes(isActive && styles.activeSource),
		}),
	});
};

export const ChangesSectionSource: FC<
	{
		stackId: string | null;
		label: string;
	} & useRender.ComponentProps<"div">
> = ({ stackId, label, render, ...props }) => {
	const [isDragging, dragRef] = useDraggable({
		getInitialData: () => makeDragData({ _tag: "ChangesSection", stackId }),
		preview: <DragPreview>{label}</DragPreview>,
	});
	const isActive = isDragging;

	return useRender({
		render,
		ref: dragRef,
		props: mergeProps<"div">(props, {
			className: classes(isActive && styles.activeSource),
		}),
	});
};

export const HunkSource: FC<
	{
		patch: Patch;
		fileParent: FileParent;
		change: TreeChange;
		hunk: DiffHunk;
	} & useRender.ComponentProps<"div">
> = ({ patch, fileParent, change, hunk, render, ...props }) => {
	const [isDragging, dragRef] = useDraggable({
		getInitialData: () =>
			makeDragData({
				_tag: "Hunk",
				parent: fileParent,
				path: change.path,
				hunkHeader: hunk,
			}),
		preview: <DragPreview>Hunk {formatHunkHeader(hunk)}</DragPreview>,
		canDrag: () => !patch.subject.isResultOfBinaryToTextConversion,
	});
	const isActive = isDragging;

	return useRender({
		render,
		ref: dragRef,
		props: mergeProps<"div">(props, {
			className: classes(isActive && styles.activeSource),
		}),
	});
};

const OperationTooltip: FC<
	{
		operation: Operation | null;
	} & useRender.ComponentProps<"div">
> = ({ operation, render, ...props }) => {
	const tooltip = operation ? operationLabel(operation) : null;

	const trigger = useRender({
		render,
		props,
	});

	return (
		<Tooltip.Root
			open={tooltip !== null}
			disableHoverablePopup
			onOpenChange={(_open, eventDetails) => {
				eventDetails.allowPropagation();
			}}
		>
			<Tooltip.Trigger render={trigger} />
			<Tooltip.Portal>
				<Tooltip.Positioner sideOffset={8}>
					<Tooltip.Popup className={classes(uiStyles.popup, uiStyles.tooltip)}>
						{tooltip}
					</Tooltip.Popup>
				</Tooltip.Positioner>
			</Tooltip.Portal>
		</Tooltip.Root>
	);
};

export const ChangesSectionTarget: FC<
	{
		projectId: string;
		stackId: string | null;
	} & useRender.ComponentProps<"div">
> = ({ projectId, stackId, render, ...props }) => {
	const resolveOperationSource = useResolveOperationSource(projectId);
	const [operation, dropRef] = useDroppable(({ source }) => {
		const operationSourceRef = parseDragData(source.data);
		if (!operationSourceRef) return null;

		const operationSource = resolveOperationSource(operationSourceRef);
		if (!operationSource) return null;

		return getCombineOperation({
			operationSource,
			target: { _tag: "ChangesSection", stackId },
		});
	});

	const target = useRender({
		render,
		ref: dropRef,
		props: mergeProps<"div">(props, {
			className: classes(operation && styles.activeTarget),
		}),
	});

	return <OperationTooltip operation={operation} render={target} />;
};

export const CommitTarget: FC<
	{
		commitId: string;
		previousCommitId: string | undefined;
		nextCommitId: string | undefined;
		projectId: string;
	} & useRender.ComponentProps<"div">
> = ({ commitId, previousCommitId, nextCommitId, projectId, render, ...props }) => {
	const resolveOperationSource = useResolveOperationSource(projectId);
	const [operation, dropRef] = useDroppable(({ source, input, element }) => {
		const operationSourceRef = parseDragData(source.data);
		if (!operationSourceRef) return null;

		const operationSource = resolveOperationSource(operationSourceRef);
		if (!operationSource) return null;

		const operations = getCommitTargetOperations({
			operationSource,
			commitId,
			previousCommitId,
			nextCommitId,
		});

		const instruction = extractInstruction(
			attachInstruction({ operationSource }, { input, element, operations }),
		);

		if (!instruction) return null;

		return Match.value(instruction.operation).pipe(
			Match.when("combine", () =>
				getCombineOperation({
					operationSource,
					target: { _tag: "Commit", commitId },
				}),
			),
			Match.when("reorder-before", () =>
				getCommitTargetSideOperation({
					operationSource,
					commitId,
					side: "above",
					previousCommitId,
					nextCommitId,
				}),
			),
			Match.when("reorder-after", () =>
				getCommitTargetSideOperation({
					operationSource,
					commitId,
					side: "below",
					previousCommitId,
					nextCommitId,
				}),
			),
			Match.exhaustive,
		);
	});

	const insertionSide = operation ? getInsertionSide(operation) : null;

	const targetTooltipOperation = insertionSide === null ? operation : null;

	const target = useRender({
		render,
		ref: dropRef,
		props: mergeProps<"div">(props, {
			className: classes(targetTooltipOperation && styles.activeTarget),
		}),
	});

	return (
		<div className={styles.commit}>
			<OperationTooltip operation={targetTooltipOperation} render={target} />

			{insertionSide !== null && (
				<OperationTooltip
					operation={operation}
					className={classes(
						styles.commitInsertionTarget,
						pipe(
							insertionSide,
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

export const BranchTarget: FC<
	{
		branchRef: Array<number>;
		firstCommitId: string | undefined;
		projectId: string;
	} & useRender.ComponentProps<"div">
> = ({ branchRef, firstCommitId, projectId, render, ...props }) => {
	const resolveOperationSource = useResolveOperationSource(projectId);
	const [operation, dropRef] = useDroppable(({ source }) => {
		const operationSourceRef = parseDragData(source.data);
		if (!operationSourceRef) return null;

		const operationSource = resolveOperationSource(operationSourceRef);
		if (!operationSource) return null;

		return getBranchTargetOperation({ operationSource, branchRef, firstCommitId });
	});

	const target = useRender({
		render,
		ref: dropRef,
		props: mergeProps<"div">(props, {
			className: classes(operation && styles.activeTarget),
		}),
	});

	return <OperationTooltip operation={operation} render={target} />;
};

export const TearOffBranchTarget: FC<{ projectId: string } & useRender.ComponentProps<"div">> = ({
	projectId,
	render,
	...props
}) => {
	const resolveOperationSource = useResolveOperationSource(projectId);
	const [operation, dropRef] = useDroppable(({ source }): Operation | null => {
		const operationSourceRef = parseDragData(source.data);
		if (!operationSourceRef) return null;

		const operationSource = resolveOperationSource(operationSourceRef);
		if (!operationSource) return null;

		if (operationSource._tag !== "Segment") return null;
		if (operationSource.branchRef === null) return null;

		return {
			_tag: "TearOffBranch",
			subjectBranch: decodeRefName(operationSource.branchRef),
		};
	});

	const target = useRender({
		render,
		ref: dropRef,
		props: mergeProps<"div">(props, {
			className: classes(operation && styles.activeTarget),
		}),
	});

	return <OperationTooltip operation={operation} render={target} />;
};
