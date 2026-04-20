import { classes } from "#ui/classes.ts";
import { operationLabel, useRunOperation, type Operation } from "#ui/Operation.ts";
import uiStyles from "#ui/ui.module.css";
import { Tooltip, useRender } from "@base-ui/react";
import { FC } from "react";
import styles from "./route.module.css";
import { OperationSource, operationSourceMatchesItem } from "./OperationSource";
import { Item } from "./Item";
import { useAppDispatch } from "#ui/state/hooks.ts";
import { projectActions } from "#ui/routes/project/$id/state/projectSlice.ts";

const OperationModeControls: FC<{
	projectId: string;
	operation: Operation | null;
}> = ({ projectId, operation }) => {
	const dispatch = useAppDispatch();
	const runOperation = useRunOperation();

	const confirm = () => {
		dispatch(projectActions.exitMode({ projectId }));

		if (!operation) return;

		runOperation(projectId, operation);
	};

	const cancel = () => dispatch(projectActions.exitMode({ projectId }));

	return (
		<>
			<button type="button" className={uiStyles.button} onClick={confirm}>
				Confirm
			</button>
			<button type="button" className={uiStyles.button} aria-label="Cancel" onClick={cancel}>
				Cancel
			</button>
		</>
	);
};

export const OperationTooltip: FC<
	{
		projectId: string;
		enabled: boolean;
		operation: Operation | null;
		source?: OperationSource;
		item: Item;
		isOperationMode?: boolean;
	} & useRender.ComponentProps<"div">
> = ({ projectId, enabled, operation, source, item, isOperationMode, render, ...props }) => {
	const isSource = source && operationSourceMatchesItem(source, item);

	const tooltip = enabled ? (
		<>
			{isSource ? <>Select a target</> : operation ? operationLabel(operation) : null}
			{isOperationMode && <OperationModeControls projectId={projectId} operation={operation} />}
		</>
	) : null;

	const trigger = useRender({ render, props });

	return (
		<Tooltip.Root
			open={!!tooltip}
			disableHoverablePopup={!isOperationMode}
			onOpenChange={(_open, eventDetails) => {
				eventDetails.allowPropagation();
			}}
		>
			<Tooltip.Trigger render={trigger} />
			<Tooltip.Portal>
				<Tooltip.Positioner sideOffset={8}>
					<Tooltip.Popup
						className={classes(uiStyles.popup, uiStyles.tooltip, styles.operationTooltipPopup)}
					>
						{tooltip}
					</Tooltip.Popup>
				</Tooltip.Positioner>
			</Tooltip.Portal>
		</Tooltip.Root>
	);
};
