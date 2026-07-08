import { Dialog } from "@base-ui/react";
import type { FC } from "react";
import styles from "./Settings.module.css";
import { useSuspenseQuery } from "@tanstack/react-query";
import { getGUISettingsQueryOptions, listEditorsQueryOptions } from "#ui/api/queries.ts";
import { useSaveGUISettings } from "#ui/api/mutations.ts";
import type { ThemeCollectionFilter } from "@pierre/theming";
import { themes } from "@pierre/theming/themes";
import type { ThemesType } from "@pierre/diffs/react";
import { defaultTheme, displayName } from "#ui/syntax-highlighting.ts";

const getRenderableThemes = (filter?: ThemeCollectionFilter) =>
	themes
		.getThemes(filter)
		.map((theme) => ({
			name: theme.name,
			displayName: displayName(theme.name) ?? theme.displayName ?? theme.name,
		}))
		.toSorted((a, b) => a.displayName.localeCompare(b.displayName));

type Props = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

export const Settings: FC<Props> = ({ open, onOpenChange }) => {
	const { data: editors } = useSuspenseQuery(listEditorsQueryOptions);
	const { data: settings } = useSuspenseQuery(getGUISettingsQueryOptions());
	const saveGUISettings = useSaveGUISettings();

	const setTheme = (variant: keyof ThemesType, themeName: string): void => {
		saveGUISettings.mutate({
			syntaxHighlighting: {
				light: variant === "light" ? themeName : settings.syntaxHighlighting?.light,
				dark: variant === "dark" ? themeName : settings.syntaxHighlighting?.dark,
			},
		});
	};

	const lightThemes = getRenderableThemes({ colorScheme: "light" });
	const darkThemes = getRenderableThemes({ colorScheme: "dark" });

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Backdrop className={styles.backdrop} />
				<Dialog.Viewport className={styles.viewport}>
					<Dialog.Popup aria-labelledby="settings-heading" className={styles.popup}>
						<h1
							id="settings-heading"
							className="text-15 text-semibold"
							style={{ marginBlockEnd: 16 }}
						>
							Settings
						</h1>

						<label
							htmlFor="editor"
							className="text-12 text-semibold"
							style={{ color: "var(--text-2)" }}
						>
							Default editor
						</label>
						<div className="text-12">
							<select
								id="editor"
								value={settings.editorId ?? ""}
								onChange={(evt) =>
									saveGUISettings.mutate({
										editorId: evt.currentTarget.value,
									})
								}
							>
								<option value="" disabled>
									Select an editor...
								</option>
								{editors.map((editor) => (
									<option key={editor.id} value={editor.id}>
										{editor.name}
									</option>
								))}
							</select>
						</div>

						<label
							htmlFor="theme-light"
							className="text-12 text-semibold"
							style={{ color: "var(--text-2)" }}
						>
							Syntax theme (light)
						</label>
						<div className="text-12">
							<select
								id="theme-light"
								value={settings.syntaxHighlighting?.light ?? defaultTheme.light}
								onChange={(evt) => setTheme("light", evt.currentTarget.value)}
							>
								{lightThemes.map((theme) => (
									<option key={theme.name} value={theme.name}>
										{theme.displayName}
									</option>
								))}
							</select>
						</div>

						<label
							htmlFor="theme-dark"
							className="text-12 text-semibold"
							style={{ color: "var(--text-2)" }}
						>
							Syntax theme (dark)
						</label>
						<div className="text-12">
							<select
								id="theme-dark"
								value={settings.syntaxHighlighting?.dark ?? defaultTheme.dark}
								onChange={(evt) => setTheme("dark", evt.currentTarget.value)}
							>
								{darkThemes.map((theme) => (
									<option key={theme.name} value={theme.name}>
										{theme.displayName}
									</option>
								))}
							</select>
						</div>
					</Dialog.Popup>
				</Dialog.Viewport>
			</Dialog.Portal>
		</Dialog.Root>
	);
};
