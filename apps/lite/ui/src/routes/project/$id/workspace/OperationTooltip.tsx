import { classes } from "#ui/classes.ts";
import {
	getOperation,
	operationLabel,
	TargetData,
	useRunOperation,
	type Operation,
} from "#ui/Operation.ts";
import uiStyles from "#ui/ui.module.css";
import { Tooltip, useRender } from "@base-ui/react";
import { FC } from "react";
import styles from "./OperationTooltip.module.css";
import { itemEquals } from "./Item";
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
			<button type="button" className={uiStyles.button} onClick={cancel}>
				Cancel
			</button>
		</>
	);
};

export const OperationTooltip: FC<
	{
		projectId: string;
		targetData: TargetData | null;
		isDropTarget?: boolean;
	} & useRender.ComponentProps<"div">
> = ({ projectId, targetData, isDropTarget, render, ...props }) => {
	const isSource = !!targetData?.source && itemEquals(targetData.source, targetData.item);

	const operation = targetData ? getOperation(targetData) : null;

	const tooltipLabel = isSource ? (
		<>Select a target</>
	) : operation ? (
		<>{operationLabel(operation)}</>
	) : null;

	const trigger = useRender({ render, props });

	return (
		<Tooltip.Root
			open={!!tooltipLabel}
			disableHoverablePopup={isDropTarget}
			onOpenChange={(_open, eventDetails) => {
				eventDetails.allowPropagation();
			}}
		>
			<Tooltip.Trigger render={trigger} />
			<Tooltip.Portal>
				<Tooltip.Positioner sideOffset={8}>
					<Tooltip.Popup className={classes(uiStyles.popup, uiStyles.tooltip, styles.popup)}>
						{tooltipLabel}
						{!isDropTarget && <OperationModeControls projectId={projectId} operation={operation} />}
					</Tooltip.Popup>
				</Tooltip.Positioner>
			</Tooltip.Portal>
		</Tooltip.Root>
	);
};
