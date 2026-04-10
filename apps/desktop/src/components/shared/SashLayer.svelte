<script lang="ts">
	import { SASH_LAYER } from "$lib/sash/sashLayer";
	import { setContext } from "svelte";
	import type { SashLayerContext } from "$lib/sash/sashLayer";
	import type { Snippet } from "svelte";

	interface Props {
		children: Snippet;
	}

	const { children }: Props = $props();

	// $state makes the object's properties reactive — any descendant $effect
	// that reads ctx.container will re-run when the container div mounts.
	const ctx: SashLayerContext = $state({ container: undefined });
	setContext(SASH_LAYER, ctx);
</script>

<div class="sash-layer">
	{@render children()}
	<!--
		The sash-container sits on top of all pane content as a
		pointer-events-none overlay. Individual resizers teleport into it
		so they are never clipped by overflow:hidden on pane wrappers.
	-->
	<div class="sash-container" bind:this={ctx.container}></div>
</div>

<style lang="postcss">
	.sash-layer {
		position: relative;
		min-width: 0;
		min-height: 0;
		height: 100%;
	}

	/* Full-size overlay; only individual resizer children re-enable pointer events. */
	.sash-container {
		z-index: var(--z-floating);
		position: absolute;
		inset: 0;
		pointer-events: none;
	}
</style>
