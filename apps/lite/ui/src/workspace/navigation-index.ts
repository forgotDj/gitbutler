import { type Operand, operandIdentityKey } from "#ui/operands.ts";
import { type WorkspaceOutline } from "#ui/workspace/outline.ts";

export type NavigationIndex = {
	items: Array<Operand>;
	sectionStartIndexes: Array<number>;
	sectionIndexByItemIndex: Array<number>;
	indexByKey: Map<string, number>;
};

const createNavigationIndex = (): NavigationIndex => ({
	items: [],
	sectionStartIndexes: [],
	sectionIndexByItemIndex: [],
	indexByKey: new Map<string, number>(),
});

export const buildNavigationIndex = (outline: WorkspaceOutline): NavigationIndex => {
	const index = createNavigationIndex();

	for (const outlineSection of outline) {
		const itemsInSection = outlineSection.section
			? [outlineSection.section, ...outlineSection.children]
			: outlineSection.children;
		if (itemsInSection.length === 0) continue;

		const sectionIndex = index.sectionStartIndexes.length;
		index.sectionStartIndexes.push(index.items.length);

		for (const item of itemsInSection) {
			const itemIndex = index.items.length;
			index.items.push(item);
			index.sectionIndexByItemIndex.push(sectionIndex);
			index.indexByKey.set(operandIdentityKey(item), itemIndex);
		}
	}

	return index;
};

export const filterNavigationIndex = (
	index: NavigationIndex,
	predicate: (operand: Operand) => boolean,
): NavigationIndex => {
	const filteredIndex = createNavigationIndex();

	const sectionIndexBySourceSectionIndex = new Map<number, number>();

	for (const [itemIndex, item] of index.items.entries()) {
		if (!predicate(item)) continue;

		const sourceSectionIndex = index.sectionIndexByItemIndex[itemIndex];
		if (sourceSectionIndex === undefined) continue;
		let filteredSectionIndex = sectionIndexBySourceSectionIndex.get(sourceSectionIndex);
		if (filteredSectionIndex === undefined) {
			filteredSectionIndex = filteredIndex.sectionStartIndexes.length;
			sectionIndexBySourceSectionIndex.set(sourceSectionIndex, filteredSectionIndex);
			filteredIndex.sectionStartIndexes.push(filteredIndex.items.length);
		}

		const filteredItemIndex = filteredIndex.items.length;
		filteredIndex.items.push(item);
		filteredIndex.sectionIndexByItemIndex.push(filteredSectionIndex);
		filteredIndex.indexByKey.set(operandIdentityKey(item), filteredItemIndex);
	}

	return filteredIndex;
};

export const getAdjacent = ({
	navigationIndex,
	selection,
	offset,
}: {
	navigationIndex: NavigationIndex;
	selection: Operand;
	offset: -1 | 1;
}): Operand | null => {
	const selectionIndex = navigationIndex.indexByKey.get(operandIdentityKey(selection));
	if (selectionIndex === undefined) return null;

	return navigationIndex.items[selectionIndex + offset] ?? null;
};

export const getNextSection = ({
	navigationIndex,
	selection,
}: {
	navigationIndex: NavigationIndex;
	selection: Operand;
}): Operand | null => {
	const selectionIndex = navigationIndex.indexByKey.get(operandIdentityKey(selection));
	if (selectionIndex === undefined) return null;

	const sectionIndex = navigationIndex.sectionIndexByItemIndex[selectionIndex];
	if (sectionIndex === undefined) return null;
	const nextSectionStartIndex = navigationIndex.sectionStartIndexes[sectionIndex + 1];
	if (nextSectionStartIndex === undefined) return null;

	return navigationIndex.items[nextSectionStartIndex] ?? null;
};

export const getPreviousSection = ({
	navigationIndex,
	selection,
}: {
	navigationIndex: NavigationIndex;
	selection: Operand;
}): Operand | null => {
	const selectionIndex = navigationIndex.indexByKey.get(operandIdentityKey(selection));
	if (selectionIndex === undefined) return null;

	const sectionIndex = navigationIndex.sectionIndexByItemIndex[selectionIndex];
	if (sectionIndex === undefined) return null;
	const currentSectionStartIndex = navigationIndex.sectionStartIndexes[sectionIndex];
	if (currentSectionStartIndex === undefined) return null;

	if (selectionIndex !== currentSectionStartIndex)
		return navigationIndex.items[currentSectionStartIndex] ?? null;

	const previousSectionStartIndex = navigationIndex.sectionStartIndexes[sectionIndex - 1];
	if (previousSectionStartIndex === undefined) return null;

	return navigationIndex.items[previousSectionStartIndex] ?? null;
};

export const navigationIndexIncludes = (
	navigationIndex: NavigationIndex,
	operand: Operand,
): boolean => navigationIndex.indexByKey.has(operandIdentityKey(operand));
