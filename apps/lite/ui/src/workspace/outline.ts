import {
	changesInWorktreeQueryOptions,
	commitDetailsWithLineStatsQueryOptions,
	headInfoQueryOptions,
} from "#ui/api/queries.ts";
import { CommitDetails, Segment, type RefInfo, type TreeChange } from "@gitbutler/but-sdk";
import { useQueries, useSuspenseQuery } from "@tanstack/react-query";
import { type NonEmptyArray } from "effect/Array";
import {
	branchOperand,
	baseCommitOperand,
	changesSectionOperand,
	changesFileParent,
	type Operand,
	commitOperand,
	commitFileParent,
	fileOperand,
	stackOperand,
} from "#ui/operands.ts";

export type WorkspaceSection = {
	section: Operand | null;
	children: Array<Operand>;
};

export type WorkspaceOutline = NonEmptyArray<WorkspaceSection>;

type BuildWorkspaceOutlineArgs = {
	headInfo: RefInfo;
	changes: Array<TreeChange>;
	expandedCommitDetails?: CommitDetails;
};

const buildWorkspaceOutline = ({
	headInfo,
	changes,
	expandedCommitDetails,
}: BuildWorkspaceOutlineArgs): WorkspaceOutline => {
	const changesSection: WorkspaceSection = {
		section: changesSectionOperand,
		children: changes.map((change) =>
			fileOperand({ parent: changesFileParent, path: change.path }),
		),
	};

	const segmentChildren = (stackId: string, segment: Segment): Array<Operand> =>
		segment.commits.flatMap(
			(commit): Array<Operand> => [
				commitOperand({ stackId, commitId: commit.id }),
				...(commit.id === expandedCommitDetails?.commit.id
					? expandedCommitDetails.changes.map((change) =>
							fileOperand({
								parent: commitFileParent({ stackId, commitId: commit.id }),
								path: change.path,
							}),
						)
					: []),
			],
		);

	const segmentSection = (stackId: string, segment: Segment): WorkspaceSection | null => {
		const children = segmentChildren(stackId, segment);
		const branchRef = segment.refName?.fullNameBytes;
		if (!branchRef && children.length === 0) return null;

		return {
			section: branchRef ? branchOperand({ stackId, branchRef }) : null,
			children,
		};
	};

	const baseCommitSection: WorkspaceSection = {
		section: baseCommitOperand,
		children: [],
	};

	return [
		changesSection,

		...headInfo.stacks.flatMap((stack) => {
			// oxlint-disable-next-line typescript/no-non-null-assertion -- [ref:stack-id-required]
			const stackId = stack.id!;
			const stackOperandSection: WorkspaceSection = {
				section: stackOperand({ stackId }),
				children: [],
			};
			return [
				stackOperandSection,
				...stack.segments.flatMap((segment) => {
					const section = segmentSection(stackId, segment);
					return section ? [section] : [];
				}),
			];
		}),

		baseCommitSection,
	];
};

export const useWorkspaceOutline = ({
	projectId,
	expandedCommitId,
}: {
	projectId: string;
	expandedCommitId: string | null;
}) => {
	const { data: headInfo } = useSuspenseQuery(headInfoQueryOptions(projectId));
	const { data: worktreeChanges } = useSuspenseQuery(changesInWorktreeQueryOptions(projectId));
	const commitDetailsQueries = useQueries({
		queries: (expandedCommitId !== null ? [expandedCommitId] : []).map((commitId) =>
			commitDetailsWithLineStatsQueryOptions({ projectId, commitId }),
		),
	});

	return buildWorkspaceOutline({
		headInfo,
		changes: worktreeChanges.changes,
		expandedCommitDetails: commitDetailsQueries[0]?.data,
	});
};
