import { type Operand } from "#ui/operands.ts";
import { parseDragData } from "./DragData.ts";
import styles from "./OperationTarget.module.css";
import {
	getOperation,
	getOperations,
	type OperationType,
	useRunOperation,
} from "#ui/operations/operation.ts";
import { classes } from "#ui/components/classes.ts";
import { projectSlice } from "#ui/projects/state.ts";
import { useAppDispatch } from "#ui/store.ts";
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import {
	attachInstruction,
	extractInstruction,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/list-item";
import { mergeProps, useRender } from "@base-ui/react";
import { Match } from "effect";
import { FC, useEffect, useEffectEvent, useRef } from "react";

type DropTargetParams = Parameters<typeof dropTargetForElements>[0];
type GetDataArgs = Parameters<NonNullable<DropTargetParams["getData"]>>[0];
type OnDropArgs = Parameters<NonNullable<DropTargetParams["onDrop"]>>[0];

type DropData = OnDropArgs["self"]["data"];

const getOperationTypeFromData = (data: DropData): OperationType | null => {
	const instruction = extractInstruction(data);
	if (!instruction) return null;

	return Match.value(instruction.operation).pipe(
		Match.withReturnType<OperationType>(),
		Match.when("combine", () => "into"),
		Match.when("reorder-before", () => "above"),
		Match.when("reorder-after", () => "below"),
		Match.exhaustive,
	);
};

// TODO: move
export const useOperationDropTarget = ({
	enabled,
	target,
	projectId,
}: {
	enabled: boolean;
	target: Operand;
	projectId: string;
}) => {
	const dispatch = useAppDispatch();
	const { mutate: runOperation } = useRunOperation();
	const dropRef = useRef<HTMLElement>(null);

	const getData = useEffectEvent(({ input, element, source }: GetDataArgs) => {
		const dragData = parseDragData(source.data);
		if (!dragData) return {};

		const { into, above, below } = getOperations(dragData.sources, target);
		return attachInstruction(
			{},
			{
				input,
				element,
				operations: {
					"reorder-before": above ? "available" : "not-available",
					"reorder-after": below ? "available" : "not-available",
					combine: into ? "available" : "not-available",
				},
			},
		);
	});

	const canDrop = useEffectEvent(() => enabled);

	useEffect(() => {
		const element = dropRef.current;
		if (!element) return;

		return dropTargetForElements({
			element,
			getData,
			canDrop,
			onDrag: (args) => {
				const [innerMost] = args.location.current.dropTargets;
				const isActiveDropTarget = innerMost?.element === args.self.element;

				if (!isActiveDropTarget) return;

				const operationType = getOperationTypeFromData(args.self.data);

				dispatch(
					projectSlice.actions.updatePointerTransfer({
						projectId,
						target,
						operationType,
					}),
				);
			},
			onDragLeave: () => {
				dispatch(
					projectSlice.actions.updatePointerTransfer({
						projectId,
						target: null,
						operationType: null,
					}),
				);
			},
			onDrop: (args) => {
				const [innerMost] = args.location.current.dropTargets;
				const isActiveDropTarget = innerMost?.element === args.self.element;

				if (!isActiveDropTarget) return;

				const dragData = parseDragData(args.source.data);
				const operationType = getOperationTypeFromData(args.self.data);
				const operation =
					dragData && operationType !== null
						? getOperation({
								sources: dragData.sources,
								target,
								operationType,
							})
						: null;

				if (!operation) {
					dispatch(projectSlice.actions.cancelMode({ projectId }));
					return;
				}

				dispatch(projectSlice.actions.exitMode({ projectId }));
				runOperation(operation.operation);
			},
		});
	}, [dispatch, projectId, runOperation, target]);

	return dropRef;
};

export type OperationTargetOutline = "inside" | "outside";

export const OperationTarget: FC<
	{
		operationType: OperationType | undefined;
		outline: OperationTargetOutline;
	} & useRender.ComponentProps<"div">
> = ({ operationType, outline, render, ...props }) =>
	useRender({
		render,
		props: mergeProps<"div">(props, {
			className: Match.value(operationType).pipe(
				Match.when("above", () => classes(styles.insertionTarget, styles.insertionTargetAbove)),
				Match.when("below", () => classes(styles.insertionTarget, styles.insertionTargetBelow)),
				Match.when("into", () =>
					classes(
						styles.activeTarget,
						Match.value(outline).pipe(
							Match.when("inside", () => styles.activeTargetInside),
							Match.when("outside", () => styles.activeTargetOutside),
							Match.exhaustive,
						),
					),
				),
				Match.when(undefined, () => undefined),
				Match.exhaustive,
			),
		}),
	});
