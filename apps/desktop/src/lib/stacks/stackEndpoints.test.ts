import { buildStackEndpoints } from "$lib/stacks/stackEndpoints";
import { describe, expect, test } from "vitest";
import type { BackendEndpointBuilder } from "$lib/state/backendApi";
import type { CommitMoveResult } from "@gitbutler/but-sdk";

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

	test("maps moveCommit to commit_move at the top of the destination stack", () => {
		const endpoints = buildStackEndpoints(createEndpointBuilder());
		const query = endpoints.moveCommit.query;

		expect(endpoints.moveCommit.extraOptions).toEqual({
			command: "commit_move",
			actionName: "Move Commit",
		});
		expect(query).toBeDefined();
		expect(
			query?.({
				projectId: "project-1",
				sourceStackId: "stack-1",
				commitId: "commit-1",
				targetStackId: "stack-2",
				targetBranchName: "feature/target",
			}),
		).toEqual({
			projectId: "project-1",
			subjectCommitIds: ["commit-1"],
			relativeTo: {
				type: "reference",
				subject: "refs/heads/feature/target",
			},
			side: "below",
			dryRun: false,
		});
	});

	test("keeps moveCommit response compatible with the legacy drag/drop caller", () => {
		const endpoints = buildStackEndpoints(createEndpointBuilder());

		const response = {
			workspace: {
				replacedCommits: {},
			},
		} as unknown as CommitMoveResult;

		expect(
			endpoints.moveCommit.transformResponse?.(response, undefined, {
				projectId: "project-1",
				sourceStackId: "stack-1",
				commitId: "commit-1",
				targetStackId: "stack-2",
				targetBranchName: "feature/target",
			}),
		).toBeNull();
	});
});
