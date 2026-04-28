import {
	formatForDisplay,
	useHotkeyRegistrations,
	type HotkeyRegistrationView,
} from "@tanstack/react-hotkeys";
import { useMatch } from "@tanstack/react-router";
import { useEffectiveFocusedProjectPanel } from "#ui/routes/project/$id/ProjectPreviewLayout.tsx";
import { FC } from "react";
import styles from "./ShortcutsBar.module.css";
import { useActiveElement } from "#ui/focus.ts";
import { isInputElement } from "#ui/TanStackHotkeys.ts";

export const ShortcutsBar: FC = () => {
	const projectMatch = useMatch({
		from: "/project/$id",
		shouldThrow: false,
	});
	if (!projectMatch) return null;

	return <ProjectShortcutsBar projectId={projectMatch.params.id} />;
};

const isInputIgnoredHotkey = ({
	activeElement,
	hotkey,
}: {
	activeElement: Element | null;
	hotkey: HotkeyRegistrationView;
}): boolean =>
	hotkey.options.ignoreInputs !== false &&
	isInputElement(activeElement) &&
	activeElement !== hotkey.target;

const ProjectShortcutsBar: FC<{ projectId: string }> = ({ projectId }) => {
	const focusedPanel = useEffectiveFocusedProjectPanel(projectId);
	const activeElement = useActiveElement();
	const { hotkeys } = useHotkeyRegistrations();
	const visibleHotkeys = hotkeys.filter(
		(hotkey) =>
			hotkey.options.enabled !== false &&
			!isInputIgnoredHotkey({ activeElement, hotkey }) &&
			hotkey.options.meta?.name !== undefined &&
			hotkey.options.meta.shortcutsBar !== false,
	);

	if (visibleHotkeys.length === 0) return null;

	return (
		<div className={styles.container}>
			<span className={styles.scope}>{focusedPanel ?? "Shortcuts"}</span>
			{visibleHotkeys.map((hotkey) => (
				<div key={hotkey.id} className={styles.item}>
					<span className={styles.keys}>{formatForDisplay(hotkey.hotkey)}</span>
					<span>{hotkey.options.meta?.name}</span>
				</div>
			))}
		</div>
	);
};
