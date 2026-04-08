import { Match } from "effect";

export type ChangesSectionItem = { stackId: string | null };
export type ChangeItem = ChangesSectionItem & { path: string };

type SegmentItemBase = {
	stackId: string;
	segmentIndex: number;
	branchRef: Array<number> | null;
};

export type SegmentItem = SegmentItemBase;
export type CommitItem = SegmentItemBase & { commitId: string };

export type Item =
	| ({ _tag: "ChangesSection" } & ChangesSectionItem)
	| ({ _tag: "Change" } & ChangeItem)
	| ({ _tag: "Segment" } & SegmentItem)
	| ({ _tag: "Commit" } & CommitItem)
	| { _tag: "BaseCommit" };

export const changesSectionItem = (stackId: string | null): Item => ({
	_tag: "ChangesSection",
	stackId,
});

export const changeItem = (stackId: string | null, path: string): Item => ({
	_tag: "Change",
	stackId,
	path,
});

export const segmentItem = ({ stackId, segmentIndex, branchRef }: SegmentItem): Item => ({
	_tag: "Segment",
	stackId,
	segmentIndex,
	branchRef,
});

export const commitItem = ({ stackId, segmentIndex, branchRef, commitId }: CommitItem): Item => ({
	_tag: "Commit",
	stackId,
	segmentIndex,
	branchRef,
	commitId,
});

export const baseCommitItem: Item = {
	_tag: "BaseCommit",
};

export const itemIdentityKey = (item: Item): string =>
	Match.value(item).pipe(
		Match.tagsExhaustive({
			ChangesSection: (item) => JSON.stringify(["ChangesSection", item.stackId]),
			Change: (item) => JSON.stringify(["Change", item.stackId, item.path]),
			Segment: (item) =>
				JSON.stringify(["Segment", item.stackId, item.segmentIndex, item.branchRef]),
			Commit: (item) => JSON.stringify(["Commit", item.stackId, item.segmentIndex, item.commitId]),
			BaseCommit: () => JSON.stringify(["BaseCommit"]),
		}),
	);

export const getParentSection = (item: Item): Item | null =>
	Match.value(item).pipe(
		Match.tagsExhaustive({
			Commit: (item): Item | null =>
				segmentItem({
					stackId: item.stackId,
					segmentIndex: item.segmentIndex,
					branchRef: item.branchRef,
				}),
			Change: (item): Item | null => changesSectionItem(item.stackId),
			ChangesSection: () => null,
			BaseCommit: () => null,
			Segment: () => null,
		}),
	);
