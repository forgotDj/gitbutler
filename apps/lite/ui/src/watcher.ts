import { changesInWorktreeQueryOptions, type QueryKey } from "#ui/api/queries.ts";
import { WatcherEvent } from "@gitbutler/but-sdk";
import { QueryClient } from "@tanstack/react-query";

export const handleWatcher = (
	event: WatcherEvent,
	projectId: string,
	client: QueryClient,
): void => {
	switch (event.payload.type) {
		case "gitActivity":
		case "workspaceActivity": {
			void client.invalidateQueries({ queryKey: ["absorptionPlan" satisfies QueryKey, projectId] });
			void client.invalidateQueries({ queryKey: ["branches" satisfies QueryKey, projectId] });
			void client.invalidateQueries({ queryKey: ["branchDetails" satisfies QueryKey, projectId] });
			void client.invalidateQueries({ queryKey: ["branchDiff" satisfies QueryKey, projectId] });
			void client.invalidateQueries({
				queryKey: ["changesInWorktree" satisfies QueryKey, projectId],
			});
			void client.invalidateQueries({
				queryKey: ["commitDetailsWithLineStats" satisfies QueryKey, projectId],
			});
			void client.invalidateQueries({ queryKey: ["dryRun" satisfies QueryKey, projectId] });
			void client.invalidateQueries({ queryKey: ["headInfo" satisfies QueryKey, projectId] });
			void client.invalidateQueries({
				queryKey: ["treeChangeDiffs" satisfies QueryKey, projectId],
			});
			break;
		}
		case "worktreeChanges":
			const workspaceChanges = event.payload.subject.changes;
			client.setQueryData(
				changesInWorktreeQueryOptions(projectId).queryKey,
				() => workspaceChanges,
			);
			void client.invalidateQueries({ queryKey: ["absorptionPlan" satisfies QueryKey, projectId] });
			void client.invalidateQueries({ queryKey: ["dryRun" satisfies QueryKey, projectId] });
			void client.invalidateQueries({
				queryKey: ["treeChangeDiffs" satisfies QueryKey, projectId],
			});
			break;
	}
};
