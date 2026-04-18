/** @public */
export type CommitFileParent = { commitId: string };
/** @public */
export type ChangesSectionFileParent = { _tag: "ChangesSection" };

export type FileParent = ({ _tag: "Commit" } & CommitFileParent) | ChangesSectionFileParent;

/** @public */
export const commitFileParent = ({ commitId }: CommitFileParent): FileParent => ({
	_tag: "Commit",
	commitId,
});

/** @public */
export const changesSectionFileParent: ChangesSectionFileParent = {
	_tag: "ChangesSection",
};
