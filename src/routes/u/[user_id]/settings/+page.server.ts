import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import type { UUID } from 'crypto';
import { UserConnector } from '$lib/server/redisConnector';

export const load: PageServerLoad = async ({ params }) => {
	const userId = params.user_id as UUID;
	const user = await UserConnector.get(userId);

	if (!user) {
		throw error(404, 'User not found');
	}

	return {
		user_id: user.uuid,
		email: user.email,
		name: user.username ?? '',
		role: user.role
	};
};
