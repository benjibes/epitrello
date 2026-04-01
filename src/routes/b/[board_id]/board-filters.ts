import type {
	BoardMember,
	CardWithIndex,
	DueDateOperator,
	FilteredListView,
	UiCard,
	UiList
} from './board.types';

const normalize = (value: string) => value.trim().toLowerCase();

export function memberLabel(member: BoardMember) {
	return member.username || member.email || member.userId;
}

export function userMatchTokens(
	member: BoardMember | null,
	currentUser: { id: string; name: string; email: string } | null = null,
	includeCurrentUser = false
) {
	const tokens = new Set<string>();
	const addToken = (value: string) => {
		const normalized = normalize(value);
		if (normalized) {
			tokens.add(normalized);
		}
	};

	if (member) {
		addToken(member.userId);
		addToken(member.username);
		addToken(member.email);
	}

	if (includeCurrentUser && currentUser) {
		addToken(currentUser.id);
		addToken(currentUser.name);
		addToken(currentUser.email);
	}

	return tokens;
}

export function assigneeMatchesMember(assignee: string, member: BoardMember) {
	const normalizedAssignee = normalize(assignee);
	if (!normalizedAssignee) {
		return false;
	}

	return userMatchTokens(member).has(normalizedAssignee);
}

export function isMemberAssignedToCard(card: UiCard, member: BoardMember) {
	return card.assignees.some((assignee) => assigneeMatchesMember(assignee, member));
}

export function assigneeLabel(assignee: string, boardMembers: BoardMember[]) {
	const member = boardMembers.find((entry) => assigneeMatchesMember(assignee, entry));
	return member ? memberLabel(member) : assignee;
}

export function getAvailableAssigneeMembers(
	selectedCard: UiCard | null,
	boardMembers: BoardMember[]
) {
	if (!selectedCard) {
		return boardMembers;
	}

	return boardMembers.filter((member) => !isMemberAssignedToCard(selectedCard, member));
}

export function cardMatchesAssigneeFilter(
	card: UiCard,
	assigneeFilter: string,
	boardMembers: BoardMember[],
	currentUser: { id: string; name: string; email: string }
) {
	if (assigneeFilter === 'all') {
		return true;
	}

	const assignees = card.assignees.map(normalize).filter(Boolean);
	if (assignees.length === 0) {
		return false;
	}

	if (assigneeFilter === 'me') {
		const meMember = boardMembers.find((member) => member.userId === currentUser.id) ?? null;
		const meTokens = userMatchTokens(meMember, currentUser, true);
		return assignees.some((assignee) => meTokens.has(assignee));
	}

	if (!assigneeFilter.startsWith('member:')) {
		return true;
	}

	const memberId = assigneeFilter.slice('member:'.length);
	const member = boardMembers.find((entry) => entry.userId === memberId) ?? null;
	const memberTokens = userMatchTokens(member);
	return assignees.some((assignee) => memberTokens.has(assignee));
}

export function cardMatchesTagFilter(card: UiCard, tagFilter: string) {
	if (tagFilter === 'all') {
		return true;
	}

	const normalizedFilter = normalize(tagFilter);
	return card.tags.some((tag) => normalize(tag) === normalizedFilter);
}

export function cardMatchesDueDateFilter(
	card: UiCard,
	dueDateOperator: DueDateOperator,
	dueDateFilterValue: string
) {
	const filterDate = dueDateFilterValue.trim();
	if (dueDateOperator === 'none' || !filterDate) {
		return true;
	}

	const cardDate = card.dueDate.trim();
	if (!cardDate) {
		return false;
	}

	switch (dueDateOperator) {
		case 'lt':
			return cardDate < filterDate;
		case 'lte':
			return cardDate <= filterDate;
		case 'gt':
			return cardDate > filterDate;
		case 'gte':
			return cardDate >= filterDate;
		case 'eq':
			return cardDate === filterDate;
		case 'neq':
			return cardDate !== filterDate;
		default:
			return true;
	}
}

export function cardMatchesFilters(
	card: UiCard,
	filters: {
		assigneeFilter: string;
		dueDateOperator: DueDateOperator;
		dueDateFilterValue: string;
		tagFilter: string;
		boardMembers: BoardMember[];
		currentUser: { id: string; name: string; email: string };
	}
) {
	return (
		cardMatchesAssigneeFilter(
			card,
			filters.assigneeFilter,
			filters.boardMembers,
			filters.currentUser
		) &&
		cardMatchesDueDateFilter(card, filters.dueDateOperator, filters.dueDateFilterValue) &&
		cardMatchesTagFilter(card, filters.tagFilter)
	);
}

export function extractAllTags(lists: UiList[]) {
	return Array.from(
		new Set(
			lists.flatMap((list) => list.cards.flatMap((card) => card.tags.map((tag) => tag.trim())))
		)
	)
		.filter((tag) => tag.length > 0)
		.sort((left, right) => left.localeCompare(right));
}

export function buildVisibleLists(
	lists: UiList[],
	filters: {
		assigneeFilter: string;
		dueDateOperator: DueDateOperator;
		dueDateFilterValue: string;
		tagFilter: string;
		boardMembers: BoardMember[];
		currentUser: { id: string; name: string; email: string };
	}
): FilteredListView[] {
	return lists.map((list) => {
		const cards: CardWithIndex[] = list.cards
			.map((card, cardIndex) => ({ card, cardIndex }))
			.filter((entry) => cardMatchesFilters(entry.card, filters));

		return {
			uuid: list.uuid,
			name: list.name,
			newCardTitle: list.newCardTitle,
			cards,
			totalCards: list.cards.length
		};
	});
}
