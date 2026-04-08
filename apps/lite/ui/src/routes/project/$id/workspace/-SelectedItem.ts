import { Match } from "effect";
import {
	type ChangeItem,
	type ChangesSectionItem,
	type CommitItem,
	type Item,
	type SegmentItem,
} from "./-Item.ts";

export type SegmentMode = { _tag: "Default" } | { _tag: "Rename" };

export type SelectedSegmentItem = SegmentItem & { mode: SegmentMode };

export type CommitMode =
	| { _tag: "Default" }
	| { _tag: "Details"; path: string | null }
	| { _tag: "Reword" };

export type SelectedCommitItem = CommitItem & { mode: CommitMode };

export type SelectedItem =
	| ({ _tag: "ChangesSection" } & ChangesSectionItem)
	| ({ _tag: "Change" } & ChangeItem)
	| ({ _tag: "Segment" } & SelectedSegmentItem)
	| ({ _tag: "Commit" } & SelectedCommitItem)
	| { _tag: "BaseCommit" };

export const selectedChangesSectionItem = (stackId: string | null): SelectedItem => ({
	_tag: "ChangesSection",
	stackId,
});

export const selectedChangeItem = (stackId: string | null, path: string): SelectedItem => ({
	_tag: "Change",
	stackId,
	path,
});

export const selectedSegmentItem = ({
	stackId,
	segmentIndex,
	branchRef,
	mode,
}: SelectedSegmentItem): SelectedItem => ({
	_tag: "Segment",
	stackId,
	segmentIndex,
	branchRef,
	mode,
});

export const selectedCommitItem = ({
	stackId,
	segmentIndex,
	branchRef,
	commitId,
	mode,
}: SelectedCommitItem): SelectedItem => ({
	_tag: "Commit",
	stackId,
	segmentIndex,
	branchRef,
	commitId,
	mode,
});

export const selectedBaseCommitItem: SelectedItem = {
	_tag: "BaseCommit",
};

export const asSelectedItem = (item: Item): SelectedItem =>
	Match.value(item).pipe(
		Match.tagsExhaustive({
			ChangesSection: (item) => selectedChangesSectionItem(item.stackId),
			Change: (item) => selectedChangeItem(item.stackId, item.path),
			Segment: (item) => selectedSegmentItem({ ...item, mode: { _tag: "Default" } }),
			Commit: (item) => selectedCommitItem({ ...item, mode: { _tag: "Default" } }),
			BaseCommit: () => selectedBaseCommitItem,
		}),
	);
