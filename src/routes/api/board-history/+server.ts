import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { requireBoardAccess } from '$lib/server/boardAccess';
import { getBoardHistoryEntries } from '$lib/server/boardHistory';
import { UserConnector, rdb, type UUID } from '$lib/server/redisConnector';

function resolveActorDisplayName({
	userId,
	username,
	email
}: {
	userId: string;
	username?: string | null;
	email?: string | null;
}) {
	const normalizedUsername = typeof username === 'string' ? username.trim() : '';
	if (normalizedUsername.length > 0) {
		return normalizedUsername;
	}

	const normalizedEmail = typeof email === 'string' ? email.trim() : '';
	if (normalizedEmail.length > 0) {
		return normalizedEmail;
	}

	return userId;
}

function normalizeId(value: unknown) {
	if (typeof value !== 'string') {
		return null;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function normalizeText(value: unknown) {
	if (typeof value !== 'string') {
		return '';
	}

	return value.trim();
}

function collectUniqueIds(values: unknown[]) {
	return Array.from(
		new Set(
			values.map((value) => normalizeId(value)).filter((value): value is string => Boolean(value))
		)
	);
}

function replaceIdsWithLabels(message: string, replacements: Map<string, string>) {
	let output = message;
	const sortedEntries = Array.from(replacements.entries())
		.filter(([id, label]) => id.length > 0 && label.length > 0 && id !== label)
		.sort((left, right) => right[0].length - left[0].length);

	for (const [id, label] of sortedEntries) {
		output = output.split(id).join(label);
	}

	return output;
}

export const GET: RequestHandler = async ({ url }) => {
	const boardId = url.searchParams.get('boardId');
	const userId = url.searchParams.get('userId');
	const rawLimit = url.searchParams.get('limit');

	if (!boardId) {
		throw error(400, 'boardId required');
	}
	if (!userId) {
		throw error(400, 'userId required');
	}

	const { board } = await requireBoardAccess(boardId as UUID, userId, 'view');

	const parsedLimit = rawLimit ? Number.parseInt(rawLimit, 10) : Number.NaN;
	const limit = Number.isFinite(parsedLimit) ? parsedLimit : undefined;

	const entries = await getBoardHistoryEntries(boardId, limit);
	const actorIds = collectUniqueIds(entries.map((entry) => entry.actorId));
	const boardMemberIds = collectUniqueIds([
		board.owner,
		...(board.editors ?? []),
		...(board.viewers ?? [])
	]);
	const metadataUserIds = collectUniqueIds(
		entries.flatMap((entry) => [entry.metadata.userId, entry.metadata.memberUserId])
	);
	const userIds = collectUniqueIds([...actorIds, ...boardMemberIds, ...metadataUserIds]);

	const listIds = collectUniqueIds(
		entries.flatMap((entry) => [
			entry.metadata.listId,
			entry.metadata.fromListId,
			entry.metadata.toListId
		])
	);
	const cardIds = collectUniqueIds(entries.flatMap((entry) => [entry.metadata.cardId]));

	const [userProfiles, listProfiles, cardProfiles] = await Promise.all([
		Promise.all(
			userIds.map(
				async (entryUserId) => [entryUserId, await UserConnector.get(entryUserId as UUID)] as const
			)
		),
		Promise.all(
			listIds.map(
				async (listId) => [listId, normalizeText(await rdb.hget(`list:${listId}`, 'name'))] as const
			)
		),
		Promise.all(
			cardIds.map(
				async (cardId) => [cardId, normalizeText(await rdb.hget(`card:${cardId}`, 'name'))] as const
			)
		)
	]);

	const userNameById = new Map<string, string>(
		userProfiles.map(([entryUserId, user]) => [
			entryUserId,
			resolveActorDisplayName({
				userId: entryUserId,
				username: user?.username,
				email: user?.email
			})
		])
	);
	const listNameById = new Map<string, string>(
		listProfiles.filter(([, listName]) => listName.length > 0)
	);
	const cardNameById = new Map<string, string>(
		cardProfiles.filter(([, cardName]) => cardName.length > 0)
	);
	const identifierReplacements = new Map<string, string>();

	for (const [entryUserId, displayName] of userNameById) {
		identifierReplacements.set(entryUserId, displayName);
	}
	for (const [listId, listName] of listNameById) {
		identifierReplacements.set(listId, listName);
	}
	for (const [cardId, cardName] of cardNameById) {
		identifierReplacements.set(cardId, cardName);
	}

	for (const entry of entries) {
		const listId = normalizeId(entry.metadata.listId);
		const listName = normalizeText(entry.metadata.name);
		if (listId && listName) {
			identifierReplacements.set(listId, listName);
		}

		const fromListId = normalizeId(entry.metadata.fromListId);
		const fromListName = normalizeText(entry.metadata.fromListName);
		if (fromListId && fromListName) {
			identifierReplacements.set(fromListId, fromListName);
		}

		const toListId = normalizeId(entry.metadata.toListId);
		const toListName = normalizeText(entry.metadata.toListName);
		if (toListId && toListName) {
			identifierReplacements.set(toListId, toListName);
		}

		const cardId = normalizeId(entry.metadata.cardId);
		const cardName = normalizeText(entry.metadata.cardName);
		if (cardId && cardName) {
			identifierReplacements.set(cardId, cardName);
		}
	}

	return json({
		entries: entries.map((entry) => ({
			id: entry.id,
			source: entry.source,
			action: entry.action,
			message: replaceIdsWithLabels(entry.message, identifierReplacements),
			createdAt: entry.createdAt,
			metadata: entry.metadata,
			actor: {
				id: entry.actorId,
				name: entry.actorId ? (userNameById.get(entry.actorId) ?? entry.actorId) : 'System'
			}
		}))
	});
};
