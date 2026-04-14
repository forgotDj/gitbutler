import { Commit, HunkAssignment, HunkHeader } from "@gitbutler/but-sdk";

// https://linear.app/gitbutler/issue/GB-1161/refsbranches-should-use-bytes-instead-of-strings
export const decodeRefName = (fullNameBytes: Array<number>): string =>
	new TextDecoder().decode(Uint8Array.from(fullNameBytes));
export const encodeRefName = (fullName: string): Array<number> =>
	Array.from(new TextEncoder().encode(fullName));

export const isTypingTarget = (target: EventTarget | null) => {
	if (!(target instanceof HTMLElement)) return false;
	return (
		target.isContentEditable ||
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement
	);
};

export const getRelative = <T,>(items: Array<T>, index: number, offset: -1 | 1): T | null => {
	const itemCount = items.length;
	if (itemCount === 0) return null;
	return items[(index + offset + itemCount) % itemCount] ?? null;
};

export const formatHunkHeader = (hunk: HunkHeader): string =>
	`-${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines}`;

export const shortCommitId = (commitId: string): string => commitId.slice(0, 7);

export const getAssignmentsByPath = (
	assignments: Array<HunkAssignment>,
	stackId: string | null,
): Map<string, Array<HunkAssignment>> => {
	const byPath = new Map<string, Array<HunkAssignment>>();

	for (const assignment of assignments) {
		if ((assignment.stackId ?? null) !== stackId) continue;

		const pathAssignments = byPath.get(assignment.path);
		if (pathAssignments) pathAssignments.push(assignment);
		else byPath.set(assignment.path, [assignment]);
	}

	return byPath;
};

export const commitTitle = (message: string): string => {
	const _title = message.trim().split("\n")[0];
	const title = _title === "" ? undefined : _title;
	return title ?? "(no message)";
};

export const CommitLabel = ({ commit }: { commit: Commit }) => (
	<>
		{commitTitle(commit.message)}
		{commit.hasConflicts && " ⚠️"}
	</>
);
