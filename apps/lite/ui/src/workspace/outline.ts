import { headInfoQueryOptions } from "#ui/api/queries.ts";
import { Segment, type RefInfo } from "@gitbutler/but-sdk";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
	branchOperand,
	baseCommitOperand,
	changesSectionOperand,
	type Operand,
	commitOperand,
	stackOperand,
} from "#ui/operands.ts";
import { Array } from "effect";

export type WorkspaceSection = {
	section: Operand | null;
	children: Array<Operand>;
};

export type WorkspaceOutline = Array.NonEmptyArray<WorkspaceSection>;

const buildWorkspaceOutline = (headInfo: RefInfo): WorkspaceOutline => {
	const changesSection: WorkspaceSection = {
		section: changesSectionOperand,
		children: [],
	};

	const segmentChildren = (stackId: string, segment: Segment): Array<Operand> =>
		segment.commits.map((commit) => commitOperand({ stackId, commitId: commit.id }));

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

export const useWorkspaceOutline = ({ projectId }: { projectId: string }) => {
	const { data: headInfo } = useSuspenseQuery(headInfoQueryOptions(projectId));

	return buildWorkspaceOutline(headInfo);
};
