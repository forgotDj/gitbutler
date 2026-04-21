<script lang="ts">
	import { ContextMenu, ContextMenuItem, ContextMenuSection } from "@gitbutler/ui";
	import type { RuleFilterType } from "$lib/rules/rule";

	type Props = {
		addedFilterTypes: RuleFilterType[];
		addFromFilter: (type: RuleFilterType) => void;
		addEmpty?: () => void;
		trigger?: HTMLElement;
	};

	const { addFromFilter, trigger, addEmpty, addedFilterTypes }: Props = $props();

	let menuOpen = $state(false);
	let menuTarget = $state<MouseEvent>();

	function filterHasBeenAdded(type: RuleFilterType): boolean {
		return addedFilterTypes.includes(type);
	}

	function handleAddFilter(type: RuleFilterType) {
		addFromFilter(type);
		menuOpen = false;
	}

	function handleAddEmpty() {
		addEmpty?.();
		menuOpen = false;
	}

	export function toggle(e: MouseEvent) {
		menuOpen = !menuOpen;
		menuTarget = e;
	}
</script>

{#if menuOpen}
	<ContextMenu
		target={menuTarget ?? trigger}
		leftClickTrigger={trigger}
		onclose={() => {
			menuOpen = false;
		}}
	>
		<ContextMenuSection>
			<ContextMenuItem
				icon="folder"
				label="File or folder path"
				disabled={filterHasBeenAdded("pathMatchesRegex")}
				onclick={() => {
					handleAddFilter("pathMatchesRegex");
				}}
			/>
			<ContextMenuItem
				icon="text-contain"
				label="Contains text"
				disabled={filterHasBeenAdded("contentMatchesRegex")}
				onclick={() => {
					handleAddFilter("contentMatchesRegex");
				}}
			/>
			<ContextMenuItem
				icon="file-diff"
				label="Change type (coming soon)"
				disabled={filterHasBeenAdded("fileChangeType") || true}
				onclick={() => {
					handleAddFilter("fileChangeType");
				}}
			/>
			<ContextMenuItem
				icon="tag"
				label="Work category (coming soon)"
				disabled={filterHasBeenAdded("semanticType") || true}
				onclick={() => {
					handleAddFilter("semanticType");
				}}
			/>
		</ContextMenuSection>
		{#if addEmpty}
			<ContextMenuSection>
				<ContextMenuItem icon="arrow-right" label="Stage all to branch" onclick={handleAddEmpty} />
			</ContextMenuSection>
		{/if}
	</ContextMenu>
{/if}
