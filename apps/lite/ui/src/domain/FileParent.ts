/** @public */
export type CommitFileParent = { commitId: string };

export type FileParent = ({ _tag: "Commit" } & CommitFileParent) | { _tag: "ChangesSection" };

/** @public */
export const commitFileParent = ({ commitId }: CommitFileParent): FileParent => ({
	_tag: "Commit",
	commitId,
});

/** @public */
export const changesSectionFileParent: FileParent = {
	_tag: "ChangesSection",
};
