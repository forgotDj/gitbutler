export type Panel = "primary" | "preview";

/** @public */
export type SplitPanelLayout = { focus: Panel };
export type PanelLayout = { _tag: "Primary" } | ({ _tag: "Split" } & SplitPanelLayout);

/** @public */
export const primaryPanelLayout: PanelLayout = {
	_tag: "Primary",
};

/** @public */
export const splitPanelLayout = ({ focus }: SplitPanelLayout): PanelLayout => ({
	_tag: "Split",
	focus,
});

export type ProjectLayoutState = {
	panelLayout: PanelLayout;
};

export const createInitialState = (): ProjectLayoutState => ({
	panelLayout: splitPanelLayout({ focus: "primary" }),
});

export const initialState: ProjectLayoutState = createInitialState();

export const closePreview = (state: ProjectLayoutState) => {
	state.panelLayout = primaryPanelLayout;
};

export const focusPrimary = (state: ProjectLayoutState) => {
	state.panelLayout =
		state.panelLayout._tag === "Primary"
			? state.panelLayout
			: splitPanelLayout({ focus: "primary" });
};

export const focusPreview = (state: ProjectLayoutState) => {
	state.panelLayout = splitPanelLayout({ focus: "preview" });
};

export const togglePreview = (state: ProjectLayoutState) => {
	state.panelLayout =
		state.panelLayout._tag === "Primary"
			? splitPanelLayout({ focus: "primary" })
			: primaryPanelLayout;
};

export const getFocus = (state: ProjectLayoutState): Panel =>
	state.panelLayout._tag === "Split" ? state.panelLayout.focus : "primary";

export const isPreviewPanelVisible = (state: ProjectLayoutState): boolean =>
	state.panelLayout._tag === "Split";
