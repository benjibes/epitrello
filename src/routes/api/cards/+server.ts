import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import {
	BoardConnector,
	CardConnector,
	UserConnector,
	rdb,
	type UUID
} from '$lib/server/redisConnector';
import {
	getBoardIdFromCard,
	getBoardIdFromList,
	requireBoardAccess
} from '$lib/server/boardAccess';
import { notifyBoardUpdated } from '$lib/server/boardEvents';
import { createUserNotification } from '$lib/server/notifications';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

type MemberIdentity = {
	userId: string;
	username: string | null;
	email: string | null;
};

function normalizeText(value: unknown) {
	if (typeof value !== 'string') {
		return '';
	}

	return value.trim();
}

function normalizeLookupToken(value: unknown) {
	return normalizeText(value).toLowerCase();
}

async function resolveAssigneeUserIds(boardId: string, assignees: string[]) {
	const board = await BoardConnector.get(boardId as UUID);
	if (!board) {
		return { boardName: null, userIds: [] as string[] };
	}

	const rawMemberIds = [board.owner, ...(board.editors ?? []), ...(board.viewers ?? [])];
	const memberIds = Array.from(
		new Set(
			rawMemberIds
				.map((memberId) => normalizeText(memberId))
				.filter((memberId) => memberId.length > 0)
		)
	);

	const memberIdSet = new Set(memberIds);
	const resolvedUserIds = new Set<string>();
	const unresolvedTokens = new Set<string>();

	for (const assignee of assignees) {
		const normalizedAssignee = normalizeText(assignee);
		if (!normalizedAssignee) {
			continue;
		}

		if (memberIdSet.has(normalizedAssignee)) {
			resolvedUserIds.add(normalizedAssignee);
			continue;
		}

		unresolvedTokens.add(normalizeLookupToken(normalizedAssignee));
	}

	if (unresolvedTokens.size > 0) {
		const members = await Promise.all(
			memberIds.map(async (memberId) => {
				const user = await UserConnector.get(memberId as UUID);
				return {
					userId: memberId,
					username: normalizeText(user?.username) || null,
					email: normalizeText(user?.email) || null
				} as MemberIdentity;
			})
		);

		const lookup = new Map<string, string>();
		for (const member of members) {
			lookup.set(normalizeLookupToken(member.userId), member.userId);
			if (member.username) {
				lookup.set(normalizeLookupToken(member.username), member.userId);
			}
			if (member.email) {
				lookup.set(normalizeLookupToken(member.email), member.userId);
			}
		}

		for (const token of unresolvedTokens) {
			const matchedUserId = lookup.get(token);
			if (matchedUserId) {
				resolvedUserIds.add(matchedUserId);
			}
		}
	}

	return {
		boardName: board.name || null,
		userIds: Array.from(resolvedUserIds)
	};
}

async function notifyDueDateAssigned({
	boardId,
	cardId,
	cardTitle,
	dueDate,
	assignees,
	actorId
}: {
	boardId: string;
	cardId: string;
	cardTitle: string;
	dueDate: string;
	assignees: string[];
	actorId?: string;
}) {
	if (!dueDate || assignees.length === 0) {
		return;
	}

	const { boardName, userIds } = await resolveAssigneeUserIds(boardId, assignees);
	const recipients = userIds.filter((userId) => userId !== actorId);

	if (recipients.length === 0) {
		return;
	}

	await Promise.all(
		recipients.map((userId) =>
			createUserNotification({
				userId,
				type: 'card.due_date',
				title: `Due date set on "${cardTitle}"`,
				message: `A due date (${dueDate}) was set for card "${cardTitle}".`,
				boardId,
				boardName: boardName ?? '',
				cardId,
				cardTitle,
				dueDate,
				actorId: actorId ?? ''
			})
		)
	);
}

async function getOrderedCardIds(listId: string): Promise<string[]> {
	const cardIds = await rdb.smembers(`list:${listId}:cards`);

	const cardsWithOrder = await Promise.all(
		cardIds.map(async (id) => {
			const rawOrder = await rdb.hget(`card:${id}`, 'order');
			const order = Number.parseInt(String(rawOrder ?? ''), 10);

			return {
				id: String(id),
				order: Number.isFinite(order) ? order : Number.MAX_SAFE_INTEGER
			};
		})
	);

	return cardsWithOrder.sort((a, b) => a.order - b.order).map((entry) => entry.id);
}

async function reorderCard(
	cardId: string,
	fromListId: string,
	toListId: string,
	targetIndex: number
) {
	const sourceOrdered = await getOrderedCardIds(fromListId);
	const sourceWithoutCard = sourceOrdered.filter((id) => id !== cardId);
	const destinationOrdered =
		fromListId === toListId
			? sourceWithoutCard
			: (await getOrderedCardIds(toListId)).filter((id) => id !== cardId);
	const safeIndex = clamp(targetIndex, 0, destinationOrdered.length);
	const destinationWithCard = [
		...destinationOrdered.slice(0, safeIndex),
		cardId,
		...destinationOrdered.slice(safeIndex)
	];

	if (fromListId !== toListId) {
		await rdb.srem(`list:${fromListId}:cards`, cardId);
		await rdb.sadd(`list:${toListId}:cards`, cardId);
	}

	if (fromListId === toListId) {
		await Promise.all(
			destinationWithCard.map((id, index) =>
				rdb.hset(`card:${id}`, { list: toListId, order: index })
			)
		);
		return;
	}

	await Promise.all(
		sourceWithoutCard.map((id, index) => rdb.hset(`card:${id}`, { list: fromListId, order: index }))
	);
	await Promise.all(
		destinationWithCard.map((id, index) => rdb.hset(`card:${id}`, { list: toListId, order: index }))
	);
}

export const POST: RequestHandler = async ({ request }) => {
	const { listId, title, userId } = await request.json();
	const normalizedTitle = typeof title === 'string' ? title.trim() : '';

	if (!listId || !normalizedTitle) {
		throw error(400, 'listId and title required');
	}

	const boardId = await getBoardIdFromList(String(listId));

	if (userId) {
		if (!boardId) {
			throw error(404, 'List not found');
		}

		await requireBoardAccess(boardId as UUID, userId, 'edit');
	}

	try {
		const currentCardIds = await rdb.smembers(`list:${listId}:cards`);
		const cardId = await CardConnector.create(listId as string, normalizedTitle);

		await rdb.sadd(`list:${listId}:cards`, cardId);
		await rdb.hset(`card:${cardId}`, {
			list: String(listId),
			order: currentCardIds.length
		});
		if (boardId) {
			notifyBoardUpdated({
				boardId,
				actorId: userId,
				source: 'card',
				history: {
					action: 'card.created',
					message: `Created card "${normalizedTitle}".`,
					metadata: {
						cardId,
						cardName: normalizedTitle,
						listId: String(listId),
						title: normalizedTitle
					}
				}
			});
		}

		return json({ id: cardId, title: normalizedTitle });
	} catch (err) {
		console.error('create card failed', err);
		throw error(500, 'create card failed');
	}
};
export const PATCH: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const {
		cardId,
		name,
		description,
		dueDate,
		assignees,
		fromListId,
		toListId,
		targetIndex,
		completed,
		userId
	} = body as {
		cardId?: string;
		name?: string;
		description?: string;
		dueDate?: string;
		assignees?: string[];
		fromListId?: string;
		toListId?: string;
		targetIndex?: number;
		completed?: boolean;
		userId?: string;
	};

	if (!cardId) {
		throw error(400, 'cardId required');
	}

	const boardId =
		(await getBoardIdFromCard(cardId)) ??
		(fromListId ? await getBoardIdFromList(fromListId) : null) ??
		(toListId ? await getBoardIdFromList(toListId) : null);

	if (userId) {
		if (!boardId) {
			throw error(404, 'Card not found');
		}

		await requireBoardAccess(boardId as UUID, userId, 'edit');
	}

	const normalizedName = typeof name === 'string' ? name.trim() : '';
	const previousCardName = normalizeText(await rdb.hget(`card:${cardId}`, 'name'));
	const changedFields: string[] = [];
	let normalizedAssigneesForNotification: string[] | null = null;
	let dueDateForNotification: string | null = null;

	if (typeof name === 'string') {
		await rdb.hset(`card:${cardId}`, { name: normalizedName });
		changedFields.push('title');
	}

	if (typeof description === 'string') {
		await rdb.hset(`card:${cardId}`, { description });
		changedFields.push('description');
	}

	if (typeof dueDate === 'string') {
		const normalizedDueDate = dueDate.trim();
		const previousDueDate = normalizeText(await rdb.hget(`card:${cardId}`, 'dueDate'));
		await rdb.hset(`card:${cardId}`, { dueDate: normalizedDueDate });
		changedFields.push(normalizedDueDate ? 'due date' : 'due date cleared');
		if (normalizedDueDate && normalizedDueDate !== previousDueDate) {
			dueDateForNotification = normalizedDueDate;
		}
	}

	if (Array.isArray(assignees)) {
		const normalizedAssignees = assignees
			.map((assignee) => String(assignee).trim())
			.filter((assignee) => assignee.length > 0);
		normalizedAssigneesForNotification = normalizedAssignees;

		await rdb.del(`card:${cardId}:assignees`);
		await Promise.all(
			normalizedAssignees.map((assignee) => rdb.sadd(`card:${cardId}:assignees`, assignee))
		);
		changedFields.push('assignees');
	}

	if (typeof completed === 'boolean') {
		await rdb.hset(`card:${cardId}`, { completed: completed ? 1 : 0 });
		changedFields.push(completed ? 'marked completed' : 'marked active');
	}

	let movedCard = false;
	let fromListName = '';
	let toListName = '';

	if (fromListId && toListId && Number.isInteger(targetIndex)) {
		await reorderCard(cardId, fromListId, toListId, Number(targetIndex));
		movedCard = true;
		changedFields.push(fromListId === toListId ? 'position' : 'list');
	} else if (fromListId && toListId && fromListId !== toListId) {
		await rdb.srem(`list:${fromListId}:cards`, cardId);
		await rdb.sadd(`list:${toListId}:cards`, cardId);
		await rdb.hset(`card:${cardId}`, { list: toListId });
		movedCard = true;
		changedFields.push('list');
	}

	if (movedCard && fromListId && toListId) {
		const [resolvedFromListName, resolvedToListName] = await Promise.all([
			normalizeText(await rdb.hget(`list:${fromListId}`, 'name')),
			normalizeText(await rdb.hget(`list:${toListId}`, 'name'))
		]);
		fromListName = resolvedFromListName;
		toListName = resolvedToListName;
	}

	if (boardId) {
		const cardDisplayName = normalizedName || previousCardName || cardId;
		const action =
			movedCard && changedFields.length === 1
				? 'card.moved'
				: changedFields.length === 1 && changedFields[0] === 'title'
					? 'card.renamed'
					: movedCard
						? 'card.moved'
						: 'card.updated';

		const message =
			action === 'card.renamed' && normalizedName
				? `Renamed card to "${cardDisplayName}".`
				: action === 'card.moved' && movedCard && fromListId && toListId
					? fromListId === toListId
						? `Reordered card "${cardDisplayName}".`
						: toListName
							? `Moved card "${cardDisplayName}" to list "${toListName}".`
							: `Moved card "${cardDisplayName}" to another list.`
					: changedFields.length > 0
						? `Updated card "${cardDisplayName}" (${changedFields.join(', ')}).`
						: `Updated card "${cardDisplayName}".`;

		notifyBoardUpdated({
			boardId,
			actorId: userId,
			source: 'card',
			history: {
				action,
				message,
				metadata: {
					cardId,
					cardName: cardDisplayName,
					...(fromListId ? { fromListId } : {}),
					...(fromListName ? { fromListName } : {}),
					...(toListId ? { toListId } : {}),
					...(toListName ? { toListName } : {})
				}
			}
		});

		if (dueDateForNotification) {
			const assigneesForNotification =
				normalizedAssigneesForNotification ?? (await rdb.smembers(`card:${cardId}:assignees`));
			if (assigneesForNotification.length > 0) {
				const cardTitle =
					cardDisplayName || normalizeText(await rdb.hget(`card:${cardId}`, 'name')) || cardId;
				void notifyDueDateAssigned({
					boardId,
					cardId,
					cardTitle,
					dueDate: dueDateForNotification,
					assignees: assigneesForNotification,
					actorId: userId
				}).catch((notificationError) => {
					console.error('failed to create due date notifications', notificationError);
				});
			}
		}
	}

	return json({ ok: true });
};
export const DELETE: RequestHandler = async ({ url, request }) => {
	let id = url.searchParams.get('id');
	let userId = url.searchParams.get('userId');

	if (!id) {
		try {
			const body = await request.json();
			if (body && typeof body.cardId === 'string') {
				id = body.cardId;
			}
			if (!userId && body && typeof body.userId === 'string') {
				userId = body.userId;
			}
		} catch (error) {
			void error;
		}
	}

	if (!id) {
		throw error(400, 'cardId required');
	}

	const boardId = await getBoardIdFromCard(id);

	if (userId) {
		if (!boardId) {
			throw error(404, 'Card not found');
		}

		await requireBoardAccess(boardId as UUID, userId, 'edit');
	}

	try {
		const cardName = normalizeText(await rdb.hget(`card:${id}`, 'name'));
		await CardConnector.del(id as UUID);
		if (boardId) {
			notifyBoardUpdated({
				boardId,
				actorId: userId,
				source: 'card',
				history: {
					action: 'card.deleted',
					message: `Deleted card "${cardName || id}".`,
					metadata: { cardId: id, ...(cardName ? { cardName } : {}) }
				}
			});
		}
		return json({ ok: true });
	} catch (e) {
		console.error('Erreur delete card', e);
		throw error(500, 'delete card failed');
	}
};
