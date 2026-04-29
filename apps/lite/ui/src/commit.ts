export const shortCommitId = (commitId: string): string => commitId.slice(0, 7);

export const commitTitle = (message: string): string => {
	const _title = message.trim().split("\n")[0];
	const title = _title === "" ? undefined : _title;
	return title ?? "(no message)";
};
