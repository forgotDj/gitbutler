import { Match } from "effect";
import {
	type BaseCommitItem,
	type ChangeItem,
	type ChangesSectionItem,
	type CommitItem,
	type Item,
	type SegmentItem,
} from "./-Item.ts";

export type SegmentMode = { _tag: "Default" } | { _tag: "Rename" };

export type SelectedSegmentItem = SegmentItem & { mode: SegmentMode };

export type CommitMode = { _tag: "Default" } | { _tag: "Details" } | { _tag: "Reword" };

export type SelectedCommitItem = CommitItem & { mode: CommitMode };

export type SelectedItem =
	| ({ _tag: "ChangesSection" } & ChangesSectionItem)
	| ({ _tag: "Change" } & ChangeItem)
	| ({ _tag: "Segment" } & SelectedSegmentItem)
	| ({ _tag: "Commit" } & SelectedCommitItem)
	| ({ _tag: "BaseCommit" } & BaseCommitItem);

export const selectedSegmentItem = ({
	stackId,
	segmentIndex,
	branchName,
	mode,
}: SelectedSegmentItem): SelectedItem => ({
	_tag: "Segment",
	stackId,
	segmentIndex,
	branchName,
	mode,
});

export const selectedCommitItem = ({
	stackId,
	segmentIndex,
	branchName,
	commitId,
	mode,
}: SelectedCommitItem): SelectedItem => ({
	_tag: "Commit",
	stackId,
	segmentIndex,
	branchName,
	commitId,
	mode,
});

export const asSelectedItem = (item: Item): SelectedItem =>
	Match.value(item).pipe(
		Match.tagsExhaustive({
			ChangesSection: (item) => item,
			Change: (item) => item,
			Segment: (item) => selectedSegmentItem({ ...item, mode: { _tag: "Default" } }),
			Commit: (item) => selectedCommitItem({ ...item, mode: { _tag: "Default" } }),
			BaseCommit: (item) => item,
		}),
	);
