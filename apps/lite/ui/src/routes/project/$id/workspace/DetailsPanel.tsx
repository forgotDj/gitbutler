import {
	branchDetailsQueryOptions,
	branchDiffQueryOptions,
	changesInWorktreeQueryOptions,
	commitDetailsWithLineStatsQueryOptions,
	treeChangeDiffsQueryOptions,
} from "#ui/api/queries.ts";
import { decodeRefName } from "#ui/api/ref-name.ts";
import { formatHunkHeader } from "#ui/hunk.ts";
import {
	branchFileParent,
	changesFileParent,
	commitFileParent,
	fileOperand,
	hunkOperand,
	type FileParent,
	type Operand,
} from "#ui/operands.ts";
import { Panel as PanelType, useFocusedProjectPanel } from "#ui/panels.ts";
import { projectActions, selectProjectSelection } from "#ui/projects/state.ts";
import { CommitLabel } from "#ui/routes/project/$id/CommitLabel.tsx";
import { OperationSourceC } from "#ui/routes/project/$id/workspace/OperationSourceC.tsx";
import { useAppDispatch, useAppSelector } from "#ui/store.ts";
import { classes } from "#ui/ui/classes.ts";
import { DependencyIcon } from "#ui/ui/icons.tsx";
import {
	DiffHunk,
	HunkDependencies,
	HunkHeader,
	TreeChange,
	UnifiedPatch,
} from "@gitbutler/but-sdk";
import { PatchDiff, Virtualizer } from "@pierre/diffs/react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { Array, Match, pipe } from "effect";
import { isNonEmptyArray, NonEmptyArray } from "effect/Array";
import { FC, Ref, Suspense, useDeferredValue } from "react";
import { Panel } from "react-resizable-panels";
import { DependencyIndicatorButton } from "./OutlinePanel.tsx";
import styles from "./DetailsPanel.module.css";

type HunkDependencyDiff = HunkDependencies["diffs"][number];

const lineEndingForDiff = (diff: string): string => (diff.includes("\r\n") ? "\r\n" : "\n");

const patchHeaderForChange = (change: TreeChange, lineEnding: string): string =>
	Match.value(change.status).pipe(
		Match.when(
			{ type: "Addition" },
			() => `--- /dev/null${lineEnding}+++ ${change.path}${lineEnding}`,
		),
		Match.when(
			{ type: "Deletion" },
			() => `--- ${change.path}${lineEnding}+++ /dev/null${lineEnding}`,
		),
		Match.when(
			{ type: "Modification" },
			() => `--- ${change.path}${lineEnding}+++ ${change.path}${lineEnding}`,
		),
		Match.when(
			{ type: "Rename" },
			({ subject }) => `--- ${subject.previousPath}${lineEnding}+++ ${change.path}${lineEnding}`,
		),
		Match.exhaustive,
	);

const HunkDiff: FC<{
	change: TreeChange;
	diff: string;
}> = ({ change, diff }) => (
	<PatchDiff
		patch={`${patchHeaderForChange(change, lineEndingForDiff(diff))}${diff}`}
		options={{
			diffStyle: "unified",
			themeType: "system",
			disableFileHeader: true,
			preferredHighlighter: "shiki-wasm",
		}}
	/>
);

const hunkKey = (hunk: HunkHeader): string =>
	`${hunk.oldStart}:${hunk.oldLines}:${hunk.newStart}:${hunk.newLines}`;

const hunkContainsHunk = (a: HunkHeader, b: HunkHeader): boolean =>
	a.oldStart <= b.oldStart &&
	a.oldStart + a.oldLines - 1 >= b.oldStart + b.oldLines - 1 &&
	a.newStart <= b.newStart &&
	a.newStart + a.newLines - 1 >= b.newStart + b.newLines - 1;

const getHunkDependencyDiffsByPath = (
	hunkDependencyDiffs: Array<HunkDependencyDiff>,
): Map<string, Array<HunkDependencyDiff>> => {
	const byPath = new Map<string, Array<HunkDependencyDiff>>();

	for (const hunkDependencyDiff of hunkDependencyDiffs) {
		const [path] = hunkDependencyDiff;
		const pathDependencyDiffs = byPath.get(path);
		if (pathDependencyDiffs) pathDependencyDiffs.push(hunkDependencyDiff);
		else byPath.set(path, [hunkDependencyDiff]);
	}

	return byPath;
};

const getDependencyCommitIds = ({
	hunk,
	hunkDependencyDiffs,
}: {
	hunk?: DiffHunk;
	hunkDependencyDiffs: Array<HunkDependencyDiff>;
}): NonEmptyArray<string> | undefined => {
	const commitIds = new Set<string>();

	for (const [, dependencyHunk, locks] of hunkDependencyDiffs) {
		if (hunk && !hunkContainsHunk(hunk, dependencyHunk)) continue;
		for (const dependency of locks) commitIds.add(dependency.commitId);
	}

	const dependencyCommitIds = globalThis.Array.from(commitIds);
	return isNonEmptyArray(dependencyCommitIds) ? dependencyCommitIds : undefined;
};

const Hunk: FC<{
	isResultOfBinaryToTextConversion: boolean;
	projectId: string;
	fileParent: FileParent;
	change: TreeChange;
	hunk: DiffHunk;
	hunkDependencyDiffs?: Array<HunkDependencyDiff>;
}> = ({
	isResultOfBinaryToTextConversion,
	projectId,
	fileParent,
	change,
	hunk,
	hunkDependencyDiffs,
}) => {
	const dependencyCommitIds =
		fileParent._tag === "Changes" && hunkDependencyDiffs
			? getDependencyCommitIds({ hunk, hunkDependencyDiffs })
			: undefined;

	const operand = hunkOperand({
		parent: fileParent,
		path: change.path,
		hunkHeader: hunk,
		isResultOfBinaryToTextConversion,
	});

	return (
		<div>
			<OperationSourceC projectId={projectId} source={operand}>
				<div className={styles.hunkHeaderRow}>
					{dependencyCommitIds && (
						<DependencyIndicatorButton projectId={projectId} commitIds={dependencyCommitIds}>
							<DependencyIcon />
						</DependencyIndicatorButton>
					)}
					<div className={styles.hunkHeader}>{formatHunkHeader(hunk)}</div>
				</div>
			</OperationSourceC>
			<HunkDiff change={change} diff={hunk.diff} />
		</div>
	);
};

const FileDiff: FC<{
	projectId: string;
	change: TreeChange;
	fileParent: FileParent;
	hunkDependencyDiffs?: Array<HunkDependencyDiff>;
	diff: UnifiedPatch | null;
}> = ({ projectId, change, fileParent, hunkDependencyDiffs, diff }) =>
	Match.value(diff).pipe(
		Match.when(null, () => <div>No diff available for this file.</div>),
		Match.when({ type: "Binary" }, () => <div>Binary file (diff not available).</div>),
		Match.when({ type: "TooLarge" }, ({ subject }) => (
			<div>Diff too large ({subject.sizeInBytes} bytes).</div>
		)),
		Match.when({ type: "Patch" }, (patch) => {
			const { hunks } = patch.subject;
			if (hunks.length === 0) return <div>No hunks.</div>;

			return (
				<ul>
					{hunks.map((hunk) => (
						<li key={hunkKey(hunk)}>
							<Hunk
								isResultOfBinaryToTextConversion={patch.subject.isResultOfBinaryToTextConversion}
								projectId={projectId}
								fileParent={fileParent}
								change={change}
								hunk={hunk}
								hunkDependencyDiffs={hunkDependencyDiffs}
							/>
						</li>
					))}
				</ul>
			);
		}),
		Match.exhaustive,
	);

const ChangesFileDiffList: FC<{
	changes: Array<TreeChange>;
	projectId: string;
	fileParent: FileParent;
	hunkDependencyDiffsByPath?: Map<string, Array<HunkDependencyDiff>>;
}> = ({ changes, projectId, fileParent, hunkDependencyDiffsByPath }) => {
	const treeChangeDiffs = useSuspenseQueries({
		queries: changes.map((change) => treeChangeDiffsQueryOptions({ projectId, change })),
	}).map((result) => result.data);
	const changesWithDiffs = pipe(changes, Array.zip(treeChangeDiffs));

	return changesWithDiffs.length === 0 ? (
		<div>No file changes.</div>
	) : (
		<ul>
			{changesWithDiffs.map(([change, diff]) => {
				const source = fileOperand({ parent: fileParent, path: change.path });

				return (
					<li key={change.path}>
						<OperationSourceC projectId={projectId} source={source}>
							<h4>{change.path}</h4>
						</OperationSourceC>
						<FileDiff
							projectId={projectId}
							change={change}
							fileParent={fileParent}
							hunkDependencyDiffs={hunkDependencyDiffsByPath?.get(change.path)}
							diff={diff}
						/>
					</li>
				);
			})}
		</ul>
	);
};

const ChangesDetails: FC<{
	projectId: string;
	selectedPath?: string;
}> = ({ projectId, selectedPath }) => {
	const { data: worktreeChanges } = useSuspenseQuery(changesInWorktreeQueryOptions(projectId));
	const hunkDependencyDiffsByPath = getHunkDependencyDiffsByPath(
		worktreeChanges.dependencies?.diffs ?? [],
	);
	const selectedChange =
		selectedPath !== undefined
			? worktreeChanges.changes.find((candidate) => candidate.path === selectedPath)
			: undefined;
	const changes = selectedChange ? [selectedChange] : worktreeChanges.changes;

	return (
		<div>
			<ChangesFileDiffList
				changes={changes}
				fileParent={changesFileParent}
				hunkDependencyDiffsByPath={hunkDependencyDiffsByPath}
				projectId={projectId}
			/>
		</div>
	);
};

const CommitDetails: FC<{
	projectId: string;
	commitId: string;
	selectedPath?: string | null;
	stackId: string;
}> = ({ projectId, commitId, selectedPath, stackId }) => {
	const { data: commitDetails } = useSuspenseQuery(
		commitDetailsWithLineStatsQueryOptions({ projectId, commitId }),
	);
	const selectedChange =
		selectedPath !== undefined
			? commitDetails.changes.find((candidate) => candidate.path === selectedPath)
			: undefined;
	const changes = selectedChange ? [selectedChange] : commitDetails.changes;
	const fileParent = commitFileParent({ stackId, commitId });

	return (
		<div>
			{selectedPath === undefined && (
				<>
					<h3>
						<CommitLabel commit={commitDetails.commit} />
					</h3>
					{commitDetails.commit.message.includes("\n") && (
						<p className={styles.commitMessageBody}>
							{commitDetails.commit.message
								.slice(commitDetails.commit.message.indexOf("\n") + 1)
								.trim()}
						</p>
					)}
				</>
			)}
			<ChangesFileDiffList changes={changes} fileParent={fileParent} projectId={projectId} />
		</div>
	);
};

const BranchDetails: FC<{
	projectId: string;
	branchRef: Array<number>;
	selectedPath?: string;
	stackId: string;
}> = ({ projectId, branchRef, selectedPath, stackId }) => {
	const decodedBranchRef = decodeRefName(branchRef);
	const [{ data: branchDetails }, { data: branchDiff }] = useSuspenseQueries({
		queries: [
			branchDetailsQueryOptions({
				projectId,
				// https://linear.app/gitbutler/issue/GB-1226/unify-branch-identifiers
				branchName: decodedBranchRef.replace(/^refs\/heads\//, ""),
				remote: null,
			}),
			branchDiffQueryOptions({ projectId, branch: decodedBranchRef }),
		],
	});

	const selectedChange =
		selectedPath !== undefined
			? branchDiff.changes.find((candidate) => candidate.path === selectedPath)
			: undefined;
	const changes = selectedChange ? [selectedChange] : branchDiff.changes;

	return (
		<div>
			<h3>{branchDetails.name}</h3>
			{branchDetails.prNumber != null && <p>PR #{branchDetails.prNumber}</p>}
			<ChangesFileDiffList
				changes={changes}
				projectId={projectId}
				fileParent={branchFileParent({ stackId, branchRef })}
			/>
		</div>
	);
};

const Details: FC<{
	projectId: string;
	selection: Operand;
}> = ({ projectId, selection }) =>
	Match.value(selection).pipe(
		Match.tagsExhaustive({
			Stack: () => null,
			Branch: ({ branchRef, stackId }) => (
				<BranchDetails projectId={projectId} branchRef={branchRef} stackId={stackId} />
			),
			ChangesSection: () => <ChangesDetails projectId={projectId} />,
			File: ({ parent, path }) =>
				Match.value(parent).pipe(
					Match.tagsExhaustive({
						Changes: () => <ChangesDetails projectId={projectId} selectedPath={path} />,
						Branch: ({ branchRef, stackId }) => (
							<BranchDetails
								projectId={projectId}
								branchRef={branchRef}
								selectedPath={path}
								stackId={stackId}
							/>
						),
						Commit: ({ commitId, stackId }) => (
							<CommitDetails
								projectId={projectId}
								commitId={commitId}
								stackId={stackId}
								selectedPath={path}
							/>
						),
					}),
				),
			Commit: ({ commitId, stackId }) => (
				<CommitDetails projectId={projectId} commitId={commitId} stackId={stackId} />
			),
			BaseCommit: () => null,
			Hunk: () => null,
		}),
	);

export const DetailsPanel: FC<{
	className?: string;
	elementRef: Ref<HTMLDivElement | null>;
	focusPanel: (panel: PanelType) => void;
}> = ({ className, elementRef, focusPanel }) => {
	const dispatch = useAppDispatch();
	const { id: projectId } = useParams({ from: "/project/$id/workspace" });
	const urgentSelection = useAppSelector((state) => selectProjectSelection(state, projectId));
	const selection = useDeferredValue(urgentSelection);
	const focusedPanel = useFocusedProjectPanel(projectId);

	useHotkey(
		"Escape",
		() => {
			dispatch(projectActions.hidePanel({ projectId, panel: "details" }));
			focusPanel("outline");
		},
		{
			conflictBehavior: "allow",
			enabled: focusedPanel === "details",
			meta: { group: "Details", name: "Close" },
		},
	);

	return (
		<Panel
			id={"details" satisfies PanelType}
			minSize={300}
			defaultSize="70%"
			elementRef={elementRef}
			tabIndex={0}
			style={{ opacity: urgentSelection !== selection ? 0.5 : 1 }}
		>
			<Virtualizer className={classes(className, styles.detailsVirtualizer)}>
				<Suspense fallback={<div>Loading details...</div>}>
					<Details projectId={projectId} selection={selection} />
				</Suspense>
			</Virtualizer>
		</Panel>
	);
};
