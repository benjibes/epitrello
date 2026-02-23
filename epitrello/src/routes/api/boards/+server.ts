import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { rdb } from '$lib/server/redisConnector';
import type { UUID } from 'crypto';
import {
	UserConnector,
	BoardConnector,
	ListConnector,
	CardConnector,
	TagConnector
} from '$lib/server/redisConnector';
import { requireBoardAccess } from '$lib/server/boardAccess';
import { notifyBoardUpdated } from '$lib/server/boardEvents';
import { getVisibleBoardsForUser } from '$lib/server/boardVisibility';

const MAX_SEARCH_QUERY_LENGTH = 120;
const MAX_SEARCH_LIMIT = 20;
const DEFAULT_SEARCH_LIMIT = 8;

type BoardTemplate = {
	id: 'product_roadmap' | 'sprint_planning' | 'personal_project';
	name: string;
	lists: Array<{
		name: string;
		cards: Array<{
			title: string;
			tags?: string[];
		}>;
	}>;
};

const BOARD_TEMPLATES: BoardTemplate[] = [
	{
		id: 'product_roadmap',
		name: 'Product Roadmap',
		lists: [
			{
				name: 'Ideas',
				cards: [
					{ title: 'Collect customer feedback', tags: ['research'] },
					{ title: 'Define next quarter outcomes', tags: ['strategy'] },
					{ title: 'Finalize roadmap v1', tags: ['planning'] },
					{ title: 'Prepare stakeholder review', tags: ['alignment'] },
					{ title: 'Validate onboarding concept', tags: ['ux'] }
				]
			},
			{
				name: 'Planned',
				cards: []
			},
			{
				name: 'In Progress',
				cards: []
			},
			{
				name: 'Released',
				cards: []
			}
		]
	},
	{
		id: 'sprint_planning',
		name: 'Sprint Planning',
		lists: [
			{
				name: 'Backlog',
				cards: [
					{ title: 'Collect user stories', tags: ['planning'] },
					{ title: 'Refine acceptance criteria', tags: ['analysis'] },
					{ title: 'Prepare sprint goal', tags: ['priority'] },
					{ title: 'Break down tasks', tags: ['planning'] },
					{ title: 'Validate completed tasks', tags: ['quality'] }
				]
			},
			{
				name: 'Todo',
				cards: []
			},
			{
				name: 'Doing',
				cards: []
			},
			{
				name: 'Review',
				cards: []
			},
			{
				name: 'Done',
				cards: []
			}
		]
	},
	{
		id: 'personal_project',
		name: 'Personal Project',
		lists: [
			{
				name: 'Inbox',
				cards: [
					{ title: 'Capture project ideas', tags: ['brainstorm'] },
					{ title: 'List next actions', tags: ['planning'] },
					{ title: 'Create weekly goal', tags: ['focus'] },
					{ title: 'Timebox first milestone', tags: ['schedule'] },
					{ title: 'Work 30 min on core task', tags: ['habit'] },
					{ title: 'Set up project workspace', tags: ['setup'] }
				]
			},
			{
				name: 'Next',
				cards: []
			},
			{
				name: 'In Progress',
				cards: []
			},
			{
				name: 'Done',
				cards: []
			}
		]
	}
];

function normalizeText(value: string | null) {
	return typeof value === 'string' ? value.trim() : '';
}

function parseSearchLimit(value: string | null) {
	const parsed = Number.parseInt(String(value ?? ''), 10);
	if (!Number.isFinite(parsed)) {
		return DEFAULT_SEARCH_LIMIT;
	}

	return Math.min(MAX_SEARCH_LIMIT, Math.max(1, parsed));
}

function boardMatchesSearch(boardName: string, boardId: string, ownerName: string, query: string) {
	if (!query) {
		return true;
	}

	const normalizedName = boardName.toLowerCase();
	const normalizedId = boardId.toLowerCase();
	const normalizedOwnerName = ownerName.toLowerCase();
	return (
		normalizedName.includes(query) ||
		normalizedId.includes(query) ||
		normalizedOwnerName.includes(query)
	);
}

function compareBoardsByName<T extends { name: string }>(left: T, right: T) {
	return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
}

function resolveBoardTemplate(templateId: unknown) {
	const normalizedTemplateId = typeof templateId === 'string' ? templateId.trim() : '';
	if (!normalizedTemplateId) {
		return null;
	}

	return BOARD_TEMPLATES.find((template) => template.id === normalizedTemplateId) ?? null;
}

async function seedBoardFromTemplate(boardId: string, template: BoardTemplate) {
	let createdCardCount = 0;

	for (const list of template.lists) {
		const listId = await ListConnector.create(boardId as UUID, list.name);

		for (const card of list.cards) {
			const currentCardIds = await rdb.smembers(`list:${listId}:cards`);
			const cardId = await CardConnector.create(listId as UUID, card.title);

			await rdb.sadd(`list:${listId}:cards`, cardId);
			await rdb.hset(`card:${cardId}`, {
				list: String(listId),
				order: currentCardIds.length
			});
			createdCardCount += 1;

			for (const tagName of card.tags ?? []) {
				const tagId = await TagConnector.create(cardId as UUID, tagName, 'label', 'gray');
				await rdb.sadd(`card:${cardId}:tags`, tagId);
			}
		}
	}

	return {
		listCount: template.lists.length,
		cardCount: createdCardCount
	};
}

export const GET: RequestHandler = async ({ url }) => {
	const userId = normalizeText(url.searchParams.get('userId'));
	if (!userId) {
		return json({ error: 'userId is required' }, { status: 400 });
	}

	const query = normalizeText(url.searchParams.get('q'));
	if (query.length > MAX_SEARCH_QUERY_LENGTH) {
		return json(
			{ error: `q cannot exceed ${MAX_SEARCH_QUERY_LENGTH} characters` },
			{ status: 400 }
		);
	}

	const visibility = await getVisibleBoardsForUser(userId as UUID);
	if (!visibility) {
		return json({ error: 'User not found' }, { status: 404 });
	}

	const normalizedQuery = query.toLowerCase();
	const searchLimit = parseSearchLimit(url.searchParams.get('limit'));

	const normalizedOwnedBoards = visibility.ownedBoards
		.filter((board) => boardMatchesSearch(board.name, board.uuid, board.ownerName, normalizedQuery))
		.sort(compareBoardsByName)
		.slice(0, searchLimit)
		.map((board) => ({ ...board }));

	const normalizedSharedBoards = visibility.sharedBoards
		.filter((board) => boardMatchesSearch(board.name, board.uuid, board.ownerName, normalizedQuery))
		.sort(compareBoardsByName)
		.slice(0, searchLimit)
		.map((board) => ({ ...board }));

	return json({
		query,
		ownedBoards: normalizedOwnedBoards,
		sharedBoards: normalizedSharedBoards
	});
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);

	if (!body || !body.ownerId || !body.name) {
		return json({ error: 'ownerId et name sont requis' }, { status: 400 });
	}

	const ownerId = body.ownerId as UUID;
	const name = String(body.name).trim();

	if (!name) {
		return json({ error: 'Le nom du board ne peut pas être vide' }, { status: 400 });
	}

	const template = resolveBoardTemplate(body.templateId);
	if (body.templateId && !template) {
		return json({ error: 'Template de board inconnu' }, { status: 400 });
	}

	const user = await UserConnector.get(ownerId);
	if (!user) {
		return json({ error: 'Utilisateur introuvable' }, { status: 404 });
	}

	const uuid = await BoardConnector.create(ownerId, name);

	if (template) {
		try {
			const seeded = await seedBoardFromTemplate(String(uuid), template);
			notifyBoardUpdated({
				boardId: String(uuid),
				actorId: ownerId,
				source: 'board',
				history: {
					action: 'board.template.applied',
					message: `Applied template "${template.name}" (${seeded.listCount} list(s), ${seeded.cardCount} card(s)).`,
					metadata: {
						templateId: template.id,
						templateName: template.name,
						listCount: seeded.listCount,
						cardCount: seeded.cardCount
					}
				}
			});
		} catch (seedError) {
			console.error('Erreur seed board template', seedError);
			await BoardConnector.del(uuid as UUID);
			return json({ error: 'Unable to apply board template' }, { status: 500 });
		}
	}

	const board = await BoardConnector.get(uuid as UUID);
	const createdBoardName = board?.name ?? name;

	notifyBoardUpdated({
		boardId: String(uuid),
		actorId: ownerId,
		source: 'board',
		history: {
			action: 'board.created',
			message: `Created board "${createdBoardName}".`,
			metadata: { name: createdBoardName }
		}
	});

	if (!board) {
		return json(
			{
				uuid,
				name,
				owner: ownerId
			},
			{ status: 201 }
		);
	}

	return json(
		{
			uuid: board.uuid,
			name: board.name,
			owner: board.owner
		},
		{ status: 201 }
	);
};
export const PATCH: RequestHandler = async ({ request }) => {
	const { boardId, name, userId } = await request.json();
	const normalizedName = typeof name === 'string' ? name.trim() : '';

	if (!boardId || !normalizedName) {
		throw error(400, 'boardId and name required');
	}

	await requireBoardAccess(boardId as UUID, userId, 'owner', {
		allowLegacyWithoutUserId: true
	});

	await rdb.hset(`board:${boardId}`, { name: normalizedName });
	notifyBoardUpdated({
		boardId: String(boardId),
		actorId: userId,
		source: 'board',
		history: {
			action: 'board.renamed',
			message: `Renamed board to "${normalizedName}".`,
			metadata: { name: normalizedName }
		}
	});

	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ url }) => {
	const id = url.searchParams.get('id');
	const userId = url.searchParams.get('userId');

	if (!id) {
		return json({ error: 'Paramètre id manquant' }, { status: 400 });
	}

	await requireBoardAccess(id as UUID, userId, 'owner', {
		allowLegacyWithoutUserId: true
	});

	await BoardConnector.del(id as UUID);

	return json({ ok: true });
};
