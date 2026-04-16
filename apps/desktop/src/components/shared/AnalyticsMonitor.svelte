<!--
@component
This component keeps the analytics context up-to-date, i.e. the metadata
attached to posthog events.
-->
<script lang="ts">
	import { SETTINGS_SERVICE } from "$lib/settings/appSettings";
	import { SETTINGS } from "$lib/settings/userSettings";
	import { UI_STATE } from "$lib/state/uiState.svelte";
	import { EVENT_CONTEXT } from "$lib/telemetry/eventContext";
	import { inject } from "@gitbutler/core/context";

	const { projectId }: { projectId: string } = $props();

	const uiState = inject(UI_STATE);
	const eventContext = inject(EVENT_CONTEXT);
	const settingsService = inject(SETTINGS_SERVICE);

	const globalState = uiState.global;
	const projectState = $derived(uiState.project(projectId));

	const settings = inject(SETTINGS);

	$effect(() => {
		eventContext.update({
			exclusiveAction: projectState.exclusiveAction.current?.type,
		});
	});

	$effect(() => {
		eventContext.update({
			rulerCount: globalState.rulerCountValue.current,
			useRuler: globalState.useRuler.current,
		});
	});

	$effect(() => {
		eventContext.update({
			zoom: $settings.zoom,
			theme: $settings.theme,
			tabSize: $settings.tabSize,
			defaultCodeEditor: $settings.defaultCodeEditor.schemeIdentifer,
			aiSummariesEnabled: $settings.aiSummariesEnabled,
			diffLigatures: $settings.diffLigatures,
		});
	});

	$effect(() => {
		eventContext.update({
			v3: true,
			rules: $settingsService?.featureFlags.rules,
		});
	});
</script>

<style lang="postcss">
</style>
