import { Match } from "effect";

/** @public */
export type ChangesSectionItem = { _tag: "ChangesSection" };
/** @public */
export type ChangeItem = { path: string };

/** @public */
export type StackItem = {
	stackId: string;
};

/** @public */
export type BranchItem = StackItem & {
	branchRef: Array<number>;
};
/** @public */
export type CommitItem = StackItem & { commitId: string };
/** @public */
export type CommitFileItem = CommitItem & { path: string };

/**
 * A selectable item in the primary panel.
 */
export type Item =
	| ChangesSectionItem
	| ({ _tag: "ChangeFile" } & ChangeItem)
	| ({ _tag: "Stack" } & StackItem)
	| ({ _tag: "Branch" } & BranchItem)
	| ({ _tag: "Commit" } & CommitItem)
	| ({ _tag: "CommitFile" } & CommitFileItem)
	| { _tag: "BaseCommit" };

/** @public */
export const changesSectionItem: ChangesSectionItem = {
	_tag: "ChangesSection",
};

/** @public */
export const changeFileItem = ({ path }: ChangeItem): Item => ({
	_tag: "ChangeFile",
	path,
});

/** @public */
export const stackItem = ({ stackId }: StackItem): Item => ({
	_tag: "Stack",
	stackId,
});

/** @public */
export const branchItem = ({ stackId, branchRef }: BranchItem): Item => ({
	_tag: "Branch",
	stackId,
	branchRef,
});

/** @public */
export const commitItem = ({ stackId, commitId }: CommitItem): Item => ({
	_tag: "Commit",
	stackId,
	commitId,
});

/** @public */
export const commitFileItem = ({ stackId, commitId, path }: CommitFileItem): Item => ({
	_tag: "CommitFile",
	stackId,
	commitId,
	path,
});

/** @public */
export const baseCommitItem: Item = {
	_tag: "BaseCommit",
};

export const itemIdentityKey = (item: Item): string =>
	Match.value(item).pipe(
		Match.tagsExhaustive({
			ChangesSection: () => JSON.stringify(["ChangesSection"]),
			ChangeFile: (item) => JSON.stringify(["ChangeFile", item.path]),
			Stack: (item) => JSON.stringify(["Stack", item.stackId]),
			Branch: (item) => JSON.stringify(["Branch", item.stackId, item.branchRef]),
			Commit: (item) => JSON.stringify(["Commit", item.stackId, item.commitId]),
			CommitFile: (item) => JSON.stringify(["CommitFile", item.stackId, item.commitId, item.path]),
			BaseCommit: () => JSON.stringify(["BaseCommit"]),
		}),
	);

export const itemEquals = (a: Item, b: Item): boolean => itemIdentityKey(a) === itemIdentityKey(b);
