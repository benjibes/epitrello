import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import {
	listUserNotifications,
	markAllUserNotificationsAsRead,
	markUserNotificationAsRead
} from '$lib/server/notifications';

function normalizeId(value: unknown) {
	return typeof value === 'string' ? value.trim() : '';
}

export const GET: RequestHandler = async ({ url }) => {
	const userId = normalizeId(url.searchParams.get('userId'));
	const limit = url.searchParams.get('limit');

	if (!userId) {
		throw error(400, 'userId required');
	}

	const notifications = await listUserNotifications(userId, limit);
	return json({ notifications });
};

export const PATCH: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const userId = normalizeId(body?.userId);
	const notificationId = normalizeId(body?.notificationId);

	if (!userId) {
		throw error(400, 'userId required');
	}

	if (notificationId) {
		const updated = await markUserNotificationAsRead(userId, notificationId);
		if (!updated) {
			throw error(404, 'Notification not found');
		}

		return json({ ok: true, updated: 1 });
	}

	const updatedCount = await markAllUserNotificationsAsRead(userId);
	return json({ ok: true, updated: updatedCount });
};
