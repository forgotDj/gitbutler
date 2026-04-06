import { Match } from "effect";
import { type OperationSource, operationSourceMatchesItem } from "./-OperationSource.ts";
import { type NavigationIndex } from "./-WorkspaceModel.ts";

export type OperationMode =
	| { _tag: "Rub"; source: OperationSource }
	| { _tag: "Move"; source: OperationSource };

export type WorkspaceMode =
	| { _tag: "Default" }
	| { _tag: "RewordCommit"; commitId: string }
	| { _tag: "RenameBranch"; stackId: string; segmentIndex: number }
	| OperationMode;

export const getOperationMode = (mode: WorkspaceMode): OperationMode | null =>
	mode._tag === "Rub" || mode._tag === "Move" ? mode : null;

export const normalizeWorkspaceMode = ({
	mode,
	navigationIndex,
}: {
	mode: WorkspaceMode;
	navigationIndex: NavigationIndex;
}): WorkspaceMode =>
	Match.value(mode).pipe(
		Match.tagsExhaustive({
			Default: () => mode,
			Rub: (mode): WorkspaceMode =>
				navigationIndex.items.some((item) => operationSourceMatchesItem(mode.source, item))
					? mode
					: { _tag: "Default" },
			Move: (mode): WorkspaceMode =>
				navigationIndex.items.some((item) => operationSourceMatchesItem(mode.source, item))
					? mode
					: { _tag: "Default" },
			RewordCommit: (mode): WorkspaceMode =>
				navigationIndex.items.some(
					(item) => item._tag === "Commit" && item.commitId === mode.commitId,
				)
					? mode
					: { _tag: "Default" },
			RenameBranch: (mode): WorkspaceMode =>
				navigationIndex.items.some(
					(item) =>
						item._tag === "Segment" &&
						item.stackId === mode.stackId &&
						item.segmentIndex === mode.segmentIndex,
				)
					? mode
					: { _tag: "Default" },
		}),
	);
