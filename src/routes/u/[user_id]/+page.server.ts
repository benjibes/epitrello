import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import type { UUID } from 'crypto';
import { getVisibleBoardsForUser } from '$lib/server/boardVisibility';

export const load: PageServerLoad = async ({ params }) => {
	const userId = params.user_id as UUID;

	const visibility = await getVisibleBoardsForUser(userId);
	if (!visibility) {
		throw error(404, 'User not found');
	}

	return {
		user_id: visibility.user.uuid,
		email: visibility.user.email,
		name: visibility.user.username ?? null,
		role: visibility.user.role,
		ownedBoards: visibility.ownedBoards,
		sharedBoards: visibility.sharedBoards
	};
};
