import type { UiCard, UiList } from './board.types';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

export type MoveCardResult = {
	nextLists: UiList[];
	card: UiCard;
	insertIndex: number;
	fromListUuid?: string;
	toListUuid?: string;
	unchanged: boolean;
};

export function moveCardInLists(
	lists: UiList[],
	fromListIndex: number,
	fromCardIndex: number,
	toListIndex: number,
	toCardIndex: number
): MoveCardResult | null {
	const fromList = lists[fromListIndex];
	const toList = lists[toListIndex];
	if (!fromList || !toList || !fromList.cards[fromCardIndex]) {
		return null;
	}

	const nextLists = lists.map((list) => ({
		...list,
		cards: [...list.cards]
	}));

	const nextFromList = nextLists[fromListIndex];
	const nextToList = nextLists[toListIndex];
	const [card] = nextFromList.cards.splice(fromCardIndex, 1);

	let insertIndex = toCardIndex;
	if (fromListIndex === toListIndex && fromCardIndex < insertIndex) {
		insertIndex -= 1;
	}
	insertIndex = clamp(insertIndex, 0, nextToList.cards.length);
	const unchanged = fromListIndex === toListIndex && insertIndex === fromCardIndex;

	nextToList.cards.splice(insertIndex, 0, card);

	return {
		nextLists,
		card,
		insertIndex,
		fromListUuid: nextFromList.uuid,
		toListUuid: nextToList.uuid,
		unchanged
	};
}

export type MoveListResult = {
	nextLists: UiList[];
	changed: boolean;
};

export function moveListInLists(
	lists: UiList[],
	fromIndex: number,
	toIndex: number
): MoveListResult | null {
	if (!lists[fromIndex]) {
		return null;
	}

	const nextLists = [...lists];
	const [movedList] = nextLists.splice(fromIndex, 1);
	let insertIndex = toIndex;

	if (fromIndex < insertIndex) {
		insertIndex -= 1;
	}
	insertIndex = clamp(insertIndex, 0, nextLists.length);
	const changed = insertIndex !== fromIndex;
	if (changed) {
		nextLists.splice(insertIndex, 0, movedList);
	} else {
		nextLists.splice(fromIndex, 0, movedList);
	}

	return { nextLists, changed };
}
