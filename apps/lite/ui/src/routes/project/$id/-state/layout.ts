export type Panel = "primary" | "preview";

export type PanelLayout = { _tag: "Primary" } | { _tag: "Split"; focus: Panel };

export type ProjectLayoutState = {
	isFullscreenPreviewOpen: boolean;
	panelLayout: PanelLayout;
};

export const createInitialState = (): ProjectLayoutState => ({
	isFullscreenPreviewOpen: false,
	panelLayout: { _tag: "Split", focus: "primary" },
});

export const initialState: ProjectLayoutState = createInitialState();

export const closeFullscreenPreview = (state: ProjectLayoutState) => {
	state.isFullscreenPreviewOpen = false;
};

export const closePreview = (state: ProjectLayoutState) => {
	if (state.isFullscreenPreviewOpen) {
		state.isFullscreenPreviewOpen = false;
		return;
	}

	state.panelLayout = { _tag: "Primary" };
};

export const focusPrimary = (state: ProjectLayoutState) => {
	state.isFullscreenPreviewOpen = false;
	state.panelLayout =
		state.panelLayout._tag === "Primary" ? state.panelLayout : { _tag: "Split", focus: "primary" };
};

export const focusPreview = (state: ProjectLayoutState) => {
	if (state.isFullscreenPreviewOpen) return;
	state.panelLayout = { _tag: "Split", focus: "preview" };
};

export const openFullscreenPreview = (state: ProjectLayoutState) => {
	state.isFullscreenPreviewOpen = true;
};

export const toggleFullscreenPreview = (state: ProjectLayoutState) => {
	state.isFullscreenPreviewOpen = !state.isFullscreenPreviewOpen;
};

export const togglePreview = (state: ProjectLayoutState) => {
	state.panelLayout =
		state.panelLayout._tag === "Primary"
			? { _tag: "Split", focus: "primary" }
			: { _tag: "Primary" };
};

const getPanelFocus = (state: ProjectLayoutState): Panel =>
	state.panelLayout._tag === "Split" ? state.panelLayout.focus : "primary";

export const getFocus = (state: ProjectLayoutState): Panel =>
	state.isFullscreenPreviewOpen ? "preview" : getPanelFocus(state);

export const isPreviewPanelVisible = (state: ProjectLayoutState): boolean =>
	state.panelLayout._tag === "Split";
