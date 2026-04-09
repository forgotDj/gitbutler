import { Match } from "effect";
import { type SelectedItem } from "../workspace/-SelectedItem.ts";

export type WorkspaceSelectionState = {
	item: SelectedItem | null;
	hunk: string | null;
};

export type WorkspaceSelectionAction =
	| { _tag: "SelectItem"; item: SelectedItem | null }
	| { _tag: "SelectHunk"; hunk: string | null };

export const initialWorkspaceSelectionState: WorkspaceSelectionState = {
	item: null,
	hunk: null,
};

export const workspaceSelectionReducer = (
	state: WorkspaceSelectionState,
	action: WorkspaceSelectionAction,
): WorkspaceSelectionState =>
	Match.value(action).pipe(
		Match.tagsExhaustive({
			SelectItem: ({ item }): WorkspaceSelectionState => ({
				item,
				hunk: null,
			}),
			SelectHunk: ({ hunk }): WorkspaceSelectionState => ({
				...state,
				hunk,
			}),
		}),
	);

export const normalizeSelectedPath = ({
	paths,
	selectedPath,
}: {
	paths: Array<string>;
	selectedPath: string | null | undefined;
}): string | undefined => {
	if (selectedPath != null && paths.includes(selectedPath)) return selectedPath;
	return paths[0];
};

export const normalizeSelectedHunk = ({
	hunkKeys,
	selectedHunk,
}: {
	hunkKeys: Array<string>;
	selectedHunk: string | null;
}): string | undefined => {
	if (selectedHunk !== null && hunkKeys.includes(selectedHunk)) return selectedHunk;
	return hunkKeys[0];
};
