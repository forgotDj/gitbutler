export type Panel = "primary" | "preview";
const orderedPanels: Array<Panel> = ["primary", "preview"];

export type ProjectLayoutState = {
	visiblePanels: Array<Panel>;
	focus: Panel;
};

export const createInitialState = (): ProjectLayoutState => ({
	visiblePanels: [...orderedPanels],
	focus: "primary",
});

export const initialState: ProjectLayoutState = createInitialState();

const isPanelVisible = (state: ProjectLayoutState, panel: Panel): boolean =>
	state.visiblePanels.includes(panel);

const getAdjacentPanel = ({
	state,
	panel,
	offset,
}: {
	state: ProjectLayoutState;
	panel: Panel;
	offset: -1 | 1;
}): Panel | null => {
	const orderedVisiblePanels = orderedPanels.filter((candidate) =>
		isPanelVisible(state, candidate),
	);
	const panelIndex = orderedVisiblePanels.indexOf(panel);
	if (panelIndex === -1) return null;

	return orderedVisiblePanels[panelIndex + offset] ?? null;
};

const showPanel = (state: ProjectLayoutState, panel: Panel) => {
	if (isPanelVisible(state, panel)) return;
	state.visiblePanels = orderedPanels.filter(
		(candidate) => candidate === panel || isPanelVisible(state, candidate),
	);
};

const hidePanel = (state: ProjectLayoutState, panel: Panel) => {
	if (!isPanelVisible(state, panel)) return;

	const adjacentPanel =
		getAdjacentPanel({ state, panel, offset: -1 }) ?? getAdjacentPanel({ state, panel, offset: 1 });
	state.visiblePanels = state.visiblePanels.filter((candidate) => candidate !== panel);

	if (state.focus !== panel) return;
	state.focus = adjacentPanel ?? "primary";
};

export const closePreview = (state: ProjectLayoutState) => {
	hidePanel(state, "preview");
};

export const focusPrimary = (state: ProjectLayoutState) => {
	state.focus = "primary";
};

export const focusPreview = (state: ProjectLayoutState) => {
	showPanel(state, "preview");
	state.focus = "preview";
};

export const focusPreviousPanel = (state: ProjectLayoutState) => {
	const previousPanel = getAdjacentPanel({ state, panel: state.focus, offset: -1 });
	if (previousPanel === null) return;
	state.focus = previousPanel;
};

export const focusNextPanel = (state: ProjectLayoutState) => {
	const nextPanel = getAdjacentPanel({ state, panel: state.focus, offset: 1 });
	if (nextPanel === null) return;
	state.focus = nextPanel;
};

export const togglePreview = (state: ProjectLayoutState) => {
	if (isPanelVisible(state, "preview")) {
		hidePanel(state, "preview");
		return;
	}

	showPanel(state, "preview");
};

export const getFocus = (state: ProjectLayoutState): Panel => state.focus;

export const getVisiblePanels = (state: ProjectLayoutState): Array<Panel> => state.visiblePanels;

export const isPreviewPanelVisible = (state: ProjectLayoutState): boolean =>
	isPanelVisible(state, "preview");
