<script lang="ts" module>
	export type AddDependentBranchModalProps = {
		projectId: string;
		stackId: string;
	};
</script>

<script lang="ts">
	import { STACK_SERVICE } from '$lib/stacks/stackService.svelte';
	import { TestId } from '$lib/testing/testIds';
	import { inject } from '@gitbutler/shared/context';
	import { Button, Modal, Textbox } from '@gitbutler/ui';
	import { slugify } from '@gitbutler/ui/utils/string';

	const { projectId, stackId }: AddDependentBranchModalProps = $props();

	const stackService = inject(STACK_SERVICE);
	const [createNewBranch, branchCreation] = stackService.newBranch;

	let modal = $state<Modal>();
	let branchName = $state<string>();

	const slugifiedRefName = $derived(branchName && slugify(branchName));

	async function handleAddDependentBranch(close: () => void) {
		if (!slugifiedRefName) return;

		await createNewBranch({
			projectId,
			stackId,
			request: {
				targetPatch: undefined,
				name: slugifiedRefName
			}
		});

		close();
	}

	export function show() {
		modal?.show();
	}
</script>

<Modal
	testId={TestId.BranchHeaderAddDependanttBranchModal}
	bind:this={modal}
	width="small"
	title="Add dependent branch"
	onSubmit={handleAddDependentBranch}
>
	<div class="content-wrap">
		<Textbox placeholder="Branch name" bind:value={branchName} autofocus />
	</div>
	{#snippet controls(close)}
		<Button kind="outline" type="reset" onclick={close}>Cancel</Button>
		<Button
			testId={TestId.BranchHeaderAddDependanttBranchModal_ActionButton}
			style="pop"
			type="submit"
			disabled={!slugifiedRefName}
			loading={branchCreation.current.isLoading}>Add branch</Button
		>
	{/snippet}
</Modal>
