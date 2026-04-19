import { type FileParent } from "#ui/domain/FileParent.ts";
import { type HunkHeader } from "@gitbutler/but-sdk";
import { Match } from "effect";
import { itemEquals, itemIdentityKey, type Item } from "./Item.ts";

/** @public */
export type FileOperationSource = { parent: FileParent; path: string };
/** @public */
export type HunkOperationSource = { parent: FileParent; path: string; hunkHeader: HunkHeader };

/**
 * The source of an operation before it has been materialized into data that can
 * be sent to the backend (`ResolvedOperationSource`).
 */
export type OperationSource =
	| { _tag: "Item"; item: Item }
	| ({ _tag: "File" } & FileOperationSource)
	| ({ _tag: "Hunk" } & HunkOperationSource);

/** @public */
export const itemOperationSource = (item: Item): OperationSource => ({
	_tag: "Item",
	item,
});

/** @public */
export const fileOperationSource = ({ parent, path }: FileOperationSource): OperationSource => ({
	_tag: "File",
	parent,
	path,
});

/** @public */
export const hunkOperationSource = ({
	parent,
	path,
	hunkHeader,
}: HunkOperationSource): OperationSource => ({
	_tag: "Hunk",
	parent,
	path,
	hunkHeader,
});

const operationSourceIdentityKey = (operationSource: OperationSource): string =>
	Match.value(operationSource).pipe(
		Match.tagsExhaustive({
			Item: ({ item }) => JSON.stringify(["Item", itemIdentityKey(item)]),
			File: ({ parent, path }) => JSON.stringify(["File", parent, path]),
			Hunk: ({ parent, path, hunkHeader }) => JSON.stringify(["Hunk", parent, path, hunkHeader]),
		}),
	);

export const operationSourceEquals = (a: OperationSource, b: OperationSource): boolean =>
	operationSourceIdentityKey(a) === operationSourceIdentityKey(b);

export const operationSourceMatchesItem = (source: OperationSource, item: Item): boolean =>
	Match.value(source).pipe(
		Match.tags({
			Item: (source) => itemEquals(source.item, item),
		}),
		Match.orElse(() => false),
	);
