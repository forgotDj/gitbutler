import {
	changesInWorktreeQueryOptions,
	commitDetailsWithLineStatsQueryOptions,
} from "#ui/api/queries.ts";
import { changeFileParent, commitFileParent, type FileParent } from "#ui/domain/FileParent.ts";
import { createDiffSpec } from "#ui/domain/DiffSpec.ts";
import { QueryClient } from "@tanstack/react-query";
import { CommitDetails, DiffSpec, WorktreeChanges } from "@gitbutler/but-sdk";
import { Match } from "effect";
import { Item } from "#ui/routes/project/$id/workspace/Item.ts";

/** @public */
export type CommitResolvedOperationSource = { commitId: string };
/** @public */
export type StackResolvedOperationSource = { stackId: string };
/** @public */
export type BranchResolvedOperationSource = { branchRef: Array<number> };
/** @public */
export type DiffSpecsResolvedOperationSource = {
	parent: FileParent;
	changes: Array<DiffSpec>;
};

/**
 * The source of an operation in a form that can be sent to the backend.
 */
export type ResolvedOperationSource =
	| { _tag: "BaseCommit" }
	| ({ _tag: "Commit" } & CommitResolvedOperationSource)
	| ({ _tag: "Stack" } & StackResolvedOperationSource)
	| ({ _tag: "Branch" } & BranchResolvedOperationSource)
	| ({ _tag: "DiffSpecs" } & DiffSpecsResolvedOperationSource);

/** @public */
export const baseCommitResolvedOperationSource: ResolvedOperationSource = {
	_tag: "BaseCommit",
};

/** @public */
export const commitResolvedOperationSource = ({
	commitId,
}: CommitResolvedOperationSource): ResolvedOperationSource => ({
	_tag: "Commit",
	commitId,
});

/** @public */
export const stackResolvedOperationSource = ({
	stackId,
}: StackResolvedOperationSource): ResolvedOperationSource => ({
	_tag: "Stack",
	stackId,
});

/** @public */
export const branchResolvedOperationSource = ({
	branchRef,
}: BranchResolvedOperationSource): ResolvedOperationSource => ({
	_tag: "Branch",
	branchRef,
});

/** @public */
export const diffSpecsResolvedOperationSource = ({
	parent,
	changes,
}: DiffSpecsResolvedOperationSource): ResolvedOperationSource => ({
	_tag: "DiffSpecs",
	parent,
	changes,
});

const resolvedOperationSourceFromItem = ({
	item,
	worktreeChanges,
	getCommitDetails,
}: {
	item: Item;
	worktreeChanges: WorktreeChanges | undefined;
	getCommitDetails: (commitId: string) => CommitDetails | undefined;
}) =>
	Match.value(item).pipe(
		Match.tagsExhaustive({
			BaseCommit: () => baseCommitResolvedOperationSource,
			Branch: ({ branchRef }) => branchResolvedOperationSource({ branchRef }),
			ChangeFile: ({ path }) => {
				const change = worktreeChanges?.changes.find((candidate) => candidate.path === path);
				if (!change) return null;

				return diffSpecsResolvedOperationSource({
					parent: changeFileParent,
					changes: [createDiffSpec(change, [])],
				});
			},
			ChangesSection: () => {
				if (!worktreeChanges) return null;

				const changes = worktreeChanges.changes.map((change) => createDiffSpec(change, []));
				return diffSpecsResolvedOperationSource({
					parent: changeFileParent,
					changes,
				});
			},
			Commit: ({ commitId }) => commitResolvedOperationSource({ commitId }),
			CommitFile: ({ commitId, path }) => {
				const change = getCommitDetails(commitId)?.changes.find(
					(candidate) => candidate.path === path,
				);
				if (!change) return null;

				return diffSpecsResolvedOperationSource({
					parent: commitFileParent({ commitId }),
					changes: [createDiffSpec(change, [])],
				});
			},
			Stack: ({ stackId }) => stackResolvedOperationSource({ stackId }),
			Hunk: ({ parent, path, hunkHeader }) => {
				const changes = Match.value(parent).pipe(
					Match.tagsExhaustive({
						Change: () => worktreeChanges?.changes,
						Commit: ({ commitId }) => getCommitDetails(commitId)?.changes,
					}),
				);
				if (!changes) return null;

				const change = changes.find((candidate) => candidate.path === path);
				if (!change) return null;

				return diffSpecsResolvedOperationSource({
					parent,
					changes: [createDiffSpec(change, [hunkHeader])],
				});
			},
		}),
	);

export const resolveOperationSource = ({
	operationSource,
	queryClient,
	projectId,
}: {
	operationSource: Item;
	queryClient: QueryClient;
	projectId: string;
}) =>
	resolvedOperationSourceFromItem({
		item: operationSource,
		worktreeChanges: queryClient.getQueryData(changesInWorktreeQueryOptions(projectId).queryKey),
		getCommitDetails: (commitId) =>
			queryClient.getQueryData(
				commitDetailsWithLineStatsQueryOptions({ projectId, commitId }).queryKey,
			),
	});
