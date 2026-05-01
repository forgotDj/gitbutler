import {
	branchDiffQueryOptions,
	changesInWorktreeQueryOptions,
	commitDetailsWithLineStatsQueryOptions,
} from "#ui/api/queries.ts";
import {
	showNativeContextMenu,
	showNativeMenuFromTrigger,
	type NativeMenuItem,
} from "#ui/native-menu.ts";
import {
	branchFileParent,
	changesFileParent,
	commitFileParent,
	fileOperand,
	operandEquals,
	operandIdentityKey,
	type CommitOperand,
	type Operand,
} from "#ui/operands.ts";
import {
	projectActions,
	selectProjectOutlineModeState,
	selectProjectSelectionFiles,
	selectProjectSelectionOutline,
} from "#ui/projects/state.ts";
import { useAppDispatch, useAppSelector } from "#ui/store.ts";
import { classes } from "#ui/ui/classes.ts";
import { DependencyIcon, MenuTriggerIcon } from "#ui/ui/icons.tsx";
import { mergeProps, useRender } from "@base-ui/react";
import { Toolbar } from "@base-ui/react/toolbar";
import { AbsorptionTarget, TreeChange } from "@gitbutler/but-sdk";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { Match } from "effect";
import { NonEmptyArray } from "effect/Array";
import { ComponentProps, FC, Suspense } from "react";
import { Panel, PanelProps } from "react-resizable-panels";
import styles from "./FilesPanel.module.css";
import workspaceItemRowStyles from "./WorkspaceItemRow.module.css";
import { WorkspaceItemRow, WorkspaceItemRowToolbar } from "./WorkspaceItemRow.tsx";
import { decodeRefName } from "#ui/api/ref-name.ts";
import { OperationTarget } from "#ui/routes/project/$id/workspace/OperationTarget.tsx";
import { OperationSourceC } from "#ui/routes/project/$id/workspace/OperationSourceC.tsx";
import { getDependencyCommitIds, getHunkDependencyDiffsByPath } from "#ui/hunk.ts";
import { DependencyIndicatorButton } from "#ui/routes/project/$id/workspace/DependencyIndicatorButton.tsx";

export const FilesPanel: FC<
	{
		onAbsorbChanges: (target: AbsorptionTarget) => void;
	} & PanelProps
> = ({ onAbsorbChanges, ...panelProps }) => {
	const { id: projectId } = useParams({ from: "/project/$id/workspace" });

	const outlineSelection = useAppSelector((state) =>
		selectProjectSelectionOutline(state, projectId),
	);

	return (
		<Suspense fallback={<Panel {...panelProps}>Loading files…</Panel>}>
			{Match.value(outlineSelection).pipe(
				Match.tag("Commit", (commit) => (
					<FilesTreePanel {...panelProps}>
						<CommitFiles
							projectId={projectId}
							commitId={commit.commitId}
							parentCommitOperand={commit}
						/>
					</FilesTreePanel>
				)),
				Match.tag("ChangesSection", () => (
					<FilesTreePanel {...panelProps}>
						<ChangesFiles projectId={projectId} onAbsorbChanges={onAbsorbChanges} />
					</FilesTreePanel>
				)),
				Match.tag("Branch", ({ stackId, branchRef }) => (
					<FilesTreePanel {...panelProps}>
						<BranchFiles projectId={projectId} branchRef={branchRef} stackId={stackId} />
					</FilesTreePanel>
				)),
				Match.orElse(() => <Panel {...panelProps} />),
			)}
		</Suspense>
	);
};

const FilesTreePanel: FC<PanelProps> = ({ className, children, ...panelProps }) => {
	const { id: projectId } = useParams({ from: "/project/$id/workspace" });

	const outlineSelection = useAppSelector((state) =>
		selectProjectSelectionOutline(state, projectId),
	);
	const selection = useAppSelector((state) => selectProjectSelectionFiles(state, projectId));

	return (
		<Panel
			{...panelProps}
			tabIndex={0}
			role="tree"
			aria-activedescendant={treeItemId(selection)}
			className={classes(className, styles.tree)}
		>
			<TreeItem
				projectId={projectId}
				operand={outlineSelection}
				label="All changes"
				expanded
				className={workspaceItemRowStyles.section}
			>
				<ItemRow projectId={projectId} operand={outlineSelection}>
					<div
						className={classes(
							workspaceItemRowStyles.itemRowLabel,
							workspaceItemRowStyles.sectionLabel,
						)}
					>
						All changes
					</div>
				</ItemRow>

				{children}
			</TreeItem>
		</Panel>
	);
};

const useIsSelected = ({ projectId, operand }: { projectId: string; operand: Operand }): boolean =>
	useAppSelector((state) => {
		const selection = selectProjectSelectionFiles(state, projectId);

		return operandEquals(selection, operand);
	});

const treeItemId = (operand: Operand): string =>
	`files-treeitem-${encodeURIComponent(operandIdentityKey(operand))}`;

const changeLabel = (change: TreeChange) => {
	const status = Match.value(change.status).pipe(
		Match.when({ type: "Addition" }, () => "A"),
		Match.when({ type: "Deletion" }, () => "D"),
		Match.when({ type: "Modification" }, () => "M"),
		Match.when({ type: "Rename" }, () => "R"),
		Match.exhaustive,
	);

	return `${status} ${change.path}`;
};

const CommitFiles: FC<{
	projectId: string;
	commitId: string;
	parentCommitOperand: CommitOperand;
}> = ({ projectId, commitId, parentCommitOperand }) => {
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
		return <div className={workspaceItemRowStyles.itemRowEmpty}>No file changes.</div>;

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
				<div role="group">
					{data.changes.map((change) => (
						<TreeChangeRow
							operand={fileOperand({
								parent: commitFileParent(parentCommitOperand),
								path: change.path,
							})}
							key={change.path}
							change={change}
							projectId={projectId}
						/>
					))}
				</div>
			)}
		</>
	);
};

const ChangesFiles: FC<{
	projectId: string;
	onAbsorbChanges: (target: AbsorptionTarget) => void;
}> = ({ projectId, onAbsorbChanges }) => {
	const { data: worktreeChanges } = useSuspenseQuery(changesInWorktreeQueryOptions(projectId));

	const hunkDependencyDiffsByPath = getHunkDependencyDiffsByPath(
		worktreeChanges.dependencies?.diffs ?? [],
	);

	return worktreeChanges.changes.length === 0 ? (
		<div className={workspaceItemRowStyles.itemRowEmpty}>No changes.</div>
	) : (
		<div role="group">
			{worktreeChanges.changes.map((change) => {
				const hunkDependencyDiffs = hunkDependencyDiffsByPath.get(change.path);
				const dependencyCommitIds = hunkDependencyDiffs
					? getDependencyCommitIds({ hunkDependencyDiffs })
					: undefined;

				return (
					<ChangesFileRow
						key={change.path}
						change={change}
						dependencyCommitIds={dependencyCommitIds}
						onAbsorbChanges={onAbsorbChanges}
						projectId={projectId}
					/>
				);
			})}
		</div>
	);
};

const BranchFiles: FC<{
	projectId: string;
	stackId: string;
	branchRef: Array<number>;
}> = ({ projectId, stackId, branchRef }) => {
	const decodedBranchRef = decodeRefName(branchRef);
	const { data: branchDiff } = useSuspenseQuery(
		branchDiffQueryOptions({ projectId, branch: decodedBranchRef }),
	);

	return branchDiff.changes.length === 0 ? (
		<div className={workspaceItemRowStyles.itemRowEmpty}>No changes.</div>
	) : (
		<div role="group">
			{branchDiff.changes.map((change) => (
				<TreeChangeRow
					operand={fileOperand({
						parent: branchFileParent({ stackId, branchRef }),
						path: change.path,
					})}
					key={change.path}
					change={change}
					projectId={projectId}
				/>
			))}
		</div>
	);
};

const ItemRow: FC<
	{
		projectId: string;
		operand: Operand;
	} & Omit<ComponentProps<typeof WorkspaceItemRow>, "inert" | "isSelected">
> = ({ projectId, operand, onClick, ...props }) => {
	const dispatch = useAppDispatch();
	const isSelected = useIsSelected({ projectId, operand });

	return (
		<WorkspaceItemRow
			{...props}
			isSelected={isSelected}
			onClick={(event) => {
				onClick?.(event);
				if (!event.defaultPrevented)
					dispatch(projectActions.selectFiles({ projectId, selection: operand }));
			}}
		/>
	);
};

const TreeItem: FC<
	{
		projectId: string;
		operand: Operand;
		label: string;
		expanded?: boolean;
	} & useRender.ComponentProps<"div">
> = ({ projectId, operand, label, expanded, render, ...props }) => {
	const isSelected = useIsSelected({ projectId, operand });

	return useRender({
		render,
		defaultTagName: "div",
		props: mergeProps<"div">(props, {
			id: treeItemId(operand),
			role: "treeitem",
			"aria-label": label,
			"aria-selected": isSelected,
			"aria-expanded": expanded,
		}),
	});
};

const OperandC: FC<
	{
		projectId: string;
		operand: Operand;
	} & useRender.ComponentProps<"div">
> = ({ projectId, operand, render, ...props }) => {
	const isSelected = useIsSelected({ projectId, operand });

	return useRender({
		render: (
			<OperationSourceC
				projectId={projectId}
				source={operand}
				render={
					<OperationTarget
						projectId={projectId}
						operand={operand}
						isSelected={isSelected}
						render={render}
					/>
				}
			/>
		),
		defaultTagName: "div",
		props,
	});
};

const TreeChangeRow: FC<{
	change: TreeChange;
	operand: Operand;
	projectId: string;
}> = ({ change, operand, projectId }) => (
	<TreeItem
		projectId={projectId}
		operand={operand}
		label={changeLabel(change)}
		render={
			<OperandC
				projectId={projectId}
				operand={operand}
				render={<ItemRow projectId={projectId} operand={operand} />}
			/>
		}
	>
		<div className={workspaceItemRowStyles.itemRowLabel}>{changeLabel(change)}</div>
	</TreeItem>
);

const ChangesFileRow: FC<{
	change: TreeChange;
	dependencyCommitIds: NonEmptyArray<string> | undefined;
	onAbsorbChanges: (target: AbsorptionTarget) => void;
	projectId: string;
}> = ({ change, dependencyCommitIds, onAbsorbChanges, projectId }) => {
	const operand = fileOperand({ parent: changesFileParent, path: change.path });
	const outlineMode = useAppSelector((state) => selectProjectOutlineModeState(state, projectId));

	const menuItems: Array<NativeMenuItem> = [
		{
			_tag: "Item",
			label: "Absorb",
			onSelect: () => {
				onAbsorbChanges({
					type: "treeChanges",
					subject: {
						changes: [change],
						assignedStackId: null,
					},
				});
			},
		},
	];

	return (
		<TreeItem
			projectId={projectId}
			operand={operand}
			label={changeLabel(change)}
			render={
				<OperandC
					projectId={projectId}
					operand={operand}
					render={<ItemRow projectId={projectId} operand={operand} />}
				/>
			}
		>
			<div
				className={workspaceItemRowStyles.itemRowLabel}
				onContextMenu={(event) => {
					void showNativeContextMenu(event, menuItems);
				}}
			>
				{changeLabel(change)}
			</div>
			{outlineMode._tag === "Default" && (
				<WorkspaceItemRowToolbar aria-label="File actions">
					{dependencyCommitIds && (
						<DependencyIndicatorButton
							projectId={projectId}
							commitIds={dependencyCommitIds}
							render={
								<Toolbar.Button
									type="button"
									className={workspaceItemRowStyles.itemRowToolbarButton}
								/>
							}
						>
							<DependencyIcon />
						</DependencyIndicatorButton>
					)}
					<Toolbar.Button
						type="button"
						className={workspaceItemRowStyles.itemRowToolbarButton}
						aria-label="File menu"
						onClick={(event) => {
							void showNativeMenuFromTrigger(event.currentTarget, menuItems);
						}}
					>
						<MenuTriggerIcon />
					</Toolbar.Button>
				</WorkspaceItemRowToolbar>
			)}
		</TreeItem>
	);
};
