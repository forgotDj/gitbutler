<script lang="ts" module>
	export interface Props {
		/**
		 * The label to display; copying is up to the caller's `onclick`
		 */
		text: string;
		/**
		 * Optional prefix to display before the text (e.g., "upstream")
		 */
		prefix?: string;
		/**
		 * Callback when the button is clicked
		 */
		onclick?: () => void;
		/**
		 * Additional CSS classes
		 */
		class?: string;
	}
</script>

<script lang="ts">
	import Icon from "$components/Icon.svelte";

	const { text, prefix, onclick, class: className }: Props = $props();
</script>

<button type="button" class="copy-btn underline-dotted {className}" {onclick}>
	<span>
		{#if prefix}{prefix}
		{/if}{text}
	</span>
	<Icon name="copy" size={14} />
</button>

<style lang="postcss">
	.copy-btn {
		display: flex;
		align-items: center;
		transition: color var(--transition-fast);

		& span {
			margin-right: 2px;
			text-align: left;
		}
	}
</style>
