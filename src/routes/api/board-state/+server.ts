import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { rdb } from '$lib/server/redisConnector';

type BoardStatePayload = {
	board_name: string;
	lists: unknown;
};
export const GET: RequestHandler = async ({ url }) => {
	const boardId = url.searchParams.get('boardId');

	if (!boardId) {
		throw error(400, 'boardId manquant');
	}

	const key = `board_state:${boardId}`;
	const raw = await rdb.get(key);

	if (!raw) {
		return json({ message: 'Not found' }, { status: 404 });
	}

	try {
		const parsed = JSON.parse(raw) as BoardStatePayload;
		return json(parsed);
	} catch (e) {
		console.error('❌ Erreur JSON.parse board_state', e, 'raw =', raw);
		throw error(500, 'Invalid stored board_state JSON');
	}
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();

		const boardId = body.boardId as string | undefined;
		const board_name = typeof body.board_name === 'string' ? body.board_name : '';
		const lists = body.lists;

		if (!boardId) {
			throw error(400, 'boardId manquant');
		}
		const payload: BoardStatePayload = {
			board_name,
			lists: Array.isArray(lists) ? lists : []
		};

		const key = `board_state:${boardId}`;
		await rdb.set(key, JSON.stringify(payload));

		return json({ ok: true });
	} catch (err: unknown) {
		const httpError = err as { status?: number; body?: unknown } | null;
		if (httpError?.status && httpError?.body) {
			throw err;
		}

		console.error('❌ Erreur /api/board-state POST', err);
		throw error(500, 'Erreur serveur board-state');
	}
};
