import { Match } from "effect";
import { type OperationSource, operationSourceMatchesItem } from "./OperationSource.ts";
import { branchItem, commitItem, itemEquals, type Item } from "./Item.ts";
import { type NavigationIndex } from "./WorkspaceModel.ts";

/** @public */
export type RubOperationMode = { source: OperationSource };
/** @public */
export type MoveOperationMode = { source: OperationSource };
export type OperationMode =
	| ({ _tag: "Rub" } & RubOperationMode)
	| ({ _tag: "Move" } & MoveOperationMode);

/** @public */
export type RewordCommitWorkspaceMode = { stackId: string; commitId: string };
/** @public */
export type RenameBranchWorkspaceMode = { stackId: string; branchRef: Array<number> };
export type WorkspaceMode =
	| { _tag: "Default" }
	| ({ _tag: "RewordCommit" } & RewordCommitWorkspaceMode)
	| ({ _tag: "RenameBranch" } & RenameBranchWorkspaceMode)
	| OperationMode;

/** @public */
export const rubOperationMode = ({ source }: RubOperationMode): OperationMode => ({
	_tag: "Rub",
	source,
});

/** @public */
export const moveOperationMode = ({ source }: MoveOperationMode): OperationMode => ({
	_tag: "Move",
	source,
});

/** @public */
export const defaultWorkspaceMode: WorkspaceMode = {
	_tag: "Default",
};

/** @public */
export const rewordCommitWorkspaceMode = ({
	stackId,
	commitId,
}: RewordCommitWorkspaceMode): WorkspaceMode => ({
	_tag: "RewordCommit",
	stackId,
	commitId,
});

/** @public */
export const renameBranchWorkspaceMode = ({
	stackId,
	branchRef,
}: RenameBranchWorkspaceMode): WorkspaceMode => ({
	_tag: "RenameBranch",
	stackId,
	branchRef,
});

export const getOperationMode = (mode: WorkspaceMode): OperationMode | null =>
	mode._tag === "Rub" || mode._tag === "Move" ? mode : null;

export const isValidWorkspaceMode = ({
	mode,
	navigationIndex,
}: {
	mode: WorkspaceMode;
	navigationIndex: NavigationIndex;
}): boolean =>
	Match.value(mode).pipe(
		Match.tagsExhaustive({
			Default: () => true,
			Rub: (mode) =>
				navigationIndex.items.some((item) => operationSourceMatchesItem(mode.source, item)),
			Move: (mode) =>
				navigationIndex.items.some((item) => operationSourceMatchesItem(mode.source, item)),
			RewordCommit: (mode) =>
				navigationIndex.items.some((item) =>
					itemEquals(
						item,
						commitItem({
							stackId: mode.stackId,
							commitId: mode.commitId,
						}),
					),
				),
			RenameBranch: (mode) =>
				navigationIndex.items.some((item) =>
					itemEquals(
						item,
						branchItem({
							stackId: mode.stackId,
							branchRef: mode.branchRef,
						}),
					),
				),
		}),
	);

export const isValidWorkspaceModeForItem = ({
	mode,
	item,
}: {
	mode: WorkspaceMode;
	item: Item | null;
}): boolean =>
	Match.value(mode).pipe(
		Match.tagsExhaustive({
			Default: () => true,
			Rub: () => true,
			Move: () => true,
			RewordCommit: (mode) =>
				!!item &&
				itemEquals(
					item,
					commitItem({
						stackId: mode.stackId,
						commitId: mode.commitId,
					}),
				),
			RenameBranch: (mode) =>
				!!item &&
				itemEquals(
					item,
					branchItem({
						stackId: mode.stackId,
						branchRef: mode.branchRef,
					}),
				),
		}),
	);
