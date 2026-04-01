import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import type { UUID } from 'crypto';
import { UserConnector } from '$lib/server/redisConnector';
import type { IUser } from '$lib/interfaces/IUser';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);

	if (!body || !body.email) {
		return json({ error: 'Email manquant' }, { status: 400 });
	}

	const email: string = String(body.email).trim().toLowerCase();
	const name: string = body.name ?? email.split('@')[0];

	let user = await UserConnector.getByEmail(email);

	if (!user) {
		const uuid = Bun.randomUUIDv7() as UUID;

		user = {
			uuid,
			role: 'student',
			username: name,
			email,
			password_hash: '',
			profile_picture_url: '',
			boards: []
		} satisfies IUser;

		await UserConnector.save(user);
	}

	return json({
		id: user.uuid,
		email: user.email,
		name: user.username,
		role: user.role ?? 'student'
	});
};
