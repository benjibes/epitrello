import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { BoardConnector } from '$lib/server/redisConnector';

export const load: PageServerLoad = async ({ params }) => {
	const boardId = params.board_id;

	if (!boardId) {
		throw error(400, 'Missing board_id');
	}

	const board = await BoardConnector.get(boardId);

	if (!board) {
		throw error(404, 'Board not found');
	}
	return {
		board: {
			id: board.uuid,
			name: board.name
		}
	};
};
