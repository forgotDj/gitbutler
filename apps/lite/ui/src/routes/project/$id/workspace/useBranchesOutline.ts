import { branchDetailsQueryOptions, branchListQueryOptions } from "#ui/api/queries.ts";
import { encodeBytes } from "#ui/api/bytes.ts";
import { branchDetailsSelector, branchIsEmpty, unappliedStacks } from "#ui/branch.ts";
import { branchOperand, commitOperand, operandIdentityKey, type Operand } from "#ui/operands.ts";
import { projectSlice } from "#ui/projects/state.ts";
import { useAppSelector } from "#ui/store.ts";
import { buildIndexByKey, type NavigationIndex } from "#ui/workspace/navigation-index.ts";
import type { ListedStack } from "@gitbutler/but-sdk";
import { useQueries, useQuery } from "@tanstack/react-query";

export type BranchesOutline = {
	stacks: Array<ListedStack>;
	navigationIndex: NavigationIndex<Operand>;
};

const emptyOutline: BranchesOutline = {
	stacks: [],
	navigationIndex: { items: [], indexByKey: new Map() },
};

/**
 * The branches tab's visible stacks and the matching navigation index.
 *
 * This is the single source of truth for what the tab shows: both the list
 * rendering and the selection resolution in the workspace page consume it, so
 * filtering and fold state cannot drift between the two.
 */
export const useBranchesOutline = (projectId: string): BranchesOutline => {
	const active = useAppSelector(
		(state) => projectSlice.selectors.selectOutlineTab(state, projectId) === "branches",
	);
	const showEmpty = useAppSelector((state) =>
		projectSlice.selectors.selectShowEmptyBranches(state, projectId),
	);
	const unfoldedBranches = useAppSelector((state) =>
		projectSlice.selectors.selectUnfoldedBranches(state, projectId),
	);

	const unfoldedBranchRefs = active ? Object.keys(unfoldedBranches) : [];
	const commitIdsByRef = useQueries({
		queries: unfoldedBranchRefs.map((refName) =>
			branchDetailsQueryOptions({ projectId, ...branchDetailsSelector(refName) }),
		),
		combine: (results) =>
			new Map<string, Array<string>>(
				unfoldedBranchRefs.map((refName, index) => [
					refName,
					results[index]?.data?.commits.map((commit) => commit.id) ?? [],
				]),
			),
	});

	// The whole derivation lives in `select` so its result keeps a stable
	// identity: react-query caches it on the query data and the `select`
	// reference, and React Compiler memoizes this inline closure by its captured
	// inputs — so the closure, and thus the cached result, only changes when an
	// input like `search` or `showEmpty` does. Deriving in render instead would
	// rebuild the navigation index every pass and re-render every row that reads
	// it through context.
	const { data: outline = emptyOutline } = useQuery({
		...branchListQueryOptions(projectId),
		enabled: active,
		select: (listedStacks): BranchesOutline => {
			const stacks = unappliedStacks(listedStacks, { showEmpty });
			const items = stacks.flatMap((stack) =>
				stack.branches.flatMap(
					(branch): Array<Operand> => [
						branchOperand({ branchRef: encodeBytes(branch.refName.full) }),
						// Matches the fold affordance in BranchesList: a branch with no
						// commits of its own cannot be unfolded. branchDetails returns
						// commits down to the target, so take only this branch's own
						// contribution (`commitCount`, tip-first) to avoid duplicating a
						// lower branch's commits under both rows.
						...(unfoldedBranches[branch.refName.full] && !branchIsEmpty(branch)
							? (commitIdsByRef.get(branch.refName.full) ?? [])
									.slice(0, branch.commitCount ?? undefined)
									.map((commitId) => commitOperand({ commitId }))
							: []),
					],
				),
			);

			return {
				stacks,
				navigationIndex: { items, indexByKey: buildIndexByKey(items, operandIdentityKey) },
			};
		},
	});

	return outline;
};
