import { buildStackEndpoints } from "$lib/stacks/stackEndpoints";
import { invalidatesList, ReduxTag } from "$lib/state/tags";
import { describe, expect, test } from "vitest";
import type { BackendEndpointBuilder } from "$lib/state/backendApi";

function createEndpointBuilder(): BackendEndpointBuilder {
	return {
		mutation: (definition) => definition,
		query: (definition) => definition,
	} as BackendEndpointBuilder;
}

describe("buildStackEndpoints", () => {
	test("maps uncommit to commit_undo with the new request shape", () => {
		const endpoints = buildStackEndpoints(createEndpointBuilder());
		const query = endpoints.uncommit.query;

		expect(endpoints.uncommit.extraOptions).toEqual({
			command: "commit_undo",
			actionName: "Uncommit",
		});
		expect(query).toBeDefined();
		expect(
			query?.({
				projectId: "project-1",
				stackId: "stack-1",
				commitId: "commit-1",
			}),
		).toEqual({
			projectId: "project-1",
			subjectCommitId: "commit-1",
			assignTo: "stack-1",
			dryRun: false,
		});
	});

	test("uses commit_move for generic commit moves", () => {
		const endpoints = buildStackEndpoints(createEndpointBuilder());
		const query = endpoints.commitMove.query;

		expect(endpoints.commitMove.extraOptions).toEqual({
			command: "commit_move",
			actionName: "Move Commit",
		});
		expect(query).toBeDefined();
		expect(
			query?.({
				projectId: "project-1",
				subjectCommitIds: ["commit-1"],
				relativeTo: {
					type: "commit",
					subject: "commit-2",
				},
				side: "below",
				dryRun: false,
			}),
		).toEqual({
			projectId: "project-1",
			subjectCommitIds: ["commit-1"],
			relativeTo: { type: "commit", subject: "commit-2" },
			side: "below",
			dryRun: false,
		});
	});

	test("invalidates branch and worktree state after commit moves", () => {
		const endpoints = buildStackEndpoints(createEndpointBuilder());

		expect(endpoints.commitMove.invalidatesTags).toEqual([
			invalidatesList(ReduxTag.HeadSha),
			invalidatesList(ReduxTag.WorktreeChanges),
			invalidatesList(ReduxTag.BranchChanges),
		]);
	});

	test("uses move_branch with normalized refs and dryRun disabled", () => {
		const endpoints = buildStackEndpoints(createEndpointBuilder());
		const query = endpoints.moveBranch.query;

		expect(endpoints.moveBranch.extraOptions).toEqual({
			command: "move_branch",
			actionName: "Move Branch",
		});
		expect(query).toBeDefined();
		expect(
			query?.({
				projectId: "project-1",
				subjectBranch: "refs/heads/feature/source",
				targetBranch: "refs/heads/feature/target",
			}),
		).toEqual({
			projectId: "project-1",
			subjectBranch: "refs/heads/feature/source",
			targetBranch: "refs/heads/feature/target",
			dryRun: false,
		});
	});
});
