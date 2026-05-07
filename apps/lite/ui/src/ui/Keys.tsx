import styles from "./Keys.module.css";
import { formatForDisplay } from "@tanstack/react-hotkeys";
import { FC } from "react";

type Props = {
	hotkey: Parameters<typeof formatForDisplay>[0];
};

export const Keys: FC<Props> = ({ hotkey }) => (
	<span className={styles.keys}>
		{formatForDisplay(hotkey)
			.split(" ")
			.map((key) => (
				<kbd key={key}>{key}</kbd>
			))}
	</span>
);
