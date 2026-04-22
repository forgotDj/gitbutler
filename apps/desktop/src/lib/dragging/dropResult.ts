import { showError } from "$lib/error/showError";
import { showToast } from "$lib/notifications/toasts";
import type { UiState } from "$lib/state/uiState.svelte";
import type { RejectionReason } from "@gitbutler/but-sdk";

/**
 * Structured result from a drop handler operation.
 * Returned by handlers to communicate feedback to the user via a unified channel.
 */
export type DropResult =
	| { type: "ok" }
	| { type: "warning"; title: string; message: string; testId?: string }
	| { type: "error"; title: string; error: unknown }
	| {
			type: "rejectedChanges";
			projectId: string;
			newCommitId?: string;
			commitTitle?: string;
			targetBranchName: string;
			pathsToRejectedChanges: Record<string, RejectionReason>;
	  };

/**
 * Processes a `DropResult` by dispatching to the appropriate feedback channel
 * (toast for warnings/errors, modal for rejected changes).
 */
export function handleDropResult(result: DropResult, uiState: UiState): void {
	switch (result.type) {
		case "ok":
			break;
		case "warning":
			showToast({
				style: "warning",
				title: result.title,
				message: result.message,
				testId: result.testId,
			});
			break;
		case "error":
			showError(result.title, result.error);
			break;
		case "rejectedChanges":
			uiState.global.modal.set({
				type: "commit-failed",
				projectId: result.projectId,
				targetBranchName: result.targetBranchName,
				newCommitId: result.newCommitId,
				commitTitle: result.commitTitle,
				pathsToRejectedChanges: result.pathsToRejectedChanges,
			});
			break;
	}
}
