import { BranchIdentity, BranchListing } from "@gitbutler/but-sdk";

/** @public */
export type BranchSelection = { branchName: BranchIdentity };
/** @public */
export type DetailsCommitMode = { path?: string };
/** @public */
export type CommitMode = { _tag: "Summary" } | ({ _tag: "Details" } & DetailsCommitMode);
/** @public */
export type CommitSelection = BranchSelection & { commitId: string; mode: CommitMode };

/** @public */
export const summaryCommitMode: CommitMode = {
	_tag: "Summary",
};

/** @public */
export const detailsCommitMode = ({ path }: DetailsCommitMode): CommitMode => ({
	_tag: "Details",
	path,
});

export type Selection =
	| ({ _tag: "Branch" } & BranchSelection)
	| ({ _tag: "Commit" } & CommitSelection);

/** @public */
export const branchSelection = ({ branchName }: BranchSelection): Selection => ({
	_tag: "Branch",
	branchName,
});

/** @public */
export const commitSelection = ({ branchName, commitId, mode }: CommitSelection): Selection => ({
	_tag: "Commit",
	branchName,
	commitId,
	mode,
});

export const isValidBranchSelection = (
	selection: Selection,
	branches: Array<BranchListing>,
): boolean => {
	const branch = branches.find((branch) => branch.name === selection.branchName);
	if (!branch) return false;
	return true;
};

export const getDefaultSelection = (branches: Array<BranchListing>): Selection | null => {
	const firstBranch = branches[0];
	if (!firstBranch) return null;
	return branchSelection({ branchName: firstBranch.name });
};
