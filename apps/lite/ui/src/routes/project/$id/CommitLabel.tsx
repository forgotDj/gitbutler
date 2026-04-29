import { commitTitle } from "#ui/commit.ts";
import { type Commit } from "@gitbutler/but-sdk";

export const CommitLabel = ({ commit }: { commit: Commit }) => (
	<>
		{commitTitle(commit.message)}
		{commit.hasConflicts && " ⚠️"}
	</>
);
