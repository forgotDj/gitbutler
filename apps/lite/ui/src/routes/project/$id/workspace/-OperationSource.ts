import { type FileParent } from "#ui/domain/FileParent.ts";
import { type HunkHeader } from "@gitbutler/but-sdk";
import { Match } from "effect";
import { type Item } from "./-Item.ts";

/**
 * The source of an operation before it has been materialized into data that can
 * be sent to the backend (`ResolvedOperationSource`).
 */
export type OperationSource =
	| { _tag: "BaseCommit" }
	| { _tag: "ChangesSection"; stackId: string | null }
	| { _tag: "Commit"; commitId: string }
	| { _tag: "File"; parent: FileParent; path: string }
	| { _tag: "Hunk"; parent: FileParent; path: string; hunkHeader: HunkHeader }
	| { _tag: "Segment"; branchRef: Array<number> | null };

const operationSourceIdentityKey = (operationSource: OperationSource): string =>
	Match.value(operationSource).pipe(
		Match.tagsExhaustive({
			BaseCommit: () => JSON.stringify(["BaseCommit"]),
			ChangesSection: ({ stackId }) => JSON.stringify(["ChangesSection", stackId]),
			Commit: ({ commitId }) => JSON.stringify(["Commit", commitId]),
			File: ({ parent, path }) => JSON.stringify(["File", parent, path]),
			Hunk: ({ parent, path, hunkHeader }) => JSON.stringify(["Hunk", parent, path, hunkHeader]),
			Segment: ({ branchRef }) => JSON.stringify(["Segment", branchRef]),
		}),
	);

export const operationSourceEquals = (a: OperationSource, b: OperationSource): boolean =>
	operationSourceIdentityKey(a) === operationSourceIdentityKey(b);

export const operationSourceFromItem = (item: Item): OperationSource =>
	Match.value(item).pipe(
		Match.tagsExhaustive({
			BaseCommit: (): OperationSource => ({ _tag: "BaseCommit" }),
			Change: ({ stackId, path }): OperationSource => ({
				_tag: "File",
				parent: { _tag: "ChangesSection", stackId },
				path,
			}),
			ChangesSection: ({ stackId }): OperationSource => ({ _tag: "ChangesSection", stackId }),
			Commit: ({ commitId }): OperationSource => ({ _tag: "Commit", commitId }),
			CommitFile: ({ commitId, path }): OperationSource => ({
				_tag: "File",
				parent: { _tag: "Commit", commitId },
				path,
			}),
			Segment: ({ branchRef }): OperationSource => ({ _tag: "Segment", branchRef }),
		}),
	);

export const operationSourceMatchesItem = (source: OperationSource, item: Item): boolean =>
	operationSourceEquals(source, operationSourceFromItem(item));
