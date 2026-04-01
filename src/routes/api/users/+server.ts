import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import type { UUID } from 'crypto';
import { z } from 'zod';
import type { IUserRole } from '$lib/interfaces/IUser';
import { UserConnector } from '$lib/server/redisConnector';
import { isAdminUser, normalizeUserRole } from '$lib/server/userRoles';

const MAX_DISPLAY_NAME_LENGTH = 80;

function normalizeText(value: unknown) {
	return typeof value === 'string' ? value.trim() : '';
}

function resolveDefaultDisplayName(email: string) {
	const [localPart] = email.split('@');
	return localPart?.trim() || email;
}

async function resolveAdminRequester(requesterId: string) {
	const requester = await UserConnector.get(requesterId as UUID);
	if (!requester) {
		return { error: json({ error: 'Requester not found' }, { status: 404 }) };
	}

	if (!isAdminUser(requester)) {
		return { error: json({ error: 'Forbidden' }, { status: 403 }) };
	}

	return { requester };
}

export const GET: RequestHandler = async ({ url }) => {
	const requesterId = normalizeText(url.searchParams.get('requesterId'));
	if (!requesterId) {
		return json({ error: 'requesterId is required' }, { status: 400 });
	}

	const requesterCheck = await resolveAdminRequester(requesterId);
	if (requesterCheck.error) {
		return requesterCheck.error;
	}

	const users = await UserConnector.getAll();
	return json({
		users: users.map((user) => ({
			uuid: user.uuid,
			email: user.email,
			username: user.username,
			role: user.role
		}))
	});
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (!body) {
		return json({ error: 'Invalid body' }, { status: 400 });
	}

	const requesterId = normalizeText(body.requesterId);
	if (!requesterId) {
		return json({ error: 'requesterId is required' }, { status: 400 });
	}

	const requesterCheck = await resolveAdminRequester(requesterId);
	if (requesterCheck.error) {
		return requesterCheck.error;
	}

	const email = normalizeText(body.email).toLowerCase();
	if (!email || !z.email().safeParse(email).success) {
		return json({ error: 'Valid email is required' }, { status: 400 });
	}

	const roleInput = body.role;
	let role: IUserRole = 'student';
	if (typeof roleInput !== 'undefined') {
		const normalizedRole = normalizeUserRole(roleInput);
		if (!normalizedRole) {
			return json({ error: 'Invalid role. Allowed values: student, ape, admin' }, { status: 400 });
		}
		role = normalizedRole;
	}

	const existing = await UserConnector.getByEmail(email);
	if (existing) {
		return json({ error: 'User already exists' }, { status: 409 });
	}

	const requestedDisplayName = normalizeText(body.displayName ?? body.name);
	const username = requestedDisplayName || resolveDefaultDisplayName(email);
	if (!username) {
		return json({ error: 'displayName cannot be empty' }, { status: 400 });
	}
	if (username.length > MAX_DISPLAY_NAME_LENGTH) {
		return json(
			{ error: `displayName cannot exceed ${MAX_DISPLAY_NAME_LENGTH} characters` },
			{ status: 400 }
		);
	}

	const uuid = Bun.randomUUIDv7() as UUID;
	await UserConnector.save({
		uuid,
		role,
		username,
		email,
		password_hash: '',
		profile_picture_url: '',
		boards: []
	});

	return json(
		{
			ok: true,
			user: {
				uuid,
				email,
				username,
				role
			}
		},
		{ status: 201 }
	);
};

export const PATCH: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (!body) {
		return json({ error: 'Invalid body' }, { status: 400 });
	}

	const userId = normalizeText(body.userId);
	const requesterId = normalizeText(body.requesterId);
	const hasDisplayNameField =
		typeof body.displayName !== 'undefined' || typeof body.name !== 'undefined';
	const displayName = normalizeText(body.displayName ?? body.name);
	const roleInput = body.role;
	const wantsRoleUpdate = typeof roleInput !== 'undefined';

	if (!userId || !requesterId || (!hasDisplayNameField && !wantsRoleUpdate)) {
		return json({ error: 'userId, requesterId and displayName are required' }, { status: 400 });
	}

	if (hasDisplayNameField && !displayName) {
		return json({ error: 'displayName cannot be empty' }, { status: 400 });
	}

	if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
		return json(
			{ error: `displayName cannot exceed ${MAX_DISPLAY_NAME_LENGTH} characters` },
			{ status: 400 }
		);
	}

	let nextRole: IUserRole | null = null;
	if (wantsRoleUpdate) {
		nextRole = normalizeUserRole(roleInput);
		if (!nextRole) {
			return json({ error: 'Invalid role. Allowed values: student, ape, admin' }, { status: 400 });
		}
	}

	const isSelfRequest = requesterId === userId;
	let requesterIsAdmin = false;
	if (!isSelfRequest || wantsRoleUpdate) {
		const requester = await UserConnector.get(requesterId as UUID);
		requesterIsAdmin = isAdminUser(requester);
		if (!requester) {
			return json({ error: 'Requester not found' }, { status: 404 });
		}
	}

	if (!isSelfRequest && !requesterIsAdmin) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	if (wantsRoleUpdate && !requesterIsAdmin) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const user = await UserConnector.get(userId as UUID);
	if (!user) {
		return json({ error: 'User not found' }, { status: 404 });
	}

	if (hasDisplayNameField) {
		await UserConnector.updateProfile(userId as UUID, { username: displayName });
	}

	if (nextRole && nextRole !== user.role) {
		await UserConnector.updateRole(userId as UUID, nextRole);
	}

	return json({
		ok: true,
		...(hasDisplayNameField ? { name: displayName } : {}),
		...(nextRole ? { role: nextRole } : {})
	});
};

export const DELETE: RequestHandler = async ({ url }) => {
	const userId = normalizeText(url.searchParams.get('id'));
	const requesterId = normalizeText(url.searchParams.get('requesterId'));

	if (!userId || !requesterId) {
		return json({ error: 'id and requesterId are required' }, { status: 400 });
	}

	if (requesterId !== userId) {
		const requester = await UserConnector.get(requesterId as UUID);
		if (!requester || !isAdminUser(requester)) {
			return json({ error: 'Forbidden' }, { status: 403 });
		}
	}

	const user = await UserConnector.get(userId as UUID);
	if (!user) {
		return json({ error: 'User not found' }, { status: 404 });
	}

	await UserConnector.del(userId as UUID);
	return json({ ok: true });
};
