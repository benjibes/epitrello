import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { requireBoardAccess } from '$lib/server/boardAccess';
import { ListConnector, rdb, type UUID } from '$lib/server/redisConnector';
import { notifyBoardUpdated } from '$lib/server/boardEvents';

function normalizeId(value: unknown) {
	if (typeof value !== 'string') {
		return '';
	}

	return value.trim();
}

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as
		| { boardId?: unknown; userId?: unknown }
		| null;
	const boardId = normalizeId(body?.boardId);
	const userId = normalizeId(body?.userId);

	if (!boardId || !userId) {
		throw error(400, 'boardId and userId required');
	}

	const { board } = await requireBoardAccess(boardId as UUID, userId, 'owner');
	const listIds = (board.lists ?? []).map((listId) => String(listId)).filter((listId) => listId.length > 0);

	const deletionStats = await Promise.all(
		listIds.map(async (listId) => {
			const cards = await rdb.smembers(`list:${listId}:cards`);
			await ListConnector.del(listId as UUID);
			return Array.isArray(cards) ? cards.length : 0;
		})
	);

	const clearedLists = listIds.length;
	const clearedCards = deletionStats.reduce((sum, count) => sum + count, 0);

	notifyBoardUpdated({
		boardId,
		actorId: userId,
		source: 'board',
		history: {
			action: 'board.cleared',
			message: `Cleared board "${board.name}".`,
			metadata: {
				clearedLists,
				clearedCards
			}
		}
	});

	return json({
		ok: true,
		clearedLists,
		clearedCards
	});
};
