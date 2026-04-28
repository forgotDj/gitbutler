import { classes } from "#ui/classes.ts";
import uiStyles from "#ui/ui.module.css";
import { Tooltip } from "@base-ui/react";
import { formatForDisplay } from "@tanstack/react-hotkeys";
import { ComponentPropsWithoutRef, FC } from "react";

export const ShortcutButton: FC<
	Omit<ComponentPropsWithoutRef<"button">, "children"> & {
		children: string;
		hotkey: string;
	}
> = ({ children, hotkey, ...props }) => {
	const tooltip = `${children} (${formatForDisplay(hotkey)})`;

	return (
		<Tooltip.Root>
			<Tooltip.Trigger
				{...props}
				className={classes(uiStyles.button, props.className)}
				aria-label={props["aria-label"] ?? tooltip}
			>
				{children}
			</Tooltip.Trigger>
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
