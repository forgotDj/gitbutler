/**
 * @file Known rewritten commit IDs and branch names are handled separately before reaching this
 * module.
 */

import { useQuery } from "@tanstack/react-query";
import { headInfoQueryOptions } from "./api/queries.ts";
import { useParams } from "@tanstack/react-router";
import { getHeadInfoIndex, type HeadInfoIndex } from "./api/ref-info.ts";
import { useEffectEvent, useLayoutEffect, useRef } from "react";
import { useAppDispatch, useAppSelector } from "./store.ts";
import { projectSlice } from "./projects/state.ts";
import { commitOperand } from "./operands.ts";

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
	const prevHeadInfoIndexRef = useRef<HeadInfoIndex>(null);

	const dispatch = useAppDispatch();

	const outlineSelection = useAppSelector((state) =>
		projectSlice.selectors.selectPrimaryOutlineSelection(state, projectId),
	);
	const reconcileSelectedCommit = useEffectEvent(
		(headInfoIndex: HeadInfoIndex, prevHeadInfoIndex: HeadInfoIndex | null) => {
			if (outlineSelection?._tag !== "Commit") return;

			const curr = headInfoIndex.commitContextById(outlineSelection.commitId);
			if (curr) return;

			const prev = prevHeadInfoIndex?.commitContextById(outlineSelection.commitId);
			// Change IDs are not necessarily globally unique, but typically will be. In any case this is
			// a best-effort fallback.
			const commitId = prev
				? headInfoIndex.commitContextById(prev.commit.changeId)?.commit.id
				: null;

			dispatch(
				projectSlice.actions.selectOutline({
					projectId,
					selection: commitId != null ? commitOperand({ commitId }) : null,
				}),
			);
		},
	);

	const checkedOperands = useAppSelector((state) =>
		projectSlice.selectors.selectCheckedOperands(state, projectId),
	);
	const reconcileCheckedOperands = useEffectEvent((headInfoIndex: HeadInfoIndex) => {
		const invalidated = checkedOperands.filter(
			(operand) => !headInfoIndex.commitContextById(operand.commitId),
		);

		if (invalidated.length > 0) {
			dispatch(
				projectSlice.actions.checkOperands({ projectId, operands: invalidated, checked: false }),
			);
		}
	});

	useLayoutEffect(() => {
		if (!headInfoIndex) return;

		reconcileCheckedOperands(headInfoIndex);
		reconcileSelectedCommit(headInfoIndex, prevHeadInfoIndexRef.current);

		prevHeadInfoIndexRef.current = headInfoIndex;
	}, [headInfoIndex]);
};
