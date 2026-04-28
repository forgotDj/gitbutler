import { classes } from "#ui/classes.ts";
import { getOperation, operationLabel, useRunOperation, type Operation } from "#ui/Operation.ts";
import uiStyles from "#ui/ui.module.css";
import { Tooltip, useRender } from "@base-ui/react";
import { useHotkeys } from "@tanstack/react-hotkeys";
import { FC } from "react";
import styles from "./OperationTooltip.module.css";
import { Item, itemEquals } from "./Item";
import { useAppDispatch } from "#ui/state/hooks.ts";
import { projectActions } from "#ui/routes/project/$id/state/projectSlice.ts";
import {
	operationModeToOperationType,
	OperationMode,
} from "#ui/routes/project/$id/workspace/WorkspaceMode.ts";
import { Match } from "effect";

const OperationModeControls: FC<{
	projectId: string;
	operation: Operation | null;
	isActive: boolean;
}> = ({ projectId, operation, isActive }) => {
	const dispatch = useAppDispatch();
	const runOperation = useRunOperation();

	const confirm = () => {
		dispatch(projectActions.exitMode({ projectId }));

		if (!operation) return;

		runOperation(projectId, operation);
	};

	const cancel = () => dispatch(projectActions.exitMode({ projectId }));

	useHotkeys(
		[
			{
				hotkey: "Enter",
				callback: confirm,
				options: {
					enabled: operation !== null,
					meta: { group: "Operation mode", name: "Confirm" },
				},
			},
			{
				hotkey: "Escape",
				callback: cancel,
				options: { meta: { group: "Operation mode", name: "Cancel" } },
			},
		],
		{
			conflictBehavior: "allow",
			enabled: isActive,
		},
	);

	return (
		<>
			{operation && (
				<button type="button" className={uiStyles.button} onClick={confirm}>
					Confirm
				</button>
			)}
			<button type="button" className={uiStyles.button} onClick={cancel}>
				Cancel
			</button>
		</>
	);
};

export const OperationTooltip: FC<
	{
		projectId: string;
		item: Item;
		operationMode: OperationMode | null;
		isActive: boolean;
	} & useRender.ComponentProps<"div">
> = ({ projectId, item, operationMode, isActive, render, ...props }) => {
	const operation = operationMode?.source
		? getOperation({
				source: operationMode.source,
				target: item,
				operationType: operationModeToOperationType(operationMode),
			})
		: null;

	const tooltipLabel = isActive ? (
		operation ? (
			<>{operationLabel(operation)}</>
		) : !!operationMode?.source && itemEquals(operationMode.source, item) ? (
			<>Select a target</>
		) : null
	) : null;

	const trigger = useRender({ render, props });

	const showControls =
		isActive &&
		!!operationMode &&
		Match.value(operationMode).pipe(
			Match.tagsExhaustive({
				DragAndDrop: () => false,
				Rub: () => true,
				Move: () => true,
			}),
		);

	return (
		<Tooltip.Root
			open={!!tooltipLabel || showControls}
			disableHoverablePopup={!showControls}
			onOpenChange={(_open, eventDetails) => {
				eventDetails.allowPropagation();
			}}
		>
			<Tooltip.Trigger render={trigger} />
			<Tooltip.Portal>
				<Tooltip.Positioner sideOffset={8}>
					<Tooltip.Popup className={classes(uiStyles.popup, uiStyles.tooltip, styles.popup)}>
						{tooltipLabel}
						{showControls && (
							<OperationModeControls
								projectId={projectId}
								operation={operation}
								isActive={isActive}
							/>
						)}
					</Tooltip.Popup>
				</Tooltip.Positioner>
			</Tooltip.Portal>
		</Tooltip.Root>
	);
};
