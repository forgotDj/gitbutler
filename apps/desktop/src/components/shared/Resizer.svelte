<script lang="ts">
	import { RESIZE_SYNC } from "$lib/floating/resizeSync";
	import { SASH_LAYER } from "$lib/sash/sashLayer";
	import { SETTINGS } from "$lib/settings/userSettings";
	import { inject } from "@gitbutler/core/context";
	import { persistWithExpiration } from "@gitbutler/shared/persisted";
	import { mergeUnlisten } from "@gitbutler/ui/utils/mergeUnlisten";
	import { pxToRem, remToPx } from "@gitbutler/ui/utils/pxToRem";
	import { getContext } from "svelte";
	import { on } from "svelte/events";
	import { writable } from "svelte/store";
	import type { ResizeGroup } from "$lib/floating/resizeGroup";
	import type { SashLayerContext } from "$lib/sash/sashLayer";

	interface Props {
		/** Default value */
		defaultValue: number | undefined;
		/** The element that is being resized */
		viewport: HTMLElement;
		/** Sets direction of resizing for viewport */
		direction: "left" | "right" | "up" | "down";
		/** Custom z-index in case of overlapping with other elements */
		zIndex?: string;
		/** Other resizers with the same name will receive same updates. */
		syncName?: string;
		/** Name under which the latest width is stored. */
		persistId?: string;
		/** Minimum width for the resizable element */
		minWidth?: number;
		maxWidth?: number;
		maxHeight?: number;
		minHeight?: number;
		/** Enabled, but does not set the width/height on the dom element */
		passive?: boolean;
		/** Whether the resizer is disabled */
		disabled?: boolean;
		/** Whether to show the resizer border */
		showBorder?: boolean;
		/** Optional manager that can coordinate multiple resizers */
		resizeGroup?: ResizeGroup;
		/** Optional ordering of resizer for use with `resizeManager` */
		order?: number;
		/** Unset max height */
		unsetMaxHeight?: string;
		/** Optional visual offset from the viewport edge used to place the sash */
		edgeOffsetRem?: number;

		// Actions
		onHeight?: (height: number) => void;
		onWidth?: (width: number) => void;
		onResizing?: (isResizing: boolean) => void;
		onOverflow?: (value: number) => void;
		onDblClick?: () => void;
	}

	let {
		defaultValue,
		viewport,
		direction,
		zIndex = "var(--z-lifted)",
		minWidth = 0,
		maxWidth = 120,
		minHeight = 0,
		maxHeight = 120,
		syncName,
		persistId,
		passive,
		disabled,
		showBorder = false,
		resizeGroup,
		order,
		unsetMaxHeight,
		edgeOffsetRem = 0,
		onResizing,
		onOverflow,
		onDblClick,
		onWidth,
	}: Props = $props();

	const orientation = $derived(["left", "right"].includes(direction) ? "horizontal" : "vertical");
	const userSettings = inject(SETTINGS);
	const resizeSync = inject(RESIZE_SYNC);
	const zoom = $derived($userSettings.zoom);

	const value = $derived(
		persistId
			? persistWithExpiration(defaultValue, persistId, 1440)
			: writable<number | undefined>(defaultValue),
	);

	const resizerId = Symbol();

	// When a SashLayer ancestor is present the resizer teleports into its
	// sash-container so it escapes overflow:hidden on pane wrappers. The
	// SashLayer must be scoped to the same scroll context as the viewport
	// so that getBoundingClientRect differences remain scroll-invariant.
	const layerCtx = getContext<SashLayerContext | undefined>(SASH_LAYER);
	let inLayer = $state(false);

	let initial = 0;
	let isResizing = $state(false);
	let resizerDiv = $state<HTMLDivElement>();
	let pointerMoveRaf: number | undefined;
	let pendingPointerMove:
		| {
				clientX: number;
				clientY: number;
				shiftKey: boolean;
		  }
		| undefined;

	let unsubUp: () => void;
	let unsubMove: () => void;

	// Last pointer position tracked per-drag-frame for arithmetic sash movement.
	let lastDragClientX = 0;
	let lastDragClientY = 0;

	function onMouseDown(e: MouseEvent) {
		e.stopPropagation();
		e.preventDefault();
		unsubUp = on(document, "pointerup", onMouseUp);
		unsubMove = on(document, "pointermove", onMouseMove);

		if (direction === "right") initial = e.clientX - viewport.clientWidth;
		if (direction === "left") initial = window.innerWidth - e.clientX - viewport.clientWidth;
		if (direction === "down") initial = e.clientY - viewport.clientHeight;
		if (direction === "up") initial = window.innerHeight - e.clientY - viewport.clientHeight;

		// Capture starting pointer position for drag-delta sash movement.
		lastDragClientX = e.clientX;
		lastDragClientY = e.clientY;

		onResizing?.(true);
	}

	function applyLimits(value: number) {
		let newValue: number;
		let overflow: number;
		switch (direction) {
			case "down":
				newValue = Math.min(Math.max(value, minHeight), maxHeight);
				overflow = minHeight - value;
				break;
			case "up":
				newValue = Math.min(Math.max(value, minHeight), maxHeight);
				overflow = minHeight - value;
				break;
			case "right":
				newValue = Math.min(Math.max(value, minWidth), maxWidth);
				overflow = minWidth - value;
				break;
			case "left":
				newValue = Math.min(Math.max(value, minWidth), maxWidth);
				overflow = minWidth - value;
				break;
		}

		return { newValue, overflow };
	}

	function processPointerMove() {
		const move = pendingPointerMove;
		if (!move) {
			return;
		}

		pendingPointerMove = undefined;
		let offsetPx: number | undefined;
		switch (direction) {
			case "down":
				offsetPx = move.clientY - initial;
				break;
			case "up":
				offsetPx = document.body.scrollHeight - move.clientY - initial;
				break;
			case "right":
				offsetPx = move.clientX - initial;
				break;
			case "left":
				offsetPx = document.body.scrollWidth - move.clientX - initial;
				break;
		}

		const offsetRem = pxToRem(offsetPx, zoom);

		// Presence of a resize group means we hand off the rest of the
		// handling of this event.
		if (resizeGroup) {
			const subtracted = resizeGroup.resize(resizerId, offsetRem);
			// The initial offset needs to be adjusted if an adjustment
			// means the whole resizer has moved.
			initial = initial - remToPx(subtracted, zoom);
			return;
		}

		const { newValue, overflow } = applyLimits(offsetRem);

		if (newValue && !passive && !disabled) {
			// Fast path when the handle lives in a SashLayer and is NOT part of a
			// resize group: move the sash div by the pointer delta (pure arithmetic,
			// zero getBoundingClientRect calls during drag).  Geometry is re-synced
			// once on mouse-up via requestLayout.
			if (inLayer && !resizeGroup && resizerDiv) {
				const dx = move.clientX - lastDragClientX;
				const dy = move.clientY - lastDragClientY;
				const d = resizerDiv;
				if (orientation === "horizontal") {
					d.style.left = parseFloat(d.style.left || "0") + dx + "px";
				} else {
					d.style.top = parseFloat(d.style.top || "0") + dy + "px";
				}
				// Write viewport size and notify callbacks — no requestLayout here.
				value.set(newValue);
				updateDom(newValue);
				if (newValue !== undefined) onWidth?.(newValue);
			} else {
				setValue(newValue);
			}
		}

		lastDragClientX = move.clientX;
		lastDragClientY = move.clientY;

		if (overflow) {
			onOverflow?.(overflow);
		}
		if (move.shiftKey && syncName && newValue !== undefined && !passive && !disabled) {
			resizeSync.emit(syncName, resizerId, newValue);
		}
	}

	function onMouseMove(e: MouseEvent) {
		isResizing = true;
		pendingPointerMove = {
			clientX: e.clientX,
			clientY: e.clientY,
			shiftKey: e.shiftKey,
		};

		if (pointerMoveRaf !== undefined) {
			return;
		}

		pointerMoveRaf = requestAnimationFrame(() => {
			pointerMoveRaf = undefined;
			processPointerMove();
		});
	}

	function onMouseUp() {
		if (pointerMoveRaf !== undefined) {
			cancelAnimationFrame(pointerMoveRaf);
			pointerMoveRaf = undefined;
		}
		processPointerMove();
		// Re-sync sash to exact geometry once at the end of drag.
		if (inLayer) layerCtx?.requestLayout();
		isResizing = false;
		unsubUp?.();
		unsubMove?.();
		onResizing?.(false);
	}

	function onclick(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
	}

	function updateDom(newValue?: number) {
		if (!viewport) {
			return;
		}
		if (passive || disabled) {
			if (orientation === "horizontal") {
				viewport.style.width = "";
				viewport.style.flexBasis = "";
				viewport.style.flexGrow = "";
				viewport.style.flexShrink = "";
				viewport.style.maxWidth = "";
				viewport.style.minWidth = "";
			} else {
				viewport.style.height = "";
				viewport.style.maxHeight = "";
				viewport.style.minHeight = "";
			}
			return;
		}

		if (newValue !== undefined) {
			newValue = applyLimits(newValue).newValue;
		}

		if (orientation === "horizontal") {
			if (newValue === undefined) {
				viewport.style.width = "";
				// Restore flex behaviour so CSS classes take over again.
				viewport.style.flexBasis = "";
				viewport.style.flexGrow = "";
				viewport.style.flexShrink = "";
				viewport.style.maxWidth = maxWidth ? maxWidth + "rem" : "";
				viewport.style.minWidth = minWidth ? minWidth + "rem" : "";
			} else {
				viewport.style.width = newValue + "rem";
				// Pin flex-basis to the explicit value and lock grow/shrink so
				// the flex algorithm cannot override the user-set width.
				viewport.style.flexBasis = newValue + "rem";
				viewport.style.flexGrow = "0";
				viewport.style.flexShrink = "0";
				viewport.style.maxWidth = "";
				viewport.style.minWidth = "";
			}
		} else {
			if (newValue === undefined) {
				viewport.style.height = "";
				viewport.style.maxHeight = unsetMaxHeight || "";
				viewport.style.minHeight = minHeight ? minHeight + "rem" : "";
			} else {
				viewport.style.height = newValue + "rem";
				viewport.style.maxHeight = "";
				viewport.style.minHeight = "";
			}
		}
	}

	function getValue() {
		if ($value !== undefined) {
			return $value;
		}
		if (orientation === "horizontal") {
			return pxToRem(viewport.clientWidth, zoom);
		}
		return pxToRem(viewport.clientHeight, zoom);
	}

	export function setValue(newValue?: number) {
		const currentValue = getValue();
		if (currentValue === newValue) {
			return;
		}
		value.set(newValue);
		updateDom(newValue);
		if (newValue !== undefined) {
			onWidth?.(newValue);
		}
		layerCtx?.requestLayout();
	}

	$effect(() => {
		if (resizeGroup && order !== undefined) {
			// It's important we do not make use of maxValue in the resize
			// manager, and in this effect. It changes with the value of
			// neighbors and would make this effect trigger constantly.
			return resizeGroup?.register({
				resizerId,
				getValue,
				setValue,
				minValue: minHeight || minWidth,
				position: order,
			});
		}
	});

	$effect(() => {
		if (syncName) {
			const unlistenFns = [];
			unlistenFns.push(
				resizeSync.subscribe({
					key: syncName,
					resizerId,
					callback: setValue,
				}),
			);
			return mergeUnlisten(...unlistenFns);
		}
	});

	$effect(() => {
		if (maxWidth || minWidth || maxHeight || minHeight) {
			updateDom($value);
			if ($value !== undefined) {
				onWidth?.($value);
			}
		}
	});

	// Teleportation effect: move the resizer div into the SashLayer overlay so
	// it is never clipped by overflow:hidden on pane containers. Position is
	// kept in sync via ResizeObserver + window resize + shared per-layer
	// scheduler notifications. No scroll tracking is needed — the SashLayer is
	// always scoped inside the same scroll container as the viewport, so
	// getBoundingClientRect differences are scroll-invariant.
	$effect(() => {
		const container = layerCtx?.container;
		const div = resizerDiv;
		const vp = viewport;
		// Snapshot these so updatePosition closes over stable values. They are
		// read here (inside the effect body) so Svelte tracks them as deps.
		const dir = direction;
		const orient = orientation;
		const edgeOffsetPx = remToPx(edgeOffsetRem, zoom);

		if (!container || !div || !vp) return;

		// Re-bind with narrowed types so closures below satisfy TypeScript.
		// (Type narrowing from if-guards doesn't propagate into nested functions.)
		const c = container;
		const d = div;

		inLayer = true;
		c.appendChild(d);

		function updatePosition(containerRect?: DOMRectReadOnly) {
			const vr = vp.getBoundingClientRect();
			const cr = containerRect ?? c.getBoundingClientRect();
			// 8 px hit area in layer mode (no risk of overlapping scrollbars).
			const t = 8;

			if (orient === "horizontal") {
				const edge = dir === "right" ? vr.right + edgeOffsetPx : vr.left - edgeOffsetPx;
				d.style.left = `${edge - cr.left - t / 2}px`;
				d.style.right = "";
				d.style.top = `${vr.top - cr.top}px`;
				d.style.bottom = "";
				d.style.width = `${t}px`;
				d.style.height = `${vr.height}px`;
			} else {
				const edge = dir === "down" ? vr.bottom + edgeOffsetPx : vr.top - edgeOffsetPx;
				d.style.top = `${edge - cr.top - t / 2}px`;
				d.style.bottom = "";
				d.style.left = `${vr.left - cr.left}px`;
				d.style.right = "";
				d.style.width = `${vr.width}px`;
				d.style.height = `${t}px`;
			}
		}

		updatePosition();

		const ro = new ResizeObserver(() => {
			layerCtx?.requestLayout();
		});
		ro.observe(vp);
		// Also watch the layer wrapper itself so position updates when sibling
		// panes resize (pushing this pane without changing its own size).
		if (c.parentElement) {
			ro.observe(c.parentElement);
		}
		window.addEventListener("resize", layerCtx.requestLayout);
		const unsubscribeLayout = layerCtx.subscribeLayout((containerRect) => {
			updatePosition(containerRect);
		});
		layerCtx.requestLayout();

		return () => {
			inLayer = false;
			ro.disconnect();
			window.removeEventListener("resize", layerCtx.requestLayout);
			unsubscribeLayout?.();
			d.remove();
		};
	});
</script>

<div
	role="presentation"
	bind:this={resizerDiv}
	data-no-drag
	onpointerdown={onMouseDown}
	ondblclick={() => {
		onDblClick?.();
		setValue(defaultValue);
	}}
	{onclick}
	class:disabled
	class="resizer"
	class:in-layer={inLayer}
	class:is-resizing={isResizing}
	class:vertical={orientation === "vertical"}
	class:horizontal={orientation === "horizontal"}
	class:up={direction === "up"}
	class:down={direction === "down"}
	class:left={direction === "left"}
	class:right={direction === "right"}
	class:border={showBorder}
	style:z-index={zIndex}
></div>

<style lang="postcss">
	.resizer {
		--resizer-thickness: 4px;
		--resizer-cursor: default;
		position: absolute;
		outline: none;
		background-color: rgba(255, 0, 0, 0.2);
		cursor: var(--resizer-cursor);

		&.horizontal {
			--resizer-cursor: col-resize;
			top: 0;
			width: var(--resizer-thickness);
			height: 100%;
		}

		&.vertical {
			--resizer-cursor: row-resize;
			left: 0;
			width: 100%;
			height: var(--resizer-thickness);
		}

		&.border.horizontal::after {
			position: absolute;
			top: 0;
			width: 1px;
			height: 100%;
			border-left: 1px solid var(--border-2);
			content: "";
			pointer-events: none;
		}

		&.border.horizontal.left::after {
			left: 0;
		}

		&.border.horizontal.right::after {
			right: 0;
		}

		&.border.vertical::after {
			position: absolute;
			left: 0;
			width: 100%;
			height: 1px;
			border-top: 1px solid var(--border-2);
			content: "";
			pointer-events: none;
		}

		&.border.vertical.up::after {
			top: 0;
		}

		&.border.vertical.down::after {
			bottom: 0;
		}

		&.disabled {
			pointer-events: none;
			--resizer-cursor: default;
		}

		/* When teleported into the SashLayer overlay the container has
		   pointer-events:none, so individual resizers must opt back in. */
		&.in-layer {
			pointer-events: initial;
		}

		&.in-layer.disabled {
			pointer-events: none;
		}

		/* Center the 1 px visual border line in the wider 8 px hit area. */
		&.in-layer.border.horizontal::after {
			right: auto;
			left: calc(50% - 0.5px);
		}

		&.in-layer.border.vertical::after {
			top: calc(50% - 0.5px);
			bottom: auto;
		}
	}
</style>
