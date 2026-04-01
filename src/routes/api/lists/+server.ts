import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { ListConnector, rdb, type UUID } from '$lib/server/redisConnector';
import { getBoardIdFromList, requireBoardAccess } from '$lib/server/boardAccess';
import { notifyBoardUpdated } from '$lib/server/boardEvents';

function normalizeText(value: unknown) {
	if (typeof value !== 'string') {
		return '';
	}

	return value.trim();
}

export const POST: RequestHandler = async ({ request }) => {
	const { boardId, name, userId } = await request.json();
	const normalizedName = typeof name === 'string' ? name.trim() : '';

	if (!boardId || !normalizedName) {
		throw error(400, 'boardId and name required');
	}

	await requireBoardAccess(boardId as UUID, userId, 'edit', {
		allowLegacyWithoutUserId: true
	});

	try {
		const listId = await ListConnector.create(boardId as UUID, normalizedName);
		await rdb.sadd(`board:${boardId}:lists`, listId);
		notifyBoardUpdated({
			boardId: String(boardId),
			actorId: userId,
			source: 'list',
			history: {
				action: 'list.created',
				message: `Created list "${normalizedName}".`,
				metadata: { listId, name: normalizedName }
			}
		});

		return json({ id: listId, name: normalizedName });
	} catch (err) {
		console.error('create list failed', err);
		throw error(500, 'create list failed');
	}
};
export const PATCH: RequestHandler = async ({ request }) => {
	const { listId, name, order, userId } = await request.json();

	if (!listId) {
		throw error(400, 'listId required');
	}

	const boardId = await getBoardIdFromList(String(listId));

	if (userId) {
		if (!boardId) {
			throw error(404, 'List not found');
		}

		await requireBoardAccess(boardId as UUID, userId, 'edit');
	}

	const previousListName = normalizeText(await rdb.hget(`list:${listId}`, 'name'));
	const updates: Record<string, string | number> = {};
	if (typeof name === 'string') {
		updates.name = name;
	}
	if (typeof order === 'number' && Number.isFinite(order)) {
		updates.order = Math.trunc(order);
	}

	if (Object.keys(updates).length === 0) {
		throw error(400, 'name or order required');
	}

	await rdb.hset(`list:${listId}`, updates);
	if (boardId) {
		const hasNameUpdate = typeof updates.name === 'string';
		const hasOrderUpdate = typeof updates.order === 'number';
		const nextListName =
			normalizeText(hasNameUpdate ? updates.name : previousListName) || String(listId);

		const action =
			hasNameUpdate && hasOrderUpdate
				? 'list.updated'
				: hasNameUpdate
					? 'list.renamed'
					: hasOrderUpdate
						? 'list.reordered'
						: 'list.updated';

		const message =
			hasNameUpdate && hasOrderUpdate
				? `Updated list "${nextListName}".`
				: hasNameUpdate
					? `Renamed list to "${nextListName}".`
					: hasOrderUpdate
						? `Reordered list "${nextListName}".`
						: `Updated list "${nextListName}".`;

		notifyBoardUpdated({
			boardId,
			actorId: userId,
			source: 'list',
			history: {
				action,
				message,
				metadata: {
					listId: String(listId),
					name: nextListName,
					...(typeof updates.order === 'number' ? { order: String(updates.order) } : {})
				}
			}
		});
	}

	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ url }) => {
	const id = url.searchParams.get('id');
	const userId = url.searchParams.get('userId');
	if (!id) {
		throw error(400, 'id required');
	}

	const boardId = await getBoardIdFromList(id);

	if (userId) {
		if (!boardId) {
			throw error(404, 'List not found');
		}

		await requireBoardAccess(boardId as UUID, userId, 'edit');
	}

	try {
		const listName = normalizeText(await rdb.hget(`list:${id}`, 'name'));
		await ListConnector.del(id as UUID);
		if (boardId) {
			notifyBoardUpdated({
				boardId,
				actorId: userId,
				source: 'list',
				history: {
					action: 'list.deleted',
					message: `Deleted list "${listName || id}".`,
					metadata: { listId: id, ...(listName ? { name: listName } : {}) }
				}
			});
		}
		return json({ ok: true });
	} catch (err) {
		console.error('delete list failed', err);
		throw error(500, 'delete list failed');
	}
};
