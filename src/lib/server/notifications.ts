import { rdb } from '$lib/server/redisConnector';

export type UserNotificationType = 'board.added' | 'card.due_date';

export type UserNotification = {
	id: string;
	userId: string;
	type: UserNotificationType;
	title: string;
	message: string;
	boardId: string | null;
	boardName: string | null;
	cardId: string | null;
	cardTitle: string | null;
	dueDate: string | null;
	actorId: string | null;
	createdAt: string;
	readAt: string | null;
};

type CreateUserNotificationInput = {
	userId: unknown;
	type: UserNotificationType;
	title: unknown;
	message: unknown;
	boardId?: unknown;
	boardName?: unknown;
	cardId?: unknown;
	cardTitle?: unknown;
	dueDate?: unknown;
	actorId?: unknown;
};

function normalizeString(value: unknown): string | null {
	if (typeof value !== 'string') {
		return null;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function parseNotificationType(value: unknown): UserNotificationType | null {
	if (value === 'board.added' || value === 'card.due_date') {
		return value;
	}

	return null;
}

function parseNotification(
	id: string,
	value: Record<string, unknown> | null
): UserNotification | null {
	if (!value) {
		return null;
	}

	const type = parseNotificationType(value.type);
	const userId = normalizeString(value.userId);
	const title = normalizeString(value.title);
	const message = normalizeString(value.message);
	const createdAt = normalizeString(value.createdAt);

	if (!type || !userId || !title || !message || !createdAt) {
		return null;
	}

	return {
		id,
		userId,
		type,
		title,
		message,
		boardId: normalizeString(value.boardId),
		boardName: normalizeString(value.boardName),
		cardId: normalizeString(value.cardId),
		cardTitle: normalizeString(value.cardTitle),
		dueDate: normalizeString(value.dueDate),
		actorId: normalizeString(value.actorId),
		createdAt,
		readAt: normalizeString(value.readAt)
	};
}

function normalizeLimit(value: unknown): number {
	const parsed = Number.parseInt(String(value ?? ''), 10);
	if (!Number.isFinite(parsed)) {
		return 20;
	}

	return Math.max(1, Math.min(parsed, 100));
}

export async function createUserNotification(input: CreateUserNotificationInput) {
	const userId = normalizeString(input.userId);
	const title = normalizeString(input.title);
	const message = normalizeString(input.message);

	if (!userId || !title || !message) {
		return null;
	}

	const id = Bun.randomUUIDv7();
	const createdAt = new Date().toISOString();

	await rdb.hset(`notification:${id}`, {
		id,
		userId,
		type: input.type,
		title,
		message,
		boardId: normalizeString(input.boardId) ?? '',
		boardName: normalizeString(input.boardName) ?? '',
		cardId: normalizeString(input.cardId) ?? '',
		cardTitle: normalizeString(input.cardTitle) ?? '',
		dueDate: normalizeString(input.dueDate) ?? '',
		actorId: normalizeString(input.actorId) ?? '',
		createdAt,
		readAt: ''
	});
	await rdb.sadd(`user:${userId}:notifications`, id);

	return id;
}

export async function listUserNotifications(userId: unknown, limit: unknown) {
	const normalizedUserId = normalizeString(userId);
	if (!normalizedUserId) {
		return [];
	}

	const normalizedLimit = normalizeLimit(limit);
	const ids = await rdb.smembers(`user:${normalizedUserId}:notifications`);
	if (!ids || ids.length === 0) {
		return [];
	}

	const notificationsRaw = await Promise.all(
		Array.from(new Set(ids.map((id) => String(id))))
			.filter((id) => id.trim().length > 0)
			.map(async (id) => {
				const notificationHash = await rdb.hgetall(`notification:${id}`);
				return parseNotification(id, notificationHash);
			})
	);

	return notificationsRaw
		.filter(
			(entry): entry is UserNotification => entry !== null && entry.userId === normalizedUserId
		)
		.sort((a, b) => {
			if (a.createdAt === b.createdAt) {
				return b.id.localeCompare(a.id);
			}
			return b.createdAt.localeCompare(a.createdAt);
		})
		.slice(0, normalizedLimit);
}

export async function markUserNotificationAsRead(userId: unknown, notificationId: unknown) {
	const normalizedUserId = normalizeString(userId);
	const normalizedNotificationId = normalizeString(notificationId);

	if (!normalizedUserId || !normalizedNotificationId) {
		return false;
	}

	const current = parseNotification(
		normalizedNotificationId,
		await rdb.hgetall(`notification:${normalizedNotificationId}`)
	);
	if (!current || current.userId !== normalizedUserId) {
		return false;
	}
	if (current.readAt) {
		return true;
	}

	await rdb.hset(`notification:${normalizedNotificationId}`, {
		readAt: new Date().toISOString()
	});
	return true;
}

export async function markAllUserNotificationsAsRead(userId: unknown) {
	const normalizedUserId = normalizeString(userId);
	if (!normalizedUserId) {
		return 0;
	}

	const ids = await rdb.smembers(`user:${normalizedUserId}:notifications`);
	if (!ids || ids.length === 0) {
		return 0;
	}

	let updatedCount = 0;
	const timestamp = new Date().toISOString();

	await Promise.all(
		Array.from(new Set(ids.map((id) => String(id))))
			.filter((id) => id.trim().length > 0)
			.map(async (id) => {
				const current = parseNotification(id, await rdb.hgetall(`notification:${id}`));
				if (!current || current.userId !== normalizedUserId || current.readAt) {
					return;
				}

				updatedCount += 1;
				await rdb.hset(`notification:${id}`, { readAt: timestamp });
			})
	);

	return updatedCount;
}
