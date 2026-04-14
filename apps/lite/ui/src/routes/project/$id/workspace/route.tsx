import { PatchDiff } from "@pierre/diffs/react";
import {
	commitDiscardMutationOptions,
	commitInsertBlankMutationOptions,
	commitRewordMutationOptions,
	updateBranchNameMutationOptions,
	unapplyStackMutationOptions,
} from "#ui/api/mutations.ts";
import {
	branchDetailsQueryOptions,
	branchDiffQueryOptions,
	changesInWorktreeQueryOptions,
	commitDetailsWithLineStatsQueryOptions,
	headInfoQueryOptions,
	listProjectsQueryOptions,
	treeChangeDiffsQueryOptions,
} from "#ui/api/queries.ts";
import { classes } from "#ui/classes.ts";
import {
	DependencyIcon,
	ExpandCollapseIcon,
	MenuTriggerIcon,
	PushIcon,
} from "#ui/components/icons.tsx";
import {
	changesSectionFileParent,
	commitFileParent,
	type FileParent,
} from "#ui/domain/FileParent.ts";
import { getBranchNameByCommitId, getCommonBaseCommitId } from "#ui/domain/RefInfo.ts";
import { ProjectPreviewLayout } from "#ui/routes/project/$id/ProjectPreviewLayout.tsx";
import { getFocus } from "#ui/routes/project/$id/state/layout.ts";
import {
	projectActions,
	selectProjectExpandedCommitId,
	selectProjectHighlightedCommitIds,
	selectProjectLayoutState,
	selectProjectSelectedHunk,
	selectProjectSelectedItem,
	selectProjectWorkspaceModeState,
} from "#ui/routes/project/$id/state/projectSlice.ts";
import { normalizeSelectedHunk } from "#ui/routes/project/$id/state/workspace.ts";
import { AbsorptionDialog, useAbsorption } from "#ui/routes/project/$id/workspace/Absorption.tsx";
import { useMonitorDraggedOperationSource } from "#ui/routes/project/$id/workspace/DragAndDrop.tsx";
import { isOperationModeSourceOrTarget } from "#ui/routes/project/$id/workspace/OperationMode.tsx";
import { OperationSourceC } from "#ui/routes/project/$id/workspace/OperationSourceC.tsx";
import { useResolveOperationSource } from "#ui/routes/project/$id/workspace/ResolvedOperationSource.ts";
import {
	CommitTarget,
	OperationTarget,
} from "#ui/routes/project/$id/workspace/OperationTargets.tsx";
import { OperationSourceLabel } from "#ui/routes/project/$id/workspace/OperationSourceLabel.tsx";
import {
	formatHunkHeader,
	CommitLabel,
	shortCommitId,
	decodeRefName,
	getRelative,
	encodeRefName,
} from "#ui/routes/project/$id/shared.tsx";
import uiStyles from "#ui/ui.module.css";
import { ContextMenu, Menu, mergeProps, Tooltip, useRender } from "@base-ui/react";
import {
	AbsorptionTarget,
	Commit,
	DiffHunk,
	HunkDependencies,
	HunkHeader,
	Segment,
	Stack,
	TreeChange,
	UnifiedPatch,
} from "@gitbutler/but-sdk";
import { useMutation, useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query";
import { createRoute } from "@tanstack/react-router";
import { Array, Match, pipe } from "effect";
import { isNonEmptyArray, NonEmptyArray } from "effect/Array";
import {
	ComponentProps,
	FC,
	Fragment,
	ReactNode,
	Ref,
	Suspense,
	useImperativeHandle,
	useLayoutEffect,
	useOptimistic,
	useRef,
	useTransition,
} from "react";
import { Route as projectRoute } from "#ui/routes/project/$id/route.tsx";
import { useAppDispatch, useAppSelector } from "#ui/state/hooks.ts";
import {
	baseCommitItem,
	changeItem,
	changesSectionItem,
	CommitFileItem,
	commitFileItem,
	CommitItem,
	commitItem,
	type Item,
	SegmentItem,
	segmentItem,
	stackItem,
} from "./Item.ts";
import {
	buildNavigationIndex,
	filterNavigationIndex,
	getDefaultItem,
	navigationIndexIncludes,
	type NavigationIndex,
	useWorkspaceOutline,
} from "./WorkspaceModel.ts";
import {
	getScopeBindings,
	getScopeLabel,
	getScope,
	renameBranchBindings,
	rewordCommitBindings,
	useWorkspaceShortcuts,
} from "./WorkspaceShortcuts.ts";
import { PositionedShortcutsBar } from "../ShortcutsBar.tsx";
import { formatShortcutKeys, ShortcutActionBase, type ShortcutBinding } from "#ui/shortcuts.ts";
import styles from "./route.module.css";
import {
	fileOperationSource,
	hunkOperationSource,
	operationSourceFromItem,
} from "./OperationSource.ts";
import {
	getOperationMode,
	normalizeWorkspaceMode,
	type OperationMode,
	type WorkspaceMode,
} from "./WorkspaceMode.ts";

type HunkDependencyDiff = HunkDependencies["diffs"][number];
const fileHunkKey = (path: string, hunk: HunkHeader): string => `${path}:${hunkKey(hunk)}`;

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
		}}
	/>
);

const hunkKey = (hunk: HunkHeader): string =>
	`${hunk.oldStart}:${hunk.oldLines}:${hunk.newStart}:${hunk.newLines}`;

type Patch = Extract<UnifiedPatch, { type: "Patch" }>;

const FileButton: FC<
	{
		change: TreeChange;
	} & ComponentProps<"button">
> = ({ change, className, ...restProps }) => (
	<button {...restProps} type="button" className={classes(className, styles.itemRowButton)}>
		{Match.value(change.status).pipe(
			Match.when({ type: "Addition" }, () => "A"),
			Match.when({ type: "Deletion" }, () => "D"),
			Match.when({ type: "Modification" }, () => "M"),
			Match.when({ type: "Rename" }, () => "R"),
			Match.exhaustive,
		)}{" "}
		{change.path}
	</button>
);

const CommitFiles: FC<{
	projectId: string;
	commitId: string;
	renderFile: (change: TreeChange) => ReactNode;
}> = ({ projectId, commitId, renderFile }) => {
	const { data } = useSuspenseQuery(
		commitDetailsWithLineStatsQueryOptions({ projectId, commitId }),
	);

	const conflictedPaths = data.conflictEntries
		? globalThis.Array.from(
				new Set([
					...data.conflictEntries.ancestorEntries,
					...data.conflictEntries.ourEntries,
					...data.conflictEntries.theirEntries,
				]),
			).sort((a: string, b: string) => a.localeCompare(b))
		: [];

	if (conflictedPaths.length === 0 && data.changes.length === 0)
		return <div className={styles.itemRowEmpty}>No file changes.</div>;

	return (
		<>
			{conflictedPaths.length > 0 && (
				<div>
					<div>Conflicts:</div>
					<ul>
						{conflictedPaths.map((path: string) => (
							<li key={path}>{path}</li>
						))}
					</ul>
				</div>
			)}

			{data.changes.length > 0 && (
				<ul>
					{data.changes.map((file) => (
						<li key={file.path}>{renderFile(file)}</li>
					))}
				</ul>
			)}
		</>
	);
};

const CommitsList: FC<{
	commits: Array<Commit>;
	children: (commit: Commit, index: number) => ReactNode;
}> = ({ commits, children }) => {
	if (commits.length === 0) return <div>No commits.</div>;

	return (
		<ul>
			{commits.map((commit, index) => (
				<li key={commit.id}>{children(commit, index)}</li>
			))}
		</ul>
	);
};

const ItemRow: FC<
	{
		isSelected?: boolean;
	} & ComponentProps<"div">
> = ({ className, isSelected, ...props }) => {
	const rowRef = useRef<HTMLDivElement | null>(null);

	useLayoutEffect(() => {
		if (!isSelected) return;
		rowRef.current?.scrollIntoView({
			block: "nearest",
			inline: "nearest",
		});
	}, [isSelected]);

	return (
		<div
			{...props}
			ref={rowRef}
			className={classes(className, styles.itemRow, isSelected && styles.itemRowSelected)}
		/>
	);
};

const DependencyIndicator: FC<
	{
		projectId: string;
		commitIds: NonEmptyArray<string>;
	} & useRender.ComponentProps<"button">
> = ({ projectId, commitIds, render, ...props }) => {
	const dispatch = useAppDispatch();
	const { data: headInfo } = useSuspenseQuery(headInfoQueryOptions(projectId));
	// TODO: expensive
	const branchNameByCommitId = getBranchNameByCommitId(headInfo);
	const branchNames = pipe(
		commitIds,
		Array.flatMapNullable((commitId) => branchNameByCommitId.get(commitId)),
		Array.dedupe,
	);
	const tooltip =
		branchNames.length > 0 ? `Depends on ${branchNames.join(", ")}` : "Unknown dependencies";
	const trigger = useRender({
		render,
		defaultTagName: "button",
		props: mergeProps<"button">(props, {
			onMouseEnter: () => {
				dispatch(projectActions.setHighlightedCommitIds({ projectId, commitIds }));
			},
			onMouseLeave: () => {
				dispatch(projectActions.setHighlightedCommitIds({ projectId, commitIds: null }));
			},
			"aria-label": tooltip,
		}),
	});

	return (
		<Tooltip.Root
			// [ref:tooltip-disable-hoverable-popup]
			disableHoverablePopup
		>
			<Tooltip.Trigger render={trigger} />
			<Tooltip.Portal>
				<Tooltip.Positioner sideOffset={8}>
					<Tooltip.Popup className={classes(uiStyles.popup, uiStyles.tooltip)}>
						{tooltip}
					</Tooltip.Popup>
				</Tooltip.Positioner>
			</Tooltip.Portal>
		</Tooltip.Root>
	);
};

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

const dependencyCommitIdsForHunk = (
	hunk: DiffHunk,
	hunkDependencyDiffs: Array<HunkDependencyDiff>,
): Array<string> => {
	const commitIds = new Set<string>();

	for (const [, dependencyHunk, locks] of hunkDependencyDiffs) {
		if (!hunkContainsHunk(hunk, dependencyHunk)) continue;
		for (const dependency of locks) commitIds.add(dependency.commitId);
	}

	return globalThis.Array.from(commitIds);
};

const dependencyCommitIdsForFile = (
	hunkDependencyDiffs: Array<HunkDependencyDiff>,
): Array<string> => {
	const commitIds = new Set<string>();

	for (const [, , locks] of hunkDependencyDiffs)
		for (const dependency of locks) commitIds.add(dependency.commitId);

	return globalThis.Array.from(commitIds);
};

const Hunk: FC<{
	patch: Patch;
	operationMode: OperationMode | null;
	projectId: string;
	fileParent?: FileParent;
	change: TreeChange;
	hunk: DiffHunk;
	editable: boolean;
	headerStart?: ReactNode;
	isSelected?: boolean;
	isFocused: boolean;
}> = ({
	patch,
	operationMode,
	projectId,
	fileParent,
	change,
	hunk,
	editable,
	headerStart,
	isSelected,
	isFocused,
}) => {
	const dispatch = useAppDispatch();
	const headerRow = (
		<div className={styles.hunkHeaderRow}>
			{headerStart}
			<div className={styles.hunkHeader}>{formatHunkHeader(hunk)}</div>
		</div>
	);

	return (
		// oxlint-disable-next-line jsx_a11y/click-events-have-key-events, jsx_a11y/no-static-element-interactions -- TODO
		<div
			onClick={() =>
				dispatch(
					projectActions.selectHunk({
						projectId,
						hunk: fileHunkKey(change.path, hunk),
					}),
				)
			}
			className={classes(styles.previewHunk, isSelected && isFocused && styles.previewHunkSelected)}
		>
			{fileParent && editable
				? (() => {
						const source = hunkOperationSource({
							parent: fileParent,
							path: change.path,
							hunkHeader: hunk,
						});
						return (
							<OperationSourceC
								operationMode={operationMode}
								projectId={projectId}
								source={source}
								canDrag={() => !patch.subject.isResultOfBinaryToTextConversion}
							>
								{headerRow}
							</OperationSourceC>
						);
					})()
				: headerRow}
			<HunkDiff change={change} diff={hunk.diff} />
		</div>
	);
};

const FileDiff: FC<{
	operationMode: OperationMode | null;
	projectId: string;
	change: TreeChange;
	fileParent?: FileParent;
	editable: boolean;
	hunkDependencyDiffs?: Array<HunkDependencyDiff>;
	diff: UnifiedPatch | null;
	selectedHunk: string | undefined;
	isFocused: boolean;
}> = ({
	operationMode,
	projectId,
	change,
	fileParent,
	editable,
	hunkDependencyDiffs,
	diff,
	selectedHunk,
	isFocused,
}) =>
	Match.value(diff).pipe(
		Match.when(null, () => <div>No diff available for this file.</div>),
		Match.when({ type: "Binary" }, () => <div>Binary file (diff not available).</div>),
		Match.when({ type: "TooLarge" }, ({ subject }) => (
			<div>Diff too large ({subject.sizeInBytes} bytes).</div>
		)),
		Match.when({ type: "Patch" }, (patch) => {
			const visibleHunks = patch.subject.hunks;
			if (visibleHunks.length === 0) return <div>No hunks.</div>;

			return (
				<ul>
					{visibleHunks.map((hunk) => {
						const dependencyCommitIds = hunkDependencyDiffs
							? dependencyCommitIdsForHunk(hunk, hunkDependencyDiffs)
							: [];

						return (
							<li key={hunkKey(hunk)}>
								<Hunk
									patch={patch}
									operationMode={operationMode}
									projectId={projectId}
									fileParent={fileParent}
									change={change}
									hunk={hunk}
									editable={editable}
									isSelected={selectedHunk === fileHunkKey(change.path, hunk)}
									isFocused={isFocused}
									headerStart={
										fileParent?._tag === "ChangesSection" &&
										isNonEmptyArray(dependencyCommitIds) ? (
											<DependencyIndicator projectId={projectId} commitIds={dependencyCommitIds}>
												<DependencyIcon />
											</DependencyIndicator>
										) : undefined
									}
								/>
							</li>
						);
					})}
				</ul>
			);
		}),
		Match.exhaustive,
	);

const hunkKeysFromChangeWithDiff = ([change, diff]: [
	TreeChange,
	UnifiedPatch | null,
]): Array<string> =>
	diff?.type === "Patch" ? diff.subject.hunks.map((hunk) => fileHunkKey(change.path, hunk)) : [];

export type PreviewImperativeHandle = {
	moveSelection: (offset: -1 | 1) => void;
};

const usePreviewDiffState = ({
	projectId,
	changes,
	ref,
}: {
	projectId: string;
	changes: Array<TreeChange>;
	ref?: Ref<PreviewImperativeHandle>;
}) => {
	const dispatch = useAppDispatch();
	const selectedHunk = useAppSelector((state) => selectProjectSelectedHunk(state, projectId));
	const treeChangeDiffs = useSuspenseQueries({
		queries: changes.map((change) => treeChangeDiffsQueryOptions({ projectId, change })),
	}).map((result) => result.data);
	const changesWithDiffs = pipe(changes, Array.zip(treeChangeDiffs));
	const hunkKeys = changesWithDiffs.flatMap(([change, diff]) =>
		hunkKeysFromChangeWithDiff([change, diff]),
	);
	const normalizedSelectedHunk = normalizeSelectedHunk({ hunkKeys, selectedHunk });

	useImperativeHandle(
		ref,
		(): PreviewImperativeHandle => ({
			moveSelection: (offset) => {
				if (hunkKeys.length === 0) return;

				if (normalizedSelectedHunk === undefined) return;

				// We assume a valid key was provided.
				const currentIndex = hunkKeys.indexOf(normalizedSelectedHunk);

				dispatch(
					projectActions.selectHunk({
						projectId,
						hunk: getRelative(hunkKeys, currentIndex, offset),
					}),
				);
			},
		}),
		[dispatch, normalizedSelectedHunk, hunkKeys, projectId],
	);

	return { changesWithDiffs, normalizedSelectedHunk };
};

const ChangesPreview: FC<{
	operationMode: OperationMode | null;
	projectId: string;
	selectedPath?: string;
	isFocused: boolean;
	ref?: Ref<PreviewImperativeHandle>;
}> = ({ operationMode, projectId, selectedPath, isFocused, ref }) => {
	const { data: worktreeChanges } = useSuspenseQuery(changesInWorktreeQueryOptions(projectId));
	const hunkDependencyDiffsByPath = getHunkDependencyDiffsByPath(
		worktreeChanges.dependencies?.diffs ?? [],
	);
	const changes = worktreeChanges.changes;
	const selectedChange =
		selectedPath !== undefined
			? changes.find((candidate) => candidate.path === selectedPath)
			: undefined;
	const visibleChanges = selectedChange ? [selectedChange] : changes;
	const { changesWithDiffs, normalizedSelectedHunk } = usePreviewDiffState({
		projectId,
		changes: visibleChanges,
		ref,
	});

	return (
		<div>
			{changesWithDiffs.length === 0 ? (
				<div>No file changes.</div>
			) : (
				<ul>
					{changesWithDiffs.map(([change, diff]) => {
						const parent = changesSectionFileParent({});
						const source = fileOperationSource({ parent, path: change.path });
						return (
							<li key={change.path}>
								<OperationSourceC
									operationMode={operationMode}
									projectId={projectId}
									source={source}
								>
									<h4>{change.path}</h4>
								</OperationSourceC>
								<FileDiff
									operationMode={operationMode}
									projectId={projectId}
									change={change}
									fileParent={parent}
									editable
									hunkDependencyDiffs={hunkDependencyDiffsByPath.get(change.path)}
									diff={diff}
									selectedHunk={normalizedSelectedHunk}
									isFocused={isFocused}
								/>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
};

const CommitPreview: FC<{
	operationMode: OperationMode | null;
	projectId: string;
	commitId: string;
	selectedPath?: string | null;
	editable: boolean;
	isFocused: boolean;
	ref?: Ref<PreviewImperativeHandle>;
}> = ({ operationMode, projectId, commitId, selectedPath, editable, isFocused, ref }) => {
	const { data: commitDetails } = useSuspenseQuery(
		commitDetailsWithLineStatsQueryOptions({ projectId, commitId }),
	);
	const selectedChange =
		selectedPath !== undefined
			? commitDetails.changes.find((candidate) => candidate.path === selectedPath)
			: undefined;
	const visibleChanges =
		selectedPath === undefined ? commitDetails.changes : selectedChange ? [selectedChange] : [];
	const { changesWithDiffs, normalizedSelectedHunk } = usePreviewDiffState({
		projectId,
		changes: visibleChanges,
		ref,
	});

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
			{changesWithDiffs.length === 0 ? (
				<div>No file changes.</div>
			) : (
				<ul>
					{changesWithDiffs.map(([change, diff]) => {
						const parent = commitFileParent({ commitId });
						const source = fileOperationSource({ parent, path: change.path });
						return (
							<li key={change.path}>
								{editable ? (
									<OperationSourceC
										operationMode={operationMode}
										projectId={projectId}
										source={source}
									>
										<h4>{change.path}</h4>
									</OperationSourceC>
								) : (
									<h4>{change.path}</h4>
								)}
								<FileDiff
									operationMode={operationMode}
									projectId={projectId}
									change={change}
									fileParent={parent}
									editable={editable}
									diff={diff}
									selectedHunk={normalizedSelectedHunk}
									isFocused={isFocused}
								/>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
};

const BranchPreview: FC<{
	operationMode: OperationMode | null;
	projectId: string;
	branchRef: Array<number>;
	isFocused: boolean;
	ref?: Ref<PreviewImperativeHandle>;
}> = ({ operationMode, projectId, branchRef, isFocused, ref }) => {
	const branch = decodeRefName(branchRef);
	const [{ data: branchDetails }, { data: branchDiff }] = useSuspenseQueries({
		queries: [
			branchDetailsQueryOptions({
				projectId,
				// https://linear.app/gitbutler/issue/GB-1226/unify-branch-identifiers
				branchName: branch.replace(/^refs\/heads\//, ""),
				remote: null,
			}),
			branchDiffQueryOptions({ projectId, branch }),
		],
	});
	const { changesWithDiffs, normalizedSelectedHunk } = usePreviewDiffState({
		projectId,
		changes: branchDiff.changes,
		ref,
	});

	return (
		<div>
			<h3>{branchDetails.name}</h3>
			{branchDetails.prNumber != null && <p>PR #{branchDetails.prNumber}</p>}
			{changesWithDiffs.length === 0 ? (
				<div>No file changes.</div>
			) : (
				<ul>
					{changesWithDiffs.map(([change, diff]) => (
						<li key={change.path}>
							<h4>{change.path}</h4>
							<FileDiff
								operationMode={operationMode}
								projectId={projectId}
								change={change}
								editable={false}
								diff={diff}
								selectedHunk={normalizedSelectedHunk}
								isFocused={isFocused}
							/>
						</li>
					))}
				</ul>
			)}
		</div>
	);
};

const Preview: FC<{
	operationMode: OperationMode | null;
	projectId: string;
	selectedItem: Item;
	isFocused: boolean;
	ref?: Ref<PreviewImperativeHandle>;
}> = ({ operationMode, projectId, selectedItem, isFocused, ref }) =>
	Match.value(selectedItem).pipe(
		Match.tagsExhaustive({
			Stack: () => null,
			Segment: ({ branchRef }) => {
				if (branchRef == null)
					return (
						<div>
							TODO: the API doesn't provide a way to show details/diffs for segments that don't have
							branch names.
						</div>
					);

				return (
					<BranchPreview
						operationMode={operationMode}
						projectId={projectId}
						branchRef={branchRef}
						isFocused={isFocused}
						ref={ref}
					/>
				);
			},
			ChangesSection: () => (
				<ChangesPreview
					operationMode={operationMode}
					projectId={projectId}
					isFocused={isFocused}
					ref={ref}
				/>
			),
			Change: ({ path }) => (
				<ChangesPreview
					operationMode={operationMode}
					projectId={projectId}
					selectedPath={path}
					isFocused={isFocused}
					ref={ref}
				/>
			),
			Commit: (selectedItem) => (
				<CommitPreview
					operationMode={operationMode}
					projectId={projectId}
					commitId={selectedItem.commitId}
					editable
					isFocused={isFocused}
					ref={ref}
				/>
			),
			CommitFile: ({ commitId, path }) => (
				<CommitPreview
					operationMode={operationMode}
					projectId={projectId}
					commitId={commitId}
					selectedPath={path}
					editable
					isFocused={isFocused}
					ref={ref}
				/>
			),
			BaseCommit: () => null,
		}),
	);

const StackMenuPopup: FC<{
	projectId: string;
	stackId: string;
}> = ({ projectId, stackId }) => {
	const unapplyStack = useMutation(unapplyStackMutationOptions);

	return (
		<Menu.Popup className={classes(uiStyles.popup, uiStyles.menuPopup)}>
			<Menu.Item className={uiStyles.menuItem} disabled>
				Move up
			</Menu.Item>
			<Menu.Item className={uiStyles.menuItem} disabled>
				Move down
			</Menu.Item>
			<Menu.Separator />
			<Menu.Item
				className={uiStyles.menuItem}
				disabled={unapplyStack.isPending}
				onClick={() => {
					unapplyStack.mutate({ projectId, stackId });
				}}
			>
				Unapply stack
			</Menu.Item>
		</Menu.Popup>
	);
};

const EditorHelp: FC<{
	bindings: Array<ShortcutBinding<ShortcutActionBase>>;
}> = ({ bindings }) => (
	<div className={styles.editorHelp}>
		{bindings.map((binding, index) => (
			<Fragment key={binding.id}>
				{index > 0 && " • "}
				<span className={styles.editorShortcut}>{formatShortcutKeys(binding.keys)}</span> to{" "}
				{binding.description}
			</Fragment>
		))}
	</div>
);

const InlineCommitMessageEditor: FC<{
	message: string;
	onSubmit: (value: string) => void;
	onCancel: () => void;
	formRef?: Ref<HTMLFormElement>;
}> = ({ message, onSubmit, onCancel, formRef }) => (
	<form
		ref={formRef}
		className={styles.editorForm}
		onSubmit={(event) => {
			event.preventDefault();
			const formData = new FormData(event.currentTarget);
			onCancel();
			onSubmit(formData.get("message") as string);
		}}
	>
		<textarea
			ref={(el) => {
				if (!el) return;
				el.focus();
				const cursorPosition = el.value.length;
				el.setSelectionRange(cursorPosition, cursorPosition);
			}}
			aria-label="Commit message"
			name="message"
			defaultValue={message.trim()}
			className={classes(styles.editorInput, styles.editCommitMessageInput)}
		/>
		<EditorHelp bindings={rewordCommitBindings} />
	</form>
);

const CommitMenuPopup: FC<{
	projectId: string;
	commitId: string;
	canReword: boolean;
	onReword: () => void;
	parts: typeof Menu | typeof ContextMenu;
}> = ({ projectId, commitId, canReword, onReword, parts }) => {
	const commitInsertBlank = useMutation(commitInsertBlankMutationOptions);
	const commitDiscard = useMutation(commitDiscardMutationOptions);
	const { Popup, Item, SubmenuRoot, SubmenuTrigger, Positioner } = parts;

	return (
		<Popup className={classes(uiStyles.popup, uiStyles.menuPopup)}>
			<Item className={uiStyles.menuItem} disabled={!canReword} onClick={onReword}>
				Reword commit
			</Item>
			<SubmenuRoot>
				<SubmenuTrigger className={uiStyles.menuItem}>Add empty commit</SubmenuTrigger>
				<Positioner>
					<Popup className={classes(uiStyles.popup, uiStyles.menuPopup)}>
						<Item
							className={uiStyles.menuItem}
							onClick={() => {
								commitInsertBlank.mutate({
									projectId,
									relativeTo: { type: "commit", subject: commitId },
									side: "above",
								});
							}}
						>
							Above
						</Item>
						<Item
							className={uiStyles.menuItem}
							onClick={() => {
								commitInsertBlank.mutate({
									projectId,
									relativeTo: { type: "commit", subject: commitId },
									side: "below",
								});
							}}
						>
							Below
						</Item>
					</Popup>
				</Positioner>
			</SubmenuRoot>
			<Item
				className={uiStyles.menuItem}
				disabled={commitDiscard.isPending}
				onClick={() => {
					commitDiscard.mutate({
						projectId,
						subjectCommitId: commitId,
					});
				}}
			>
				Delete commit
			</Item>
		</Popup>
	);
};

const CommitRow: FC<
	{
		branchRef: Array<number> | null;
		commit: Commit;
		commitMessageFormRef: Ref<HTMLFormElement>;
		workspaceMode: WorkspaceMode;
		isExpanded: boolean;
		isHighlighted: boolean;
		selected: CommitItem | null;
		projectId: string;
		segmentIndex: number;
		stackId: string;
		navigationIndex: NavigationIndex;
	} & ComponentProps<"div">
> = ({
	branchRef,
	commit,
	commitMessageFormRef,
	workspaceMode,
	isExpanded,
	isHighlighted,
	selected,
	projectId,
	segmentIndex,
	stackId,
	navigationIndex,
	...restProps
}) => {
	const dispatch = useAppDispatch();
	const commitItemV: CommitItem = {
		stackId,
		segmentIndex,
		branchRef,
		commitId: commit.id,
	};
	const item = commitItem(commitItemV);
	const isRewording =
		selected !== null &&
		workspaceMode._tag === "RewordCommit" &&
		workspaceMode.commitId === commit.id;
	const [optimisticMessage, setOptimisticMessage] = useOptimistic(
		commit.message,
		(_currentMessage, nextMessage: string) => nextMessage,
	);
	const [isCommitMessagePending, startCommitMessageTransition] = useTransition();

	const commitWithOptimisticMessage: Commit = {
		...commit,
		message: optimisticMessage,
	};

	const commitReword = useMutation(commitRewordMutationOptions);

	const startEditing = () => {
		dispatch(projectActions.startRewordCommit({ projectId, item: commitItemV }));
	};

	const endEditing = () => {
		dispatch(projectActions.exitMode({ projectId }));
		dispatch(projectActions.selectItem({ projectId, item }));
	};

	const saveNewMessage = (newMessage: string) => {
		const initialMessage = commit.message.trim();
		const trimmed = newMessage.trim();
		if (trimmed === initialMessage) return;
		startCommitMessageTransition(async () => {
			setOptimisticMessage(trimmed);
			try {
				await commitReword.mutateAsync({
					projectId,
					commitId: commit.id,
					message: trimmed,
				});
			} catch {
				// Use the global mutation error handler (shows toast) instead of React
				// error boundaries.
				return;
			}
		});
	};

	return (
		<ItemRow
			{...restProps}
			inert={!navigationIndexIncludes(navigationIndex, item)}
			isSelected={selected !== null}
			className={classes(restProps.className, isHighlighted && styles.itemRowHighlighted)}
		>
			{isRewording ? (
				<InlineCommitMessageEditor
					formRef={commitMessageFormRef}
					message={optimisticMessage}
					onSubmit={saveNewMessage}
					onCancel={endEditing}
				/>
			) : (
				<>
					<ContextMenu.Root disabled={workspaceMode._tag !== "Default"}>
						<ContextMenu.Trigger
							render={
								<button
									type="button"
									className={classes(
										styles.itemRowButton,
										isCommitMessagePending && styles.commitButtonPending,
									)}
									onClick={() => {
										dispatch(projectActions.selectItem({ projectId, item }));
									}}
								>
									<CommitLabel commit={commitWithOptimisticMessage} />
								</button>
							}
						/>
						<ContextMenu.Portal>
							<ContextMenu.Positioner>
								<CommitMenuPopup
									projectId={projectId}
									commitId={commit.id}
									canReword={!isCommitMessagePending}
									onReword={startEditing}
									parts={ContextMenu}
								/>
							</ContextMenu.Positioner>
						</ContextMenu.Portal>
					</ContextMenu.Root>
					{workspaceMode._tag === "Default" && (
						<>
							<Tooltip.Root
								// Prevent tooltip from lingering while moving between nearby controls.
								// [tag:tooltip-disable-hoverable-popup]
								disableHoverablePopup
							>
								<Tooltip.Trigger
									className={styles.itemRowAction}
									type="button"
									onClick={() =>
										dispatch(projectActions.toggleCommitFiles({ projectId, item: commitItemV }))
									}
									aria-expanded={isExpanded}
									aria-label={isExpanded ? "Hide commit files" : "Show commit files"}
								>
									<ExpandCollapseIcon isExpanded={isExpanded} />
								</Tooltip.Trigger>
								<Tooltip.Portal>
									<Tooltip.Positioner sideOffset={8}>
										<Tooltip.Popup className={classes(uiStyles.popup, uiStyles.tooltip)}>
											{isExpanded ? "Hide commit files" : "Show commit files"}
										</Tooltip.Popup>
									</Tooltip.Positioner>
								</Tooltip.Portal>
							</Tooltip.Root>
							<Menu.Root>
								<Menu.Trigger className={styles.itemRowAction} aria-label="Commit menu">
									<MenuTriggerIcon />
								</Menu.Trigger>
								<Menu.Portal>
									<Menu.Positioner align="end">
										<CommitMenuPopup
											projectId={projectId}
											commitId={commit.id}
											canReword={!isCommitMessagePending}
											onReword={startEditing}
											parts={Menu}
										/>
									</Menu.Positioner>
								</Menu.Portal>
							</Menu.Root>
						</>
					)}
				</>
			)}
		</ItemRow>
	);
};

const CommitFileRow: FC<{
	change: TreeChange;
	operationMode: OperationMode | null;
	parentCommitItem: CommitItem;
	isSelected: boolean;
	navigationIndex: NavigationIndex;
	projectId: string;
}> = ({ change, operationMode, parentCommitItem, isSelected, navigationIndex, projectId }) => {
	const dispatch = useAppDispatch();
	const item = commitFileItem({ ...parentCommitItem, path: change.path });

	return (
		<OperationSourceC
			operationMode={operationMode}
			projectId={projectId}
			source={operationSourceFromItem(item)}
			render={
				<ItemRow
					inert={!navigationIndexIncludes(navigationIndex, item)}
					isSelected={isSelected}
					className={styles.fileRow}
				/>
			}
		>
			<FileButton
				change={change}
				onClick={() => {
					dispatch(projectActions.selectItem({ projectId, item }));
				}}
			/>
		</OperationSourceC>
	);
};

const CommitC: FC<{
	branchRef: Array<number> | null;
	commit: Commit;
	commitMessageFormRef: Ref<HTMLFormElement>;
	operationMode: OperationMode | null;
	workspaceMode: WorkspaceMode;
	selected: CommitItem | null;
	selectedFile: CommitFileItem | null;
	projectId: string;
	segmentIndex: number;
	stackId: string;
	navigationIndex: NavigationIndex;
}> = ({
	branchRef,
	commit,
	commitMessageFormRef,
	operationMode,
	workspaceMode,
	selected,
	selectedFile,
	projectId,
	segmentIndex,
	stackId,
	navigationIndex,
}) => {
	const isExpanded = useAppSelector(
		(state) => selectProjectExpandedCommitId(state, projectId) === commit.id,
	);
	const isHighlighted = useAppSelector((state) =>
		selectProjectHighlightedCommitIds(state, projectId).includes(commit.id),
	);
	const commitItemV: CommitItem = { stackId, segmentIndex, branchRef, commitId: commit.id };
	const item = commitItem(commitItemV);
	return (
		<OperationSourceC
			operationMode={operationMode}
			projectId={projectId}
			source={operationSourceFromItem(item)}
			canDrag={() => !selected || workspaceMode._tag !== "RewordCommit"}
			render={
				<CommitTarget
					commitId={commit.id}
					item={item}
					projectId={projectId}
					operationMode={operationMode}
					selectedItem={selected ? item : null}
				/>
			}
		>
			<CommitRow
				branchRef={branchRef}
				commit={commit}
				commitMessageFormRef={commitMessageFormRef}
				workspaceMode={workspaceMode}
				isExpanded={isExpanded}
				isHighlighted={isHighlighted}
				selected={selected}
				projectId={projectId}
				segmentIndex={segmentIndex}
				stackId={stackId}
				navigationIndex={navigationIndex}
			/>
			{isExpanded && (
				<Suspense fallback={<div className={styles.itemRowEmpty}>Loading commit files…</div>}>
					<CommitFiles
						projectId={projectId}
						commitId={commit.id}
						renderFile={(change) => (
							<CommitFileRow
								change={change}
								operationMode={operationMode}
								parentCommitItem={commitItemV}
								isSelected={selectedFile?.path === change.path}
								navigationIndex={navigationIndex}
								projectId={projectId}
							/>
						)}
					/>
				</Suspense>
			)}
		</OperationSourceC>
	);
};

const ChangeRowMenuPopup: FC<{
	change: TreeChange;
	onAbsorbChanges: (target: AbsorptionTarget) => void;
	parts: typeof Menu | typeof ContextMenu;
}> = ({ change, onAbsorbChanges, parts }) => {
	const { Popup, Item } = parts;

	const absorb = () => {
		onAbsorbChanges({
			type: "treeChanges",
			subject: {
				changes: [change],
				assignedStackId: null,
			},
		});
	};

	return (
		<Popup className={classes(uiStyles.popup, uiStyles.menuPopup)}>
			<Item className={uiStyles.menuItem} onClick={absorb}>
				Absorb
			</Item>
		</Popup>
	);
};

const ChangeRow: FC<{
	change: TreeChange;
	dependencyCommitIds: Array<string>;
	isSelected: boolean;
	navigationIndex: NavigationIndex;
	onAbsorbChanges: (target: AbsorptionTarget) => void;
	operationMode: OperationMode | null;
	projectId: string;
}> = ({
	change,
	dependencyCommitIds,
	isSelected,
	navigationIndex,
	onAbsorbChanges,
	operationMode,
	projectId,
}) => {
	const dispatch = useAppDispatch();
	const item = changeItem({ path: change.path });
	return (
		<OperationSourceC
			operationMode={operationMode}
			projectId={projectId}
			source={operationSourceFromItem(item)}
			render={
				<ItemRow inert={!navigationIndexIncludes(navigationIndex, item)} isSelected={isSelected} />
			}
		>
			<ContextMenu.Root>
				<ContextMenu.Trigger
					render={
						<FileButton
							change={change}
							onClick={() => {
								dispatch(projectActions.selectItem({ projectId, item }));
							}}
						/>
					}
				/>
				<ContextMenu.Portal>
					<ContextMenu.Positioner>
						<ChangeRowMenuPopup
							change={change}
							onAbsorbChanges={onAbsorbChanges}
							parts={ContextMenu}
						/>
					</ContextMenu.Positioner>
				</ContextMenu.Portal>
			</ContextMenu.Root>
			{isNonEmptyArray(dependencyCommitIds) && (
				<DependencyIndicator
					projectId={projectId}
					commitIds={dependencyCommitIds}
					className={styles.itemRowAction}
				>
					<DependencyIcon />
				</DependencyIndicator>
			)}
			<Menu.Root>
				<Menu.Trigger className={styles.itemRowAction} aria-label={`${change.path} menu`}>
					<MenuTriggerIcon />
				</Menu.Trigger>
				<Menu.Portal>
					<Menu.Positioner align="end">
						<ChangeRowMenuPopup change={change} onAbsorbChanges={onAbsorbChanges} parts={Menu} />
					</Menu.Positioner>
				</Menu.Portal>
			</Menu.Root>
		</OperationSourceC>
	);
};

const ChangesSectionRowMenuPopup: FC<{
	changes: Array<TreeChange>;
	onAbsorbChanges: (target: AbsorptionTarget) => void;
	parts: typeof Menu | typeof ContextMenu;
}> = ({ changes, onAbsorbChanges, parts }) => {
	const { Popup, Item } = parts;

	const absorb = () => {
		onAbsorbChanges({
			type: "treeChanges",
			subject: {
				changes,
				assignedStackId: null,
			},
		});
	};

	return (
		<Popup className={classes(uiStyles.popup, uiStyles.menuPopup)}>
			<Item className={uiStyles.menuItem} disabled={changes.length === 0} onClick={absorb}>
				Absorb
			</Item>
		</Popup>
	);
};

const ChangesSectionRow: FC<{
	changes: Array<TreeChange>;
	isSelected: boolean;
	navigationIndex: NavigationIndex;
	onAbsorbChanges: (target: AbsorptionTarget) => void;
	projectId: string;
}> = ({ changes, isSelected, navigationIndex, onAbsorbChanges, projectId }) => {
	const dispatch = useAppDispatch();

	return (
		<ItemRow
			inert={!navigationIndexIncludes(navigationIndex, changesSectionItem({}))}
			isSelected={isSelected}
		>
			<ContextMenu.Root>
				<ContextMenu.Trigger
					render={
						<button
							type="button"
							className={classes(styles.itemRowButton, styles.sectionButton)}
							onClick={() => {
								dispatch(
									projectActions.selectItem({
										projectId,
										item: changesSectionItem({}),
									}),
								);
							}}
						>
							Changes
						</button>
					}
				/>
				<ContextMenu.Portal>
					<ContextMenu.Positioner>
						<ChangesSectionRowMenuPopup
							changes={changes}
							onAbsorbChanges={onAbsorbChanges}
							parts={ContextMenu}
						/>
					</ContextMenu.Positioner>
				</ContextMenu.Portal>
			</ContextMenu.Root>
			<Menu.Root>
				<Menu.Trigger className={styles.itemRowAction} aria-label={`Changes menu`}>
					<MenuTriggerIcon />
				</Menu.Trigger>
				<Menu.Portal>
					<Menu.Positioner align="end">
						<ChangesSectionRowMenuPopup
							changes={changes}
							onAbsorbChanges={onAbsorbChanges}
							parts={Menu}
						/>
					</Menu.Positioner>
				</Menu.Portal>
			</Menu.Root>
		</ItemRow>
	);
};

const BaseCommitRow: FC<
	{
		commitId?: string;
		isSelected: boolean;
		navigationIndex: NavigationIndex;
	} & ComponentProps<"div">
> = ({ commitId, isSelected, navigationIndex, ...props }) => {
	const dispatch = useAppDispatch();
	const projectId = Route.useParams().id;

	return (
		<ItemRow
			{...props}
			inert={!navigationIndexIncludes(navigationIndex, baseCommitItem)}
			isSelected={isSelected}
		>
			<button
				type="button"
				className={styles.commonBaseCommit}
				onClick={() => {
					dispatch(projectActions.selectItem({ projectId, item: baseCommitItem }));
				}}
			>
				{commitId !== undefined
					? `${shortCommitId(commitId)} (common base commit)`
					: "(base commit)"}
			</button>
		</ItemRow>
	);
};

const Changes: FC<{
	operationMode: OperationMode | null;
	projectId: string;
	isSelected: boolean;
	selectedPath: string | null;
	onAbsorbChanges: (target: AbsorptionTarget) => void;
	className?: string;
	navigationIndex: NavigationIndex;
}> = ({
	operationMode,
	projectId,
	isSelected,
	selectedPath,
	onAbsorbChanges,
	className,
	navigationIndex,
}) => {
	const { data: worktreeChanges } = useSuspenseQuery(changesInWorktreeQueryOptions(projectId));

	const hunkDependencyDiffsByPath = getHunkDependencyDiffsByPath(
		worktreeChanges.dependencies?.diffs ?? [],
	);

	const item = changesSectionItem({});

	return (
		<OperationSourceC
			operationMode={operationMode}
			projectId={projectId}
			source={operationSourceFromItem(item)}
			className={classes(className, styles.section)}
			render={
				<OperationTarget
					item={item}
					projectId={projectId}
					operationMode={operationMode}
					selectedItem={isSelected ? item : null}
				/>
			}
		>
			<ChangesSectionRow
				changes={worktreeChanges.changes}
				isSelected={isSelected}
				navigationIndex={navigationIndex}
				onAbsorbChanges={onAbsorbChanges}
				projectId={projectId}
			/>
			{worktreeChanges.changes.length === 0 ? (
				<div className={styles.itemRowEmpty}>No changes.</div>
			) : (
				<ul>
					{worktreeChanges.changes.map((change) => {
						const hunkDependencyDiffs = hunkDependencyDiffsByPath.get(change.path);
						const dependencyCommitIds = hunkDependencyDiffs
							? dependencyCommitIdsForFile(hunkDependencyDiffs)
							: [];

						return (
							<li key={change.path}>
								<ChangeRow
									change={change}
									dependencyCommitIds={dependencyCommitIds}
									isSelected={selectedPath === change.path}
									navigationIndex={navigationIndex}
									onAbsorbChanges={onAbsorbChanges}
									operationMode={operationMode}
									projectId={projectId}
								/>
							</li>
						);
					})}
				</ul>
			)}
		</OperationSourceC>
	);
};

const SegmentMenuPopup: FC<{
	canRename: boolean;
	onRename: () => void;
	parts: typeof Menu | typeof ContextMenu;
}> = ({ canRename, onRename, parts }) => {
	const { Popup, Item } = parts;

	return (
		<Popup className={classes(uiStyles.popup, uiStyles.menuPopup)}>
			<Item className={uiStyles.menuItem} disabled={!canRename} onClick={onRename}>
				Rename branch
			</Item>
		</Popup>
	);
};

const InlineBranchNameEditor: FC<{
	branchName: string;
	onSubmit: (value: string) => void;
	onExit: () => void;
	formRef?: Ref<HTMLFormElement>;
}> = ({ branchName, onSubmit, onExit, formRef }) => (
	<form
		ref={formRef}
		className={styles.editorForm}
		onSubmit={(event) => {
			event.preventDefault();
			const formData = new FormData(event.currentTarget);
			onExit();
			onSubmit(formData.get("branchName") as string);
		}}
	>
		<input
			aria-label="Branch name"
			ref={(el) => {
				if (!el) return;
				el.focus();
				el.select();
			}}
			name="branchName"
			defaultValue={branchName}
			className={classes(styles.editorInput, styles.renameBranchInput)}
		/>
		<EditorHelp bindings={renameBranchBindings} />
	</form>
);

const SegmentRow: FC<
	{
		branchRenameFormRef: Ref<HTMLFormElement>;
		operationMode: OperationMode | null;
		selected: SegmentItem | null;
		workspaceMode: WorkspaceMode;
		projectId: string;
		segment: Segment;
		stackId: string;
		segmentIndex: number;
		navigationIndex: NavigationIndex;
	} & ComponentProps<"div">
> = ({
	branchRenameFormRef,
	operationMode,
	selected,
	workspaceMode,
	projectId,
	segment,
	stackId,
	segmentIndex,
	navigationIndex,
	...restProps
}) => {
	const dispatch = useAppDispatch();
	const branchName = segment.refName?.displayName ?? null;
	const branchRef = segment.refName?.fullNameBytes ?? null;
	const segmentItemV: SegmentItem = {
		stackId,
		segmentIndex,
		branchRef,
	};
	const item = segmentItem(segmentItemV);
	const isRenaming =
		selected !== null &&
		workspaceMode._tag === "RenameBranch" &&
		workspaceMode.stackId === stackId &&
		workspaceMode.segmentIndex === segmentIndex;
	const [optimisticBranchName, setOptimisticBranchName] = useOptimistic(
		branchName,
		(_currentBranchName, nextBranchName: string) => nextBranchName,
	);
	const [isRenamePending, startRenameTransition] = useTransition();

	const updateBranchName = useMutation(updateBranchNameMutationOptions);

	const startEditing = () => {
		if (branchName === null) return;
		dispatch(projectActions.startRenameBranch({ projectId, item: segmentItemV }));
	};

	const endEditing = () => {
		dispatch(projectActions.exitMode({ projectId }));
		dispatch(projectActions.selectItem({ projectId, item }));
	};

	const saveBranchName = (newBranchName: string) => {
		if (branchName === null) return;
		const trimmed = newBranchName.trim();
		if (trimmed === "" || trimmed === branchName) return;
		startRenameTransition(async () => {
			setOptimisticBranchName(trimmed);
			try {
				await updateBranchName.mutateAsync({
					projectId,
					stackId,
					branchName,
					newName: trimmed,
				});
			} catch {
				// Use the global mutation error handler (shows toast) instead of React
				// error boundaries.
				return;
			}
			dispatch(
				projectActions.selectItem({
					projectId,
					item: segmentItem({
						stackId,
						segmentIndex,
						// TODO: ideally the API would return the new ref?
						branchRef: encodeRefName(`refs/heads/${trimmed}`),
					}),
				}),
			);
			dispatch(projectActions.exitMode({ projectId }));
		});
	};

	return (
		<OperationTarget
			{...restProps}
			projectId={projectId}
			item={item}
			operationMode={operationMode}
			selectedItem={selected ? item : null}
			render={
				<OperationSourceC
					operationMode={operationMode}
					projectId={projectId}
					source={operationSourceFromItem(item)}
					render={
						<ItemRow
							inert={!navigationIndexIncludes(navigationIndex, item)}
							isSelected={selected !== null}
						>
							{isRenaming && optimisticBranchName !== null ? (
								<InlineBranchNameEditor
									branchName={optimisticBranchName}
									formRef={branchRenameFormRef}
									onSubmit={saveBranchName}
									onExit={endEditing}
								/>
							) : (
								<>
									<ContextMenu.Root disabled={workspaceMode._tag !== "Default"}>
										<ContextMenu.Trigger
											render={
												<button
													type="button"
													className={classes(styles.itemRowButton, styles.sectionButton)}
													onClick={() => dispatch(projectActions.selectItem({ projectId, item }))}
												>
													{optimisticBranchName ?? "Untitled"}
												</button>
											}
										/>
										<ContextMenu.Portal>
											<ContextMenu.Positioner>
												<SegmentMenuPopup
													canRename={branchName !== null && !isRenamePending}
													onRename={startEditing}
													parts={ContextMenu}
												/>
											</ContextMenu.Positioner>
										</ContextMenu.Portal>
									</ContextMenu.Root>
									{workspaceMode._tag === "Default" && (
										<>
											<button
												type="button"
												className={styles.itemRowAction}
												aria-label="Push branch"
												disabled
											>
												<PushIcon />
											</button>
											<Menu.Root>
												<Menu.Trigger className={styles.itemRowAction} aria-label="Branch menu">
													<MenuTriggerIcon />
												</Menu.Trigger>
												<Menu.Portal>
													<Menu.Positioner align="end">
														<SegmentMenuPopup
															canRename={branchName !== null && !isRenamePending}
															onRename={startEditing}
															parts={Menu}
														/>
													</Menu.Positioner>
												</Menu.Portal>
											</Menu.Root>
										</>
									)}
								</>
							)}
						</ItemRow>
					}
				/>
			}
		/>
	);
};

const SegmentC: FC<{
	branchRenameFormRef: Ref<HTMLFormElement>;
	commitMessageFormRef: Ref<HTMLFormElement>;
	operationMode: OperationMode | null;
	projectId: string;
	selectedItem: Item | null;
	segment: Segment;
	segmentIndex: number;
	stackId: string;
	workspaceMode: WorkspaceMode;
	navigationIndex: NavigationIndex;
}> = ({
	branchRenameFormRef,
	commitMessageFormRef,
	operationMode,
	projectId,
	segment,
	segmentIndex,
	selectedItem,
	stackId,
	workspaceMode,
	navigationIndex,
}) => {
	const selectedSegment =
		selectedItem?._tag === "Segment" &&
		selectedItem.stackId === stackId &&
		selectedItem.segmentIndex === segmentIndex
			? selectedItem
			: null;
	const selectedCommit =
		selectedItem?._tag === "Commit" &&
		selectedItem.stackId === stackId &&
		selectedItem.segmentIndex === segmentIndex
			? selectedItem
			: null;
	const selectedCommitFile =
		selectedItem?._tag === "CommitFile" &&
		selectedItem.stackId === stackId &&
		selectedItem.segmentIndex === segmentIndex
			? selectedItem
			: null;

	return (
		<div className={classes(styles.section, styles.segment)}>
			<SegmentRow
				branchRenameFormRef={branchRenameFormRef}
				operationMode={operationMode}
				selected={selectedSegment}
				workspaceMode={workspaceMode}
				projectId={projectId}
				segment={segment}
				stackId={stackId}
				segmentIndex={segmentIndex}
				navigationIndex={navigationIndex}
			/>

			<CommitsList commits={segment.commits}>
				{(commit) => {
					const isSelected = selectedCommit?.commitId === commit.id;
					return (
						<CommitC
							branchRef={segment.refName?.fullNameBytes ?? null}
							commit={commit}
							commitMessageFormRef={commitMessageFormRef}
							operationMode={operationMode}
							workspaceMode={workspaceMode}
							selected={isSelected ? selectedCommit : null}
							selectedFile={selectedCommitFile?.commitId === commit.id ? selectedCommitFile : null}
							projectId={projectId}
							segmentIndex={segmentIndex}
							stackId={stackId}
							navigationIndex={navigationIndex}
						/>
					);
				}}
			</CommitsList>
		</div>
	);
};

const StackC: FC<{
	branchRenameFormRef: Ref<HTMLFormElement>;
	commitMessageFormRef: Ref<HTMLFormElement>;
	operationMode: OperationMode | null;
	projectId: string;
	selectedItem: Item | null;
	stack: Stack;
	workspaceMode: WorkspaceMode;
	navigationIndex: NavigationIndex;
}> = ({
	branchRenameFormRef,
	commitMessageFormRef,
	operationMode,
	projectId,
	selectedItem,
	stack,
	workspaceMode,
	navigationIndex,
}) => {
	// From Caleb:
	// > There shouldn't be a way within GitButler to end up with a stack without a
	//   StackId. Users can disrupt our matching against our metadata by playing
	//   with references, but we currently also try to patch it up at certain points
	//   so it probably isn't too common.
	// For now we'll treat this as non-nullable until we identify cases where it
	// could genuinely be null (assuming backend correctness).
	// oxlint-disable-next-line typescript/no-non-null-assertion -- [tag:stack-id-required]
	const stackId = stack.id!;

	const dispatch = useAppDispatch();

	const item = stackItem({ stackId });

	return (
		<div className={classes(styles.stack, styles.section)}>
			<ItemRow
				isSelected={selectedItem?._tag === "Stack" && selectedItem.stackId === stackId}
				inert={!navigationIndexIncludes(navigationIndex, item)}
				className={styles.stackRow}
			>
				<ContextMenu.Root disabled={workspaceMode._tag !== "Default"}>
					<ContextMenu.Trigger
						render={
							<button
								type="button"
								className={classes(styles.itemRowButton, styles.sectionButton)}
								onClick={() => {
									dispatch(projectActions.selectItem({ projectId, item }));
								}}
							>
								Stack
							</button>
						}
					/>
					<ContextMenu.Portal>
						<ContextMenu.Positioner>
							<StackMenuPopup projectId={projectId} stackId={stackId} />
						</ContextMenu.Positioner>
					</ContextMenu.Portal>
				</ContextMenu.Root>
				<Menu.Root>
					<Menu.Trigger className={styles.itemRowAction} aria-label="Stack menu">
						<MenuTriggerIcon />
					</Menu.Trigger>
					<Menu.Portal>
						<Menu.Positioner align="end">
							<StackMenuPopup projectId={projectId} stackId={stackId} />
						</Menu.Positioner>
					</Menu.Portal>
				</Menu.Root>
			</ItemRow>

			<ul className={styles.segments}>
				{stack.segments.map((segment, segmentIndex) => (
					// oxlint-disable-next-line react/no-array-index-key -- It's all we have.
					<li key={segmentIndex}>
						<SegmentC
							branchRenameFormRef={branchRenameFormRef}
							commitMessageFormRef={commitMessageFormRef}
							operationMode={operationMode}
							projectId={projectId}
							segment={segment}
							segmentIndex={segmentIndex}
							selectedItem={selectedItem}
							stackId={stackId}
							workspaceMode={workspaceMode}
							navigationIndex={navigationIndex}
						/>
					</li>
				))}
			</ul>
		</div>
	);
};

const ProjectPage: FC = () => {
	const { id: projectId } = Route.useParams();

	const expandedCommitId = useAppSelector((state) =>
		selectProjectExpandedCommitId(state, projectId),
	);
	const layoutState = useAppSelector((state) => selectProjectLayoutState(state, projectId));
	const selectedItemState = useAppSelector((state) => selectProjectSelectedItem(state, projectId));
	const workspaceModeState = useAppSelector((state) =>
		selectProjectWorkspaceModeState(state, projectId),
	);

	const branchRenameFormRef = useRef<HTMLFormElement | null>(null);
	const commitMessageFormRef = useRef<HTMLFormElement | null>(null);
	const previewRef = useRef<PreviewImperativeHandle | null>(null);

	const { data: projects } = useSuspenseQuery(listProjectsQueryOptions());

	const project = projects.find((project) => project.id === projectId);

	// TODO: handle project not found error. or only run when project is not null? waterfall.
	const { data: headInfo } = useSuspenseQuery(headInfoQueryOptions(projectId));

	const commonBaseCommitId = getCommonBaseCommitId(headInfo);

	const workspaceOutline = useWorkspaceOutline({ projectId, expandedCommitId });

	const navigationIndexUnfiltered = buildNavigationIndex(workspaceOutline);

	const resolveOperationSource = useResolveOperationSource(projectId);

	const workspaceMode = normalizeWorkspaceMode({
		mode: workspaceModeState,
		navigationIndex: navigationIndexUnfiltered,
	});

	const operationMode = getOperationMode(workspaceMode);

	const navigationIndex = operationMode
		? filterNavigationIndex(navigationIndexUnfiltered, (item) =>
				isOperationModeSourceOrTarget({
					item,
					operationMode,
					resolvedOperationSource: resolveOperationSource(operationMode.source),
				}),
			)
		: navigationIndexUnfiltered;

	const selectedItem =
		selectedItemState && navigationIndexIncludes(navigationIndex, selectedItemState)
			? selectedItemState
			: getDefaultItem(navigationIndex);

	const shortcutScope = getScope({ selectedItem, layoutState, workspaceMode });

	const {
		absorptionPlan,
		isAbsorbing,
		requestAbsorptionPlan,
		confirmAbsorption,
		clearAbsorptionPlan,
	} = useAbsorption(projectId);

	useMonitorDraggedOperationSource({ projectId });

	useWorkspaceShortcuts({
		branchRenameFormRef,
		commitMessageFormRef,
		projectId,
		scope: shortcutScope,
		navigationIndex,
		requestAbsorptionPlan,
		operationMode,
		previewRef,
	});

	const dispatch = useAppDispatch();

	// TODO: dedupe
	if (!project) return <p>Project not found.</p>;

	const commit = () =>
		dispatch(
			projectActions.enterMoveMode({
				projectId,
				source: operationSourceFromItem(changesSectionItem({})),
			}),
		);

	return (
		<ProjectPreviewLayout
			projectId={projectId}
			preview={
				selectedItem && (
					<Suspense fallback={<div>Loading preview…</div>}>
						<Preview
							operationMode={operationMode}
							projectId={projectId}
							selectedItem={selectedItem}
							isFocused={getFocus(layoutState) === "preview"}
							ref={previewRef}
						/>
					</Suspense>
				)
			}
		>
			<div className={styles.sections}>
				<div className={styles.changesContainer}>
					<Changes
						operationMode={operationMode}
						projectId={projectId}
						isSelected={selectedItem?._tag === "ChangesSection"}
						selectedPath={selectedItem?._tag === "Change" ? selectedItem.path : null}
						onAbsorbChanges={requestAbsorptionPlan}
						navigationIndex={navigationIndex}
					/>

					<button type="button" className={uiStyles.button} onClick={commit}>
						Commit
					</button>
				</div>

				{headInfo.stacks.map((stack) => (
					<StackC
						key={stack.id}
						branchRenameFormRef={branchRenameFormRef}
						commitMessageFormRef={commitMessageFormRef}
						operationMode={operationMode}
						projectId={project.id}
						selectedItem={selectedItem}
						stack={stack}
						workspaceMode={workspaceMode}
						navigationIndex={navigationIndex}
					/>
				))}

				<div className={styles.section}>
					<OperationTarget
						projectId={projectId}
						item={baseCommitItem}
						operationMode={operationMode}
						selectedItem={selectedItem?._tag === "BaseCommit" ? selectedItem : null}
						render={
							<BaseCommitRow
								commitId={commonBaseCommitId}
								isSelected={selectedItem?._tag === "BaseCommit"}
								navigationIndex={navigationIndex}
							/>
						}
					/>
				</div>
			</div>

			<PositionedShortcutsBar
				label={shortcutScope ? getScopeLabel(shortcutScope) : null}
				items={shortcutScope ? getScopeBindings(shortcutScope) : []}
			/>

			{operationMode && (
				<div className={styles.operationModePreview}>
					<OperationSourceLabel headInfo={headInfo} source={operationMode.source} />
				</div>
			)}

			{absorptionPlan !== null && (
				<AbsorptionDialog
					absorptionPlan={absorptionPlan}
					isPending={isAbsorbing}
					onConfirm={confirmAbsorption}
					onOpenChange={(open) => {
						if (!open) clearAbsorptionPlan();
					}}
				/>
			)}
		</ProjectPreviewLayout>
	);
};

export const Route = createRoute({
	getParentRoute: () => projectRoute,
	path: "workspace",
	component: ProjectPage,
});
