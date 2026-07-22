import { useQuery } from "@tanstack/react-query";
import { headInfoQueryOptions } from "./api/queries.ts";
import { useParams } from "@tanstack/react-router";
import { getHeadInfoIndex, type HeadInfoIndex } from "./api/ref-info.ts";
import { useEffectEvent, useLayoutEffect } from "react";
import { useAppDispatch, useAppSelector } from "./store.ts";
import { projectSlice } from "./projects/state.ts";

/**
 * Reconcile state between Redux and React Query. This hook should be called very high up in the
 * tree so that synchronous dispatches in layout effects don't waste too much work. This hook
 * remains subscribed to any queries that are relevant to the current state.
 */
export const useStateReconciler = (): void => {
	const { id: projectId } = useParams({ from: "/project/$id/workspace" });

	const { data: headInfoIndex } = useQuery({
		...headInfoQueryOptions(projectId),
		select: getHeadInfoIndex,
	});

	const dispatch = useAppDispatch();
	const checkedCommitIds = useAppSelector((state) =>
		projectSlice.selectors.selectCheckedCommits(state, projectId),
	);

	const reconcileCheckedCommits = useEffectEvent((headInfoIndex: HeadInfoIndex) => {
		const invalidated = checkedCommitIds
			.values()
			.filter((commitId) => !headInfoIndex.commitContextById(commitId))
			.toArray();

		if (invalidated.length > 0) {
			dispatch(
				projectSlice.actions.checkCommits({ projectId, commitIds: invalidated, checked: false }),
			);
		}
	});

	useLayoutEffect(() => {
		if (!headInfoIndex) return;

		reconcileCheckedCommits(headInfoIndex);
	}, [headInfoIndex]);
};
