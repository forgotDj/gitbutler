/** @public */
export type CommitFileParent = { commitId: string };
/** @public */
export type ChangesSectionFileParent = { stackId: string | null };

export type FileParent =
	| ({ _tag: "Commit" } & CommitFileParent)
	| ({ _tag: "ChangesSection" } & ChangesSectionFileParent);

/** @public */
export const commitFileParent = ({ commitId }: CommitFileParent): FileParent => ({
	_tag: "Commit",
	commitId,
});

/** @public */
export const changesSectionFileParent = ({ stackId }: ChangesSectionFileParent): FileParent => ({
	_tag: "ChangesSection",
	stackId,
});
