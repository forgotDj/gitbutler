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
import { useHotkey } from "@tanstack/react-hotkeys";
import { FC } from "react";
import styles from "./OperationTooltip.module.css";
import { Operand, operandEquals } from "#ui/operands.ts";
import { useAppDispatch } from "#ui/store.ts";
import { projectActions } from "#ui/projects/state.ts";
import { operationModeToOperationType, OperationMode } from "#ui/outline/mode.ts";
import { Match } from "effect";

const OperationModeControls: FC<{
	projectId: string;
	operation: Operation | null;
	operationMode: OperationMode;
}> = ({ projectId, operation, operationMode }) => {
	const dispatch = useAppDispatch();
	const runOperation = useRunOperation();

	const confirm = () => {
		dispatch(projectActions.exitMode({ projectId }));

		if (!operation) return;

		runOperation(projectId, operation);
	};

	const cancel = () => dispatch(projectActions.exitMode({ projectId }));

	useHotkey("Mod+V", confirm, {
		conflictBehavior: "allow",
		enabled: operation !== null && operationMode._tag === "Rub",
		ignoreInputs: true,
		meta: { group: "Operation mode", name: "Paste" },
	});

	return (
		<>
			{operation && (
				<ShortcutButton
					hotkey="Enter"
					hotkeyOptions={{
						conflictBehavior: "allow",
						meta: { group: "Operation mode", name: "Confirm" },
					}}
					onClick={confirm}
				>
					Confirm
				</ShortcutButton>
			)}
			<ShortcutButton
				hotkey="Escape"
				hotkeyOptions={{
					conflictBehavior: "allow",
					meta: { group: "Operation mode", name: "Cancel" },
				}}
				onClick={cancel}
			>
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
	const tooltip =
		isActive && !!operationMode
			? Match.value(operationMode).pipe(
					Match.tags({
						DragAndDrop: () => {
							const operation = getOperation({
								source: operationMode.source,
								target: operand,
								operationType: operationModeToOperationType(operationMode),
							});
							if (!operation) return null;

							return <>{operationLabel(operation)}</>;
						},
					}),
					Match.orElse(() => {
						const operation = getOperation({
							source: operationMode.source,
							target: operand,
							operationType: operationModeToOperationType(operationMode),
						});
						return (
							<>
								{operation ? (
									<>{operationLabel(operation)}</>
								) : operandEquals(operationMode.source, operand) ? (
									<>Select a target</>
								) : null}
								<OperationModeControls
									projectId={projectId}
									operation={operation}
									operationMode={operationMode}
								/>
							</>
						);
					}),
				)
			: null;

	const trigger = useRender({ render, props });

	const isDragAndDrop =
		!!operationMode &&
		Match.value(operationMode).pipe(
			Match.tags({ DragAndDrop: () => true }),
			Match.orElse(() => false),
		);

	return (
		<Tooltip.Root
			open={!!tooltip}
			disableHoverablePopup={isDragAndDrop}
			onOpenChange={(_open, eventDetails) => {
				eventDetails.allowPropagation();
			}}
		>
			<Tooltip.Trigger render={trigger} />
			<Tooltip.Portal>
				<Tooltip.Positioner sideOffset={8}>
					<Tooltip.Popup className={classes(uiStyles.popup, uiStyles.tooltip, styles.popup)}>
						{tooltip}
					</Tooltip.Popup>
				</Tooltip.Positioner>
			</Tooltip.Portal>
		</Tooltip.Root>
	);
};
