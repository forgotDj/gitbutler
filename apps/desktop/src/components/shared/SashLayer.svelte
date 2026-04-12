<script lang="ts">
	import { SASH_LAYER } from "$lib/sash/sashLayer";
	import { onDestroy, setContext } from "svelte";
	import type { SashLayerContext } from "$lib/sash/sashLayer";
	import type { Snippet } from "svelte";

	interface Props {
		children: Snippet;
	}

	const { children }: Props = $props();
	const layoutListeners = new Set<(containerRect: DOMRectReadOnly) => void>();
	let layoutRaf: number | undefined;

	function requestLayout() {
		if (layoutRaf !== undefined) return;
		layoutRaf = requestAnimationFrame(() => {
			layoutRaf = undefined;
			const containerRect = ctx.container?.getBoundingClientRect();
			if (!containerRect) return;
			for (const listener of layoutListeners) {
				listener(containerRect);
			}
		});
	}

	function subscribeLayout(listener: (containerRect: DOMRectReadOnly) => void) {
		layoutListeners.add(listener);
		return () => {
			layoutListeners.delete(listener);
		};
	}

	// $state makes the object's properties reactive — any descendant $effect
	// that reads ctx.container will re-run when the container div mounts.
	const ctx: SashLayerContext = $state({
		container: undefined,
		requestLayout,
		subscribeLayout,
	});
	setContext(SASH_LAYER, ctx);

	onDestroy(() => {
		if (layoutRaf !== undefined) {
			cancelAnimationFrame(layoutRaf);
			layoutRaf = undefined;
		}
		layoutListeners.clear();
	});
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
		flex: 1 1 auto;
		width: 100%;
		min-width: 0;
		height: 100%;
		min-height: 0;
	}

	/* Full-size overlay; only individual resizer children re-enable pointer events. */
	.sash-container {
		z-index: var(--z-floating);
		position: absolute;
		inset: 0;
		pointer-events: none;
	}
</style>
