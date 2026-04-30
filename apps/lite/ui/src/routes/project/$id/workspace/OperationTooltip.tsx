import { classes } from "#ui/ui/classes.ts";
import {
	getOperation,
	operationLabel,
	useRunOperation,
	type Operation,
} from "#ui/operations/operation.ts";
import { ShortcutButton } from "#ui/ui/ShortcutButton.tsx";
import uiStyles from "#ui/ui/ui.module.css";
import { Tooltip, useRender } from "@base-ui/react";
import { useHotkeys } from "@tanstack/react-hotkeys";
import { FC } from "react";
import styles from "./OperationTooltip.module.css";
import { Operand, operandEquals } from "#ui/operands.ts";
import { useAppDispatch } from "#ui/store.ts";
import { projectActions } from "#ui/projects/state.ts";
import { operationModeToOperationType, OperationMode } from "#ui/workspace/mode.ts";
import { Match } from "effect";

const OperationModeControls: FC<{
	projectId: string;
	operation: Operation | null;
	operationMode: OperationMode;
	isActive: boolean;
}> = ({ projectId, operation, operationMode, isActive }) => {
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
				hotkey: "Mod+V",
				callback: confirm,
				options: {
					enabled: operation !== null && operationMode._tag === "Move",
					ignoreInputs: true,
					meta: { group: "Operation mode", name: "Paste" },
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
				<ShortcutButton hotkey="Enter" onClick={confirm}>
					Confirm
				</ShortcutButton>
			)}
			<ShortcutButton hotkey="Escape" onClick={cancel}>
				Cancel
			</ShortcutButton>
		</>
	);
};

export const OperationTooltip: FC<
	{
		projectId: string;
		operand: Operand;
		operationMode: OperationMode | null;
		isActive: boolean;
	} & useRender.ComponentProps<"div">
> = ({ projectId, operand, operationMode, isActive, render, ...props }) => {
	const operation = operationMode?.source
		? getOperation({
				source: operationMode.source,
				target: operand,
				operationType: operationModeToOperationType(operationMode),
			})
		: null;

	const tooltipLabel = isActive ? (
		operation ? (
			<>{operationLabel(operation)}</>
		) : !!operationMode?.source && operandEquals(operationMode.source, operand) ? (
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
								operationMode={operationMode}
								isActive={isActive}
							/>
						)}
					</Tooltip.Popup>
				</Tooltip.Positioner>
			</Tooltip.Portal>
		</Tooltip.Root>
	);
};
