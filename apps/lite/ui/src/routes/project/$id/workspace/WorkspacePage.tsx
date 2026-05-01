import { applyBranchMutationOptions } from "#ui/api/mutations.ts";
import {
	absorptionPlanQueryOptions,
	headInfoQueryOptions,
	listBranchesQueryOptions,
	listProjectsQueryOptions,
} from "#ui/api/queries.ts";
import { useActiveElement } from "#ui/focus.ts";
import {
	Panel as PanelType,
	useFocusedProjectPanel,
	useProjectPanelFocusManager,
} from "#ui/panels.ts";
import { isPanelVisible } from "#ui/panels/state.ts";
import {
	projectActions,
	selectProjectPanelsState,
	selectProjectPickerDialogState,
} from "#ui/projects/state.ts";
import { AbsorptionDialog } from "#ui/routes/project/$id/workspace/AbsorptionDialog.tsx";
import { ShortcutsBarPortal, TopBarActionsPortal } from "#ui/portals.tsx";
import { ShortcutButton } from "#ui/ui/ShortcutButton.tsx";
import { useAppDispatch, useAppSelector } from "#ui/store.ts";
import { isInputElement } from "#ui/commands/hotkeys.ts";
import { useMergedRefs } from "@base-ui/utils/useMergedRefs";
import { AbsorptionTarget, BranchListing, Segment, Stack } from "@gitbutler/but-sdk";
import {
	formatForDisplay,
	getHotkeyManager,
	useHotkey,
	useHotkeyRegistrations,
	type HotkeyRegistrationView,
} from "@tanstack/react-hotkeys";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { Match, pipe } from "effect";
import { FC, useState } from "react";
import { Group, Separator, useDefaultLayout } from "react-resizable-panels";
import { branchOperand, type BranchOperand } from "#ui/operands.ts";
import { PickerDialog, type PickerDialogGroup } from "#ui/ui/PickerDialog/PickerDialog.tsx";
import { DetailsPanel } from "./DetailsPanel.tsx";
import { OutlinePanel } from "./OutlinePanel.tsx";
import styles from "./WorkspacePage.module.css";

type HotkeyGroup =
	| "Branch"
	| "Branches"
	| "Changes file"
	| "Changes"
	| "Commit file"
	| "Commit"
	| "Details"
	| "Global"
	| "Outline selection"
	| "Operation mode"
	| "Panels"
	| "Rename branch"
	| "Reword commit"
	| "Stack";

declare module "@tanstack/react-hotkeys" {
	interface HotkeyMeta {
		/**
		 * The component where the hotkey is registered.
		 */
		group: HotkeyGroup;
		/**
		 * @default true
		 *
		 * Whether or not to display the command and/or hotkey in the command palette.
		 */
		commandPalette?: boolean | "hideHotkey";
		/**
		 * @default true
		 *
		 * Whether or not to display the command and associated hotkey in the shortcuts bar.
		 */
		shortcutsBar?: boolean;
	}
}

type CommandPaletteItem = HotkeyRegistrationView & {
	options: { meta: { group: HotkeyGroup; name: string } };
};

const groupCommandPaletteItems = (
	commands: Array<CommandPaletteItem>,
): Array<PickerDialogGroup<CommandPaletteItem>> => {
	const groups = new Map<string, Array<CommandPaletteItem>>();

	for (const command of commands) {
		const groupName = command.options.meta.group;
		const group = groups.get(groupName);
		if (group) group.push(command);
		else groups.set(groupName, [command]);
	}

	return globalThis.Array.from(groups.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([value, items]) => ({
			value,
			items: globalThis.Array.from(items).sort((a, b) =>
				a.options.meta.name.localeCompare(b.options.meta.name),
			),
		}));
};

const CommandPalette: FC<{
	open: boolean;
	onOpenChange: (open: boolean) => void;
}> = ({ open, onOpenChange }) => {
	const { hotkeys } = useHotkeyRegistrations();
	const items = pipe(
		hotkeys
			.filter(
				(hotkey): hotkey is CommandPaletteItem =>
					hotkey.options.enabled !== false &&
					hotkey.options.meta?.name !== undefined &&
					hotkey.options.meta.commandPalette !== false,
			)
			.sort((a, b) => a.options.meta.name.localeCompare(b.options.meta.name)),
		groupCommandPaletteItems,
	);

	const runCommand = (hotkey: CommandPaletteItem) => {
		onOpenChange(false);
		getHotkeyManager().triggerRegistration(hotkey.id);
	};

	return (
		<PickerDialog
			ariaLabel="Command palette"
			closeLabel="Close command palette"
			emptyLabel="No commands found."
			getItemKey={(x) => x.id}
			getItemLabel={(x) => x.options.meta.name}
			getItemType={(x) =>
				x.options.meta.commandPalette !== "hideHotkey" ? formatForDisplay(x.hotkey) : undefined
			}
			items={items}
			open={open}
			onOpenChange={onOpenChange}
			onSelectItem={runCommand}
			placeholder="Search commands…"
		/>
	);
};

type BranchPickerOption = {
	id: string;
	label: string;
	branch: BranchOperand;
};

const segmentToBranchPickerOption = ({
	segment,
	stackId,
}: {
	segment: Segment;
	stackId: string;
}): BranchPickerOption | null => {
	const refName = segment.refName;
	if (!refName) return null;

	return {
		id: JSON.stringify([stackId, refName.fullNameBytes]),
		label: refName.displayName,
		branch: { stackId, branchRef: refName.fullNameBytes },
	};
};

const stackToBranchPickerOptions = (stack: Stack): Array<BranchPickerOption> => {
	// oxlint-disable-next-line typescript/no-non-null-assertion -- [ref:stack-id-required]
	const stackId = stack.id!;
	return stack.segments.flatMap((segment): Array<BranchPickerOption> => {
		const option = segmentToBranchPickerOption({ segment, stackId });
		return option ? [option] : [];
	});
};

const BranchPicker: FC<{
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSelectBranch: (branch: BranchOperand) => void;
	stacks: Array<Stack>;
}> = ({ open, onOpenChange, onSelectBranch, stacks }) => {
	const selectBranch = (option: BranchPickerOption) => {
		onOpenChange(false);
		onSelectBranch(option.branch);
	};

	return (
		<PickerDialog
			ariaLabel="Select branch"
			closeLabel="Close branch picker"
			emptyLabel="No results found."
			getItemKey={(x) => x.id}
			getItemLabel={(x) => x.label}
			getItemType={() => "Branch"}
			itemToStringValue={(x) => x.label}
			items={[
				{
					value: "Branches",
					items: stacks.flatMap(stackToBranchPickerOptions),
				},
			]}
			open={open}
			onOpenChange={onOpenChange}
			onSelectItem={selectBranch}
			placeholder="Search for branches…"
		/>
	);
};

type ApplyBranchPickerOption = {
	branchRef: string;
	label: string;
	type: string;
};

const branchListingToApplyBranchPickerOptions = (
	branch: BranchListing,
): Array<ApplyBranchPickerOption> => {
	if (branch.hasLocal)
		return [
			{
				branchRef: `refs/heads/${branch.name}`,
				label: branch.name,
				type: "Local",
			},
		];

	return branch.remotes.map((remote) => ({
		branchRef: `refs/remotes/${remote}/${branch.name}`,
		label: branch.name,
		type: remote,
	}));
};

const ApplyBranchPicker: FC<{
	open: boolean;
	onOpenChange: (open: boolean) => void;
	projectId: string;
}> = ({ open, onOpenChange, projectId }) => {
	const branchesQuery = useQuery(
		listBranchesQueryOptions({ projectId, filter: { local: null, applied: false } }),
	);
	const items = (branchesQuery.data ?? []).flatMap(branchListingToApplyBranchPickerOptions);
	const applyBranch = useMutation(applyBranchMutationOptions);
	const statusLabel =
		items.length === 0
			? branchesQuery.isPending
				? "Loading branches..."
				: branchesQuery.isError
					? "Unable to load branches."
					: undefined
			: undefined;

	const selectBranch = (option: ApplyBranchPickerOption) => {
		onOpenChange(false);
		applyBranch.mutate({ projectId, existingBranch: option.branchRef });
	};

	return (
		<PickerDialog
			ariaLabel="Apply branch"
			closeLabel="Close apply branch picker"
			emptyLabel="No available branches found."
			getItemKey={(x) => x.branchRef}
			getItemLabel={(x) => x.label}
			getItemType={(x) => x.type}
			itemToStringValue={(x) => x.label}
			items={[
				{
					value: "Available branches",
					items: (branchesQuery.data ?? []).flatMap(branchListingToApplyBranchPickerOptions),
				},
			]}
			open={open}
			onOpenChange={onOpenChange}
			onSelectItem={selectBranch}
			placeholder="Search for branches to apply…"
			statusLabel={statusLabel}
		/>
	);
};

const TopBarActions: FC = () => {
	const dispatch = useAppDispatch();
	const { id: projectId } = useParams({ from: "/project/$id/workspace" });
	const panelsState = useAppSelector((state) => selectProjectPanelsState(state, projectId));
	const focusedPanel = useFocusedProjectPanel(projectId);
	const openApplyBranchPicker = () => {
		dispatch(projectActions.openApplyBranchPicker({ projectId }));
	};
	const toggleDetails = () => {
		if (focusedPanel === "details" && isPanelVisible(panelsState, "details")) {
			const detailsPanelIndex = panelsState.visiblePanels.indexOf("details");
			const nextPanel = panelsState.visiblePanels[detailsPanelIndex - 1];
			if (nextPanel !== undefined)
				document.getElementById(nextPanel)?.focus({ focusVisible: false });
		}

		dispatch(projectActions.togglePanel({ projectId, panel: "details" }));
	};

	const toggleDetailsHotkey = "D";
	const applyBranchHotkey = "Shift+A";

	useHotkey(applyBranchHotkey, openApplyBranchPicker, {
		meta: { group: "Branches", name: "Apply" },
	});

	useHotkey(toggleDetailsHotkey, toggleDetails, {
		meta: { group: "Details", name: isPanelVisible(panelsState, "details") ? "Close" : "Open" },
	});

	return (
		<>
			<ShortcutButton hotkey={applyBranchHotkey} onClick={openApplyBranchPicker}>
				Apply
			</ShortcutButton>
			<ShortcutButton
				hotkey={toggleDetailsHotkey}
				aria-pressed={isPanelVisible(panelsState, "details")}
				onClick={toggleDetails}
			>
				Details
			</ShortcutButton>
		</>
	);
};

const isInputIgnoredHotkey = ({
	activeElement,
	hotkey,
}: {
	activeElement: Element | null;
	hotkey: HotkeyRegistrationView;
}): boolean =>
	hotkey.options.ignoreInputs !== false &&
	isInputElement(activeElement) &&
	activeElement !== hotkey.target;

const ShortcutsBar: FC = () => {
	const { id: projectId } = useParams({ from: "/project/$id/workspace" });
	const focusedPanel = useFocusedProjectPanel(projectId);
	const activeElement = useActiveElement();
	const { hotkeys } = useHotkeyRegistrations();
	const visibleHotkeys = hotkeys.filter(
		(hotkey) =>
			hotkey.options.enabled !== false &&
			!isInputIgnoredHotkey({ activeElement, hotkey }) &&
			hotkey.options.meta?.name !== undefined &&
			hotkey.options.meta.shortcutsBar !== false,
	);

	if (visibleHotkeys.length === 0) return null;

	return (
		<div className={styles.shortcutsBarContainer}>
			<span className={styles.shortcutsBarScope}>{focusedPanel ?? "Shortcuts"}</span>
			{visibleHotkeys.map((hotkey) => (
				<div key={hotkey.id} className={styles.shortcutsBarItem}>
					<kbd className={styles.shortcutsBarKeys}>{formatForDisplay(hotkey.hotkey)}</kbd>
					<span>{hotkey.options.meta?.name}</span>
				</div>
			))}
		</div>
	);
};

const usePanelsHotkeys = ({
	focusedPanel,
	focusAdjacentPanel,
}: {
	focusedPanel: PanelType | null;
	focusAdjacentPanel: (offset: -1 | 1) => void;
}) => {
	useHotkey(
		"H",
		() => {
			focusAdjacentPanel(-1);
		},
		{
			enabled: focusedPanel !== null,
			meta: { group: "Panels", name: "Focus previous panel", commandPalette: false },
		},
	);

	useHotkey(
		"L",
		() => {
			focusAdjacentPanel(1);
		},
		{
			enabled: focusedPanel !== null,
			meta: { group: "Panels", name: "Focus next panel", commandPalette: false },
		},
	);
};

const WorkspacePage: FC = () => {
	const dispatch = useAppDispatch();

	const { id: projectId } = useParams({ from: "/project/$id/workspace" });

	const pickerDialog = useAppSelector((state) => selectProjectPickerDialogState(state, projectId));
	const panelsState = useAppSelector((state) => selectProjectPanelsState(state, projectId));
	const { focusAdjacentPanel, focusPanel, panelElementRef } = useProjectPanelFocusManager();
	const focusedPanel = useFocusedProjectPanel(projectId);

	const [absorptionTarget, setAbsorptionTarget] = useState<AbsorptionTarget | null>(null);

	const queryClient = useQueryClient();
	const openAbsorptionDialog = (target: AbsorptionTarget) => {
		// Before opening the dialog, warm cache to avoid showing loading states in
		// the dialog itself. This also ensures we don't show a stale absorption
		// plan whilst the dialog revalidates.
		void queryClient.prefetchQuery(absorptionPlanQueryOptions({ projectId, target })).then(() => {
			setAbsorptionTarget(target);
		});
	};

	useHotkey(
		"Mod+K",
		() => {
			if (pickerDialog._tag === "CommandPalette")
				dispatch(projectActions.closePickerDialog({ projectId }));
			else dispatch(projectActions.openCommandPalette({ projectId, focusedPanel }));
		},
		{
			conflictBehavior: "allow",
			meta: { group: "Global", name: "Command palette", commandPalette: false },
		},
	);

	usePanelsHotkeys({ focusedPanel, focusAdjacentPanel });

	const { defaultLayout, onLayoutChanged } = useDefaultLayout({
		id: `project:${projectId}:layout`,
		panelIds: panelsState.visiblePanels,
	});

	// TODO: handle project not found error. or only run when project is not null? waterfall.
	const { data: headInfo } = useSuspenseQuery(headInfoQueryOptions(projectId));

	const selectBranch = (branch: BranchOperand) => {
		dispatch(
			projectActions.select({
				projectId,
				selection: branchOperand(branch),
			}),
		);
		focusPanel("outline");
	};

	const setBranchPickerOpen = (open: boolean) => {
		if (open) dispatch(projectActions.openBranchPicker({ projectId }));
		else dispatch(projectActions.closePickerDialog({ projectId }));
	};

	const setApplyBranchPickerOpen = (open: boolean) => {
		if (open) dispatch(projectActions.openApplyBranchPicker({ projectId }));
		else dispatch(projectActions.closePickerDialog({ projectId }));
	};

	const setCommandPaletteOpen = (open: boolean) => {
		if (open) dispatch(projectActions.openCommandPalette({ projectId, focusedPanel }));
		else dispatch(projectActions.closePickerDialog({ projectId }));
	};

	return (
		<>
			<TopBarActionsPortal>
				<TopBarActions />
			</TopBarActionsPortal>

			<ShortcutsBarPortal>
				<ShortcutsBar />
			</ShortcutsBarPortal>

			<Group className={styles.page} defaultLayout={defaultLayout} onLayoutChange={onLayoutChanged}>
				<OutlinePanel
					className={styles.panel}
					elementRef={useMergedRefs(panelElementRef("outline"), (el) =>
						el?.focus({ focusVisible: false }),
					)}
					focusPanel={focusPanel}
					onAbsorbChanges={openAbsorptionDialog}
				/>
				{isPanelVisible(panelsState, "details") && (
					<>
						<Separator className={styles.panelResizeHandle} />
						<DetailsPanel
							className={styles.panel}
							elementRef={panelElementRef("details")}
							focusPanel={focusPanel}
						/>
					</>
				)}
			</Group>

			{absorptionTarget && (
				<AbsorptionDialog
					projectId={projectId}
					target={absorptionTarget}
					onOpenChange={(open) => {
						if (!open) setAbsorptionTarget(null);
					}}
				/>
			)}

			{Match.value(pickerDialog).pipe(
				Match.tagsExhaustive({
					None: () => null,
					ApplyBranchPicker: () => (
						<ApplyBranchPicker open onOpenChange={setApplyBranchPickerOpen} projectId={projectId} />
					),
					BranchPicker: () => (
						<BranchPicker
							open
							onOpenChange={setBranchPickerOpen}
							onSelectBranch={selectBranch}
							stacks={headInfo.stacks}
						/>
					),
					CommandPalette: () => <CommandPalette open onOpenChange={setCommandPaletteOpen} />,
				}),
			)}
		</>
	);
};

export const Route: FC = () => {
	const { id: projectId } = useParams({ from: "/project/$id/workspace" });

	const { data: projects } = useSuspenseQuery(listProjectsQueryOptions);
	const project = projects.find((project) => project.id === projectId);
	if (!project) return <p>Project not found.</p>;

	return <WorkspacePage />;
};
