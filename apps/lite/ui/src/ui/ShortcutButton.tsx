import { classes } from "#ui/ui/classes.ts";
import uiStyles from "#ui/ui/ui.module.css";
import { Tooltip } from "@base-ui/react";
import {
	formatForDisplay,
	useHotkey,
	type RegisterableHotkey,
	type UseHotkeyOptions,
} from "@tanstack/react-hotkeys";
import { ComponentPropsWithoutRef, FC, useRef } from "react";

export const ShortcutButton: FC<
	Omit<ComponentPropsWithoutRef<"button">, "children"> & {
		children: string;
		hotkey: RegisterableHotkey;
		hotkeyOptions?: UseHotkeyOptions;
	}
> = ({ children, hotkey, hotkeyOptions, ...props }) => {
	const buttonRef = useRef<HTMLButtonElement>(null);
	const tooltip = `${children} (${formatForDisplay(hotkey)})`;

	useHotkey(hotkey, () => buttonRef.current?.click(), hotkeyOptions);

	return (
		<Tooltip.Root>
			<Tooltip.Trigger
				{...props}
				ref={buttonRef}
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
