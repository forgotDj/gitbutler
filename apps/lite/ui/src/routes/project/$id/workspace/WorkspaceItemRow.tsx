import { classes } from "#ui/ui/classes.ts";
import { Toolbar } from "@base-ui/react/toolbar";
import { useMergedRefs } from "@base-ui/utils/useMergedRefs";
import { ComponentProps, FC, useLayoutEffect, useRef } from "react";
import styles from "./WorkspaceItemRow.module.css";

export const WorkspaceItemRow: FC<
	{
		isSelected?: boolean;
	} & ComponentProps<"div">
> = ({ className, isSelected, ref: refProp, ...props }) => {
	const rowRef = useRef<HTMLDivElement | null>(null);
	const mergedRef = useMergedRefs(rowRef, refProp);

	useLayoutEffect(() => {
		if (!isSelected) return;
		rowRef.current?.scrollIntoView({
			block: "nearest",
			inline: "nearest",
		});
	}, [isSelected]);

	return (
		<div
			{...props}
			ref={mergedRef}
			className={classes(className, styles.itemRow, isSelected && styles.itemRowSelected)}
		/>
	);
};

export const WorkspaceItemRowToolbar: FC<
	Omit<ComponentProps<typeof Toolbar.Root>, "className">
> = ({ onClick, ...props }) => (
	<Toolbar.Root
		{...props}
		className={styles.itemRowToolbar}
		onClick={(event) => {
			onClick?.(event);
			event.stopPropagation();
		}}
	/>
);
