export type UiCard = {
	id: number;
	uuid?: string;
	title: string;
	description: string;
	dueDate: string;
	assignees: string[];
	completed: boolean;
	tags: string[];
};

export type UiList = {
	uuid?: string;
	name: string;
	cards: UiCard[];
	newCardTitle: string;
};

export type BoardMember = {
	userId: string;
	role: 'owner' | 'editor' | 'viewer';
	username: string;
	email: string;
};

export type DueDateOperator = 'none' | 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'neq';

export type CardRef = {
	listIndex: number;
	cardIndex: number;
};

export type CardWithIndex = {
	card: UiCard;
	cardIndex: number;
};

export type FilteredListView = {
	uuid?: string;
	name: string;
	newCardTitle: string;
	cards: CardWithIndex[];
	totalCards: number;
};

export type BoardFullResponse = {
	board: {
		id: string;
		name: string;
		role: 'owner' | 'editor' | 'viewer';
		canEdit: boolean;
		canManage: boolean;
		members: BoardMember[];
	};
	lists: Array<{
		uuid: string;
		name: string;
		order: number;
		cards: Array<{
			uuid: string;
			title: string;
			description: string;
			dueDate: string;
			assignees: string[];
			order: number;
			completed: boolean;
			tags: string[];
		}>;
	}>;
};

export type BoardUpdatedRealtimeEvent = {
	actorId?: string | null;
};

export type BoardHistoryEntry = {
	id: string;
	source: 'board' | 'list' | 'card' | 'tag' | 'sharing' | 'unknown';
	action: string;
	message: string;
	createdAt: string;
	metadata: Record<string, string>;
	actor: {
		id: string | null;
		name: string;
	};
};

export type BoardHistoryResponse = {
	entries: BoardHistoryEntry[];
};
