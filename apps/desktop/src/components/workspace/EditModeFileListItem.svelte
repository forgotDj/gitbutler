<script lang="ts">
	import { getConflictState } from "$lib/files/conflictEntryPresence";
	import { FILE_SERVICE } from "$lib/files/fileService";
	import { inject } from "@gitbutler/core/context";
	import { FileListItem } from "@gitbutler/ui";
	import { isDefined } from "@gitbutler/ui/utils/typeguards";
	import type { FileInfo } from "$lib/files/file";
	import type { ConflictEntryPresence } from "@gitbutler/but-sdk";
	import type { FileStatus } from "@gitbutler/ui/components/file/types";

	type Props = {
		projectId: string;
		filePath: string;
		pathFirst: boolean;
		fileStatus?: FileStatus;
		conflictHint?: string;
		conflictEntryPresence?: ConflictEntryPresence;
		manuallyResolved: boolean;
		onresolveclick?: () => void;
		oncontextmenu?: (e: MouseEvent) => void;
		onconflictchange?: (conflicted: boolean) => void;
	};

	const {
		projectId,
		filePath,
		pathFirst,
		fileStatus,
		conflictHint,
		conflictEntryPresence,
		manuallyResolved,
		onresolveclick,
		oncontextmenu,
		onconflictchange,
	}: Props = $props();

	const fileService = inject(FILE_SERVICE);

	let workspaceFile = $state<{ data: FileInfo; isLarge: boolean } | undefined>(undefined);

	$effect(() => {
		if (conflictEntryPresence) {
			fileService.readFromWorkspace(filePath, projectId).then((result) => {
				workspaceFile = result;
			});
		}
	});

	const conflictState = $derived.by(() => {
		if (!conflictEntryPresence) return "unknown";
		if (!isDefined(workspaceFile?.data.content)) return "unknown";
		return getConflictState(conflictEntryPresence, workspaceFile.data.content);
	});

	const conflicted = $derived(
		conflictEntryPresence !== undefined && conflictState === "conflicted" && !manuallyResolved,
	);

	$effect(() => {
		onconflictchange?.(conflicted);

		return () => {
			onconflictchange?.(false);
		};
	});
</script>

<div class="file">
	<FileListItem
		{filePath}
		{pathFirst}
		{fileStatus}
		{conflicted}
		clickable={false}
		{onresolveclick}
		{conflictHint}
		{oncontextmenu}
	/>
</div>
