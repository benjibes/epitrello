import { rdb } from '$lib/server/redisConnector';

export type BoardHistorySource = 'board' | 'list' | 'card' | 'tag' | 'sharing' | 'unknown';

export type BoardHistoryEntry = {
	id: string;
	boardId: string;
	actorId: string | null;
	source: BoardHistorySource;
	action: string;
	message: string;
	createdAt: string;
	metadata: Record<string, string>;
};

const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 200;
const MAX_STORED_HISTORY_ENTRIES = 300;
const MAX_ACTION_LENGTH = 96;
const MAX_MESSAGE_LENGTH = 320;
const MAX_METADATA_ENTRIES = 12;
const MAX_METADATA_KEY_LENGTH = 48;
const MAX_METADATA_VALUE_LENGTH = 180;

function boardHistoryKey(boardId: string) {
	return `board:${boardId}:history:v1`;
}

function normalizeId(value: unknown): string | null {
	if (typeof value !== 'string') {
		return null;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function normalizeBoundedText(value: unknown, maxLength: number): string | null {
	if (typeof value !== 'string') {
		return null;
	}

	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return null;
	}

	return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function normalizeSource(value: unknown): BoardHistorySource {
	return value === 'board' ||
		value === 'list' ||
		value === 'card' ||
		value === 'tag' ||
		value === 'sharing' ||
		value === 'unknown'
		? value
		: 'unknown';
}

function sanitizeMetadata(value: unknown): Record<string, string> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return {};
	}

	const metadata: Record<string, string> = {};
	let count = 0;

	for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
		if (count >= MAX_METADATA_ENTRIES) {
			break;
		}

		const key = normalizeBoundedText(rawKey, MAX_METADATA_KEY_LENGTH);
		if (!key) {
			continue;
		}

		if (
			typeof rawValue !== 'string' &&
			typeof rawValue !== 'number' &&
			typeof rawValue !== 'boolean'
		) {
			continue;
		}

		const normalizedValue = normalizeBoundedText(String(rawValue), MAX_METADATA_VALUE_LENGTH);
		if (!normalizedValue) {
			continue;
		}

		metadata[key] = normalizedValue;
		count += 1;
	}

	return metadata;
}

function parseHistoryEntry(raw: string): BoardHistoryEntry | null {
	try {
		const payload = JSON.parse(raw) as Partial<BoardHistoryEntry> | null;
		if (!payload) {
			return null;
		}

		const boardId = normalizeId(payload.boardId);
		const id = normalizeId(payload.id);
		const action = normalizeBoundedText(payload.action, MAX_ACTION_LENGTH);
		const message = normalizeBoundedText(payload.message, MAX_MESSAGE_LENGTH);

		if (!boardId || !id || !action || !message) {
			return null;
		}

		return {
			id,
			boardId,
			actorId: normalizeId(payload.actorId),
			source: normalizeSource(payload.source),
			action,
			message,
			createdAt:
				typeof payload.createdAt === 'string' && payload.createdAt.length > 0
					? payload.createdAt
					: new Date().toISOString(),
			metadata: sanitizeMetadata(payload.metadata)
		};
	} catch {
		return null;
	}
}

function resolveFallbackMessage(source: BoardHistorySource) {
	switch (source) {
		case 'board':
			return 'Board updated.';
		case 'list':
			return 'List updated.';
		case 'card':
			return 'Card updated.';
		case 'tag':
			return 'Tag updated.';
		case 'sharing':
			return 'Sharing settings updated.';
		default:
			return 'Board updated.';
	}
}

export async function appendBoardHistoryEntry({
	boardId,
	actorId,
	source = 'unknown',
	action,
	message,
	metadata
}: {
	boardId: string;
	actorId?: unknown;
	source?: BoardHistorySource;
	action?: unknown;
	message?: unknown;
	metadata?: unknown;
}) {
	const normalizedBoardId = normalizeId(boardId);
	if (!normalizedBoardId) {
		return;
	}

	const listRedisClient = rdb as Partial<Pick<Bun.RedisClient, 'lpush' | 'ltrim'>>;
	if (typeof listRedisClient.lpush !== 'function' || typeof listRedisClient.ltrim !== 'function') {
		return;
	}

	const normalizedSource = normalizeSource(source);
	const entry: BoardHistoryEntry = {
		id: Bun.randomUUIDv7(),
		boardId: normalizedBoardId,
		actorId: normalizeId(actorId),
		source: normalizedSource,
		action: normalizeBoundedText(action, MAX_ACTION_LENGTH) ?? `${normalizedSource}.updated`,
		message:
			normalizeBoundedText(message, MAX_MESSAGE_LENGTH) ?? resolveFallbackMessage(normalizedSource),
		createdAt: new Date().toISOString(),
		metadata: sanitizeMetadata(metadata)
	};

	try {
		const key = boardHistoryKey(normalizedBoardId);
		await listRedisClient.lpush(key, JSON.stringify(entry));
		await listRedisClient.ltrim(key, 0, MAX_STORED_HISTORY_ENTRIES - 1);
	} catch (error) {
		console.error('board history append failed', error);
	}
}

export async function getBoardHistoryEntries(boardId: string, limit = DEFAULT_HISTORY_LIMIT) {
	const normalizedBoardId = normalizeId(boardId);
	if (!normalizedBoardId) {
		return [] as BoardHistoryEntry[];
	}

	const safeLimit = Number.isFinite(limit)
		? Math.max(1, Math.min(Math.trunc(limit), MAX_HISTORY_LIMIT))
		: DEFAULT_HISTORY_LIMIT;

	const listRedisClient = rdb as Partial<Pick<Bun.RedisClient, 'lrange'>>;
	if (typeof listRedisClient.lrange !== 'function') {
		return [] as BoardHistoryEntry[];
	}

	try {
		const entries = await listRedisClient.lrange(
			boardHistoryKey(normalizedBoardId),
			0,
			safeLimit - 1
		);
		return entries
			.map((entry) => parseHistoryEntry(String(entry)))
			.filter((entry): entry is BoardHistoryEntry => entry !== null);
	} catch (error) {
		console.error('board history read failed', error);
		return [] as BoardHistoryEntry[];
	}
}
