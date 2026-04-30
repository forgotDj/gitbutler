import { absorbMutationOptions } from "#ui/api/mutations.ts";
import { absorptionPlanQueryOptions } from "#ui/api/queries.ts";
import { classes } from "#ui/ui/classes.ts";
import { commitTitle, shortCommitId } from "#ui/commit.ts";
import uiStyles from "#ui/ui/ui.module.css";
import { AlertDialog, Toast } from "@base-ui/react";
import { AbsorptionReason, AbsorptionTarget } from "@gitbutler/but-sdk";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { dedupe } from "effect/Array";
import { FC, Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";
import styles from "./AbsorptionDialog.module.css";

const describeAbsorptionReason = (reason: AbsorptionReason): string | null => {
	switch (reason) {
		case "hunk_dependency":
			return "Files depend on this commit due to overlapping hunks.";
		case "stack_assignment":
			return "Files are assigned to this stack.";
		case "default_stack":
			return null;
	}
};

const AbsorptionDialogLoading: FC = () => (
	<>
		<div className={styles.body}>Loading absorption plan…</div>
		<div className={styles.actions}>
			<AlertDialog.Close className={uiStyles.button}>Cancel</AlertDialog.Close>
		</div>
	</>
);

const AbsorptionDialogError: FC = () => (
	<>
		<div className={styles.body}>There was a problem loading the absorption plan.</div>
		<div className={styles.actions}>
			<AlertDialog.Close className={uiStyles.button}>Cancel</AlertDialog.Close>
		</div>
	</>
);

const AbsorptionDialogContent: FC<{
	projectId: string;
	target: AbsorptionTarget;
	closeDialog: () => void;
}> = ({ projectId, target, closeDialog }) => {
	const toastManager = Toast.useToastManager();
	const { data: absorptionPlan } = useSuspenseQuery(
		absorptionPlanQueryOptions({ projectId, target }),
	);
	const absorbMutation = useMutation(absorbMutationOptions);

	const isEmpty = absorptionPlan.length === 0;

	const submitAction = () => {
		absorbMutation.mutate(
			{ projectId, absorptionPlan },
			{
				onSuccess: () => {
					closeDialog();
					toastManager.add({ title: "Changes absorbed successfully" });
				},
			},
		);
	};

	return (
		<form action={submitAction}>
			{isEmpty ? (
				<div className={styles.body}>
					There are no commits available to absorb these changes into.
				</div>
			) : (
				<ul className={styles.body}>
					{absorptionPlan.map((commitAbsorption) => (
						<li key={commitAbsorption.commitId}>
							<dl>
								<dt>Reason</dt>
								<dd>{describeAbsorptionReason(commitAbsorption.reason)}</dd>
								<dt>Commit message</dt>
								<dd>{commitTitle(commitAbsorption.commitSummary)}</dd>
								<dt>Commit ID</dt>
								<dd>
									<code>{shortCommitId(commitAbsorption.commitId)}</code>
								</dd>
								<dt>Paths</dt>
								<dd>
									<ul>
										{dedupe(commitAbsorption.files.map((file) => file.path)).map((path) => (
											<li key={path}>{path}</li>
										))}
									</ul>
								</dd>
							</dl>
						</li>
					))}
				</ul>
			)}
			<div className={styles.actions}>
				<AlertDialog.Close className={uiStyles.button}>Cancel</AlertDialog.Close>
				<button
					type="submit"
					className={uiStyles.button}
					disabled={isEmpty || absorbMutation.isPending}
				>
					Absorb changes
				</button>
			</div>
		</form>
	);
};

export const AbsorptionDialog: FC<{
	projectId: string;
	target: AbsorptionTarget;
	onOpenChange: (open: boolean) => void;
}> = ({ projectId, target, onOpenChange }) => (
	<AlertDialog.Root open onOpenChange={onOpenChange}>
		<AlertDialog.Portal>
			<AlertDialog.Backdrop className={uiStyles.dialogBackdrop} />
			<AlertDialog.Popup className={classes(uiStyles.popup, uiStyles.dialogPopup)}>
				<AlertDialog.Title>Absorb changes</AlertDialog.Title>
				<ErrorBoundary fallback={<AbsorptionDialogError />}>
					<Suspense fallback={<AbsorptionDialogLoading />}>
						<AbsorptionDialogContent
							projectId={projectId}
							target={target}
							closeDialog={() => onOpenChange(false)}
						/>
					</Suspense>
				</ErrorBoundary>
			</AlertDialog.Popup>
		</AlertDialog.Portal>
	</AlertDialog.Root>
);
