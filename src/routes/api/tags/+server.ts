import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { TagConnector, rdb, type UUID } from '$lib/server/redisConnector';
import { getBoardIdFromCard, requireBoardAccess } from '$lib/server/boardAccess';
import { notifyBoardUpdated } from '$lib/server/boardEvents';

function normalizeText(value: unknown) {
	if (typeof value !== 'string') {
		return '';
	}

	return value.trim();
}

export const POST: RequestHandler = async ({ request }) => {
	const { cardId, name, userId } = await request.json();
	const normalizedName = typeof name === 'string' ? name.trim() : '';

	if (!cardId || !normalizedName) {
		throw error(400, 'cardId and name required');
	}

	const boardId = await getBoardIdFromCard(String(cardId));

	if (userId) {
		if (!boardId) {
			throw error(404, 'Card not found');
		}

		await requireBoardAccess(boardId as UUID, userId, 'edit');
	}

	try {
		const tagId = await TagConnector.create(cardId as UUID, normalizedName, 'label', 'gray');
		const cardName = normalizeText(await rdb.hget(`card:${cardId}`, 'name'));

		await rdb.sadd(`card:${cardId}:tags`, tagId);
		if (boardId) {
			notifyBoardUpdated({
				boardId,
				actorId: userId,
				source: 'tag',
				history: {
					action: 'tag.added',
					message: `Added tag "${normalizedName}" on card "${cardName || cardId}".`,
					metadata: {
						cardId: String(cardId),
						tag: normalizedName,
						...(cardName ? { cardName } : {})
					}
				}
			});
		}

		return json({ id: tagId, name: normalizedName });
	} catch (err) {
		console.error('create tag failed', err);
		throw error(500, 'create tag failed');
	}
};

export const DELETE: RequestHandler = async ({ request }) => {
	let body: unknown;

	try {
		body = await request.json();
	} catch {
		throw error(400, 'JSON body required');
	}

	const parsedBody = body as { cardId?: string; name?: string; userId?: string } | null;
	const cardId = parsedBody?.cardId;
	const name = parsedBody?.name;
	const userId = parsedBody?.userId;

	if (!cardId || !name) {
		throw error(400, 'cardId and name required');
	}

	const boardId = await getBoardIdFromCard(cardId);

	if (userId) {
		if (!boardId) {
			throw error(404, 'Card not found');
		}

		await requireBoardAccess(boardId as UUID, userId, 'edit');
	}

	try {
		const cardName = normalizeText(await rdb.hget(`card:${cardId}`, 'name'));
		const tagIds = await rdb.smembers(`card:${cardId}:tags`);

		for (const tagId of tagIds) {
			const tagName = await rdb.hget(`tag:${tagId}`, 'name');

			if (tagName === name) {
				await rdb.srem(`card:${cardId}:tags`, tagId);
				await rdb.del(`tag:${tagId}`);
			}
		}
		if (boardId) {
			notifyBoardUpdated({
				boardId,
				actorId: userId,
				source: 'tag',
				history: {
					action: 'tag.removed',
					message: `Removed tag "${name}" from card "${cardName || cardId}".`,
					metadata: { cardId, tag: name, ...(cardName ? { cardName } : {}) }
				}
			});
		}

		return json({ ok: true });
	} catch (e) {
		console.error('Erreur delete tag', e);
		throw error(500, 'delete tag failed');
	}
};
