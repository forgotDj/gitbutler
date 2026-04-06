import { type FileParent } from "#ui/domain/FileParent.ts";
import { type HunkHeader } from "@gitbutler/but-sdk";

export type OperationSourceRef =
	| { _tag: "Branch"; ref: Array<number> }
	| { _tag: "Commit"; commitId: string }
	| { _tag: "ChangesSection"; stackId: string | null }
	| { _tag: "File"; parent: FileParent; path: string }
	| { _tag: "Hunk"; parent: FileParent; path: string; hunkHeader: HunkHeader };
