import { useSuspenseQuery } from "@tanstack/react-query";
import { HotkeysProvider, useHotkey } from "@tanstack/react-hotkeys";
import { Outlet, useMatch, useNavigate } from "@tanstack/react-router";
import { FC } from "react";
import { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext } from "@tanstack/react-router";
import { useFocusedProjectPanel } from "#ui/routes/project/$id/ProjectPreviewLayout.tsx";
import { ShortcutsBar } from "#ui/routes/project/$id/ShortcutsBar.tsx";
import { isPanelVisible } from "#ui/routes/project/$id/state/layout.ts";
import { ShortcutButton } from "#ui/ShortcutButton.tsx";
import {
	projectActions,
	selectProjectLayoutState,
} from "#ui/routes/project/$id/state/projectSlice.ts";
import { useAppDispatch, useAppSelector } from "#ui/state/hooks.ts";
import uiStyles from "#ui/ui.module.css";
import styles from "./__root.module.css";
import { listProjectsQueryOptions } from "#ui/api/queries.ts";

export const lastOpenedProjectKey = "lastProject";

interface RouteContext {
	queryClient: QueryClient;
}

const ProjectSelect: FC = () => {
	const { data: projects } = useSuspenseQuery(listProjectsQueryOptions);
	const navigate = useNavigate();
	const projectMatch = useMatch({
		from: "/project/$id",
		shouldThrow: false,
	});
	const selectedProjectId = projectMatch?.params.id;

	return (
		<select
			name="projectId"
			disabled={projects.length === 0}
			value={selectedProjectId ?? ""}
			onChange={(event) => {
				const nextProjectId = event.currentTarget.value;
				void navigate({
					to: "/project/$id/workspace",
					params: { id: nextProjectId },
				});
				window.localStorage.setItem(lastOpenedProjectKey, nextProjectId);
			}}
			className={uiStyles.button}
		>
			<option value="" disabled>
				Select a project
			</option>
			{projects.map((project) => (
				<option key={project.id} value={project.id}>
					{project.title}
				</option>
			))}
		</select>
	);
};

const TopBarActions: FC = () => {
	const dispatch = useAppDispatch();
	const projectId = useMatch({
		from: "/project/$id",
	}).params.id;
	const layoutState = useAppSelector((state) => selectProjectLayoutState(state, projectId));
	const focusedPanel = useFocusedProjectPanel();
	const toggleShow = () => {
		if (focusedPanel === "show" && isPanelVisible(layoutState, "show")) {
			const showPanelIndex = layoutState.visiblePanels.indexOf("show");
			const nextPanel = layoutState.visiblePanels[showPanelIndex - 1];
			if (nextPanel !== undefined)
				document.getElementById(nextPanel)?.focus({ focusVisible: false });
		}

		dispatch(projectActions.togglePanel({ projectId, panel: "show" }));
	};

	const toggleShowHotkey = "P";

	useHotkey(toggleShowHotkey, toggleShow, {
		meta: { group: "Details", name: isPanelVisible(layoutState, "show") ? "Close" : "Open" },
	});

	return (
		<div className={styles.topBarActions}>
			<ShortcutButton
				hotkey={toggleShowHotkey}
				aria-pressed={isPanelVisible(layoutState, "show")}
				onClick={toggleShow}
			>
				Details
			</ShortcutButton>
		</div>
	);
};

const TopBar: FC = () => {
	const projectMatch = useMatch({
		from: "/project/$id",
		shouldThrow: false,
	});

	return (
		<header className={styles.topBar}>
			<ProjectSelect />
			{projectMatch && <TopBarActions />}
		</header>
	);
};

const RootLayout: FC = () => (
	<HotkeysProvider>
		<main className={styles.layout}>
			<TopBar />
			<section className={styles.content}>
				<Outlet />
			</section>
			<footer className={styles.shortcutsBarFooter}>
				<ShortcutsBar />
			</footer>
		</main>
	</HotkeysProvider>
);

export const Route = createRootRouteWithContext<RouteContext>()({
	component: RootLayout,
});
