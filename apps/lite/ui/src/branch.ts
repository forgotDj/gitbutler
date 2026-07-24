import type { BranchDetailsParams } from "#electron/ipc.ts";
import type { ListedBranch, ListedStack } from "@gitbutler/but-sdk";

/**
 * Whether the branch holds no commits of its own — it was just created, or
 * everything it held is now in the branch below it or in the target.
 *
 * This is `commitCount`, the branch's own contribution, and not
 * `commitsAheadOfTarget`, which for a stacked branch also counts the commits
 * of the branches below it. A `null` count (shallow clone, clipped traversal)
 * is unknown rather than empty.
 */
export const branchIsEmpty = (branch: ListedBranch): boolean => branch.commitCount === 0;

/**
 * The stacks from the branch listing that are not applied to the workspace,
 * keeping the listing's most-recent-first order. Unless `showEmpty`, branches
 * holding no commits are dropped, along with stacks left empty by that.
 */
export const unappliedStacks = (
	stacks: Array<ListedStack>,
	{ showEmpty }: { showEmpty: boolean },
): Array<ListedStack> =>
	stacks
		.filter((stack) => stack.status === "unapplied" || stack.status === "standalone")
		.map((stack) =>
			showEmpty
				? stack
				: { ...stack, branches: stack.branches.filter((branch) => !branchIsEmpty(branch)) },
		)
		.filter((stack) => stack.branches.length > 0);

/**
 * Splits a full ref name into the branch name and remote as expected by the
 * branch details API.
 */
// https://linear.app/gitbutler/issue/GB-1226/unify-branch-identifiers
export const branchDetailsSelector = (
	refName: string,
): Pick<BranchDetailsParams, "branchName" | "remote"> => {
	const remoteMatch = /^refs\/remotes\/([^/]+)\/(.+)$/.exec(refName);
	const remote = remoteMatch?.[1];
	const branchName = remoteMatch?.[2];

	return remote !== undefined && branchName !== undefined
		? { branchName, remote }
		: { branchName: refName.replace(/^refs\/heads\//, ""), remote: null };
};
