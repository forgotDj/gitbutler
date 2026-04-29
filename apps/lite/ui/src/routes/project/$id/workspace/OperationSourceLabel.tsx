import { findCommit, findSegmentByBranchRef } from "#ui/api/ref-info.ts";
import { CommitLabel } from "#ui/routes/project/$id/CommitLabel.tsx";
import { shortCommitId } from "#ui/commit.ts";
import { Match } from "effect";
import { type FC } from "react";
import { type RefInfo } from "@gitbutler/but-sdk";
import { Operand } from "#ui/operands.ts";
import { formatHunkHeader } from "#ui/hunk.ts";

const assert = <T,>(t: T | null | undefined): T => {
	if (t == null) throw new Error("Expected value to be non-null and defined");
	return t;
};

export const OperationSourceLabel: FC<{
	source: Operand;
	headInfo: RefInfo;
}> = ({ source, headInfo }) =>
	Match.value(source).pipe(
		Match.tagsExhaustive({
			BaseCommit: () => "Base commit",
			Branch: ({ branchRef }) => {
				const segment = findSegmentByBranchRef({ headInfo, branchRef });
				return assert(segment?.refName).displayName;
			},
			File: ({ path }) => path,
			ChangesSection: () => "Changes",
			Commit: ({ commitId }) => {
				const commit = findCommit({ headInfo, commitId });
				return commit ? <CommitLabel commit={commit} /> : shortCommitId(commitId);
			},
			Stack: () => "Stack",
			Hunk: ({ hunkHeader }) => `Hunk ${formatHunkHeader(hunkHeader)}`,
		}),
	);
