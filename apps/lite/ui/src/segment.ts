import type { Stack } from "@gitbutler/but-sdk";

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
