import type { PushStatus, Segment, Stack } from "@gitbutler/but-sdk";
import { initNonEmpty, scanRight } from "effect/Array";

export const canRemoveBranchReference = (stack: Stack, segmentIndex: number): boolean => {
	const segment = stack.segments[segmentIndex];
	if (!segment?.refName) return false;
	if (segment.commits.length === 0) return true;

	// We disallow deleting the top (non-empty) branch reference inside a stack of multiple branches
	// because (1) the backend misbehaves (2) and we want to discourage users from creating branchless
	// segments. See discussion in https://github.com/gitbutlerapp/gitbutler/pull/14059.
	const topBranchIndex = stack.segments.findIndex((segment) => segment.refName !== null);
	return segmentIndex !== topBranchIndex;
};

export type DownstackPushStatus = {
	anyRequiresPush: boolean;
	anyPushRequiresForce: boolean;
	anyHasConflicts: boolean;
	downstackBranches: number;
};

const downstackPushStatus: DownstackPushStatus = {
	anyRequiresPush: false,
	anyPushRequiresForce: false,
	anyHasConflicts: false,
	downstackBranches: 0,
};

const pushStatusRequiresPush = (pushStatus: PushStatus): boolean =>
	pushStatus === "unpushedCommits" ||
	pushStatus === "unpushedCommitsRequiringForce" ||
	pushStatus === "completelyUnpushed";

const addSegmentToDownstackPushStatus = (
	state: DownstackPushStatus,
	segment: Segment,
): DownstackPushStatus => ({
	anyRequiresPush: state.anyRequiresPush || pushStatusRequiresPush(segment.pushStatus),
	anyPushRequiresForce:
		state.anyPushRequiresForce || segment.pushStatus === "unpushedCommitsRequiringForce",
	anyHasConflicts: state.anyHasConflicts || segment.commits.some((commit) => commit.hasConflicts),
	downstackBranches: segment.refName ? state.downstackBranches + 1 : state.downstackBranches,
});

export const downstackPushStatusDisabled = (dps: DownstackPushStatus): boolean =>
	!dps.anyRequiresPush || dps.anyHasConflicts;

export const downstackPushStatusFromSegments = (segments: Array<Segment>): DownstackPushStatus =>
	segments.reduce(addSegmentToDownstackPushStatus, downstackPushStatus);

export const downstackPushStatusesFromSegments = (
	segments: Array<Segment>,
): Array<DownstackPushStatus> =>
	initNonEmpty(scanRight(segments, downstackPushStatus, addSegmentToDownstackPushStatus));
