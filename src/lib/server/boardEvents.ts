import { rdb } from '$lib/server/redisConnector';
import { appendBoardHistoryEntry, type BoardHistorySource } from './boardHistory';

type BoardUpdateSource = BoardHistorySource;

export type BoardUpdatedEvent = {
	type: 'board.updated';
	boardId: string;
	actorId: string | null;
	source: BoardUpdateSource;
	emittedAt: string;
};

type BoardEventListener = (event: BoardUpdatedEvent) => void;

const listenersByBoard = new Map<string, Set<BoardEventListener>>();
const BOARD_EVENTS_REDIS_CHANNEL = 'board:events:v1';

let redisSubscriber: Bun.RedisClient | null = null;
let redisSubscriberInitPromise: Promise<void> | null = null;

function normalizeId(value: unknown): string | null {
	if (typeof value !== 'string') {
		return null;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

export function subscribeToBoardEvents(boardId: string, listener: BoardEventListener) {
	const normalizedBoardId = normalizeId(boardId);
	if (!normalizedBoardId) {
		return () => {};
	}

	const listeners = listenersByBoard.get(normalizedBoardId) ?? new Set<BoardEventListener>();
	listeners.add(listener);
	listenersByBoard.set(normalizedBoardId, listeners);
	void ensureRedisSubscriber();

	return () => {
		const existing = listenersByBoard.get(normalizedBoardId);
		if (!existing) return;
		existing.delete(listener);
		if (existing.size === 0) {
			listenersByBoard.delete(normalizedBoardId);
		}
	};
}

function dispatchLocally(event: BoardUpdatedEvent) {
	const listeners = listenersByBoard.get(event.boardId);
	if (!listeners || listeners.size === 0) {
		return;
	}

	for (const listener of listeners) {
		try {
			listener(event);
		} catch (error) {
			console.error('board event listener failed', error);
		}
	}
}

function parseRedisEvent(message: string) {
	try {
		const payload = JSON.parse(message) as Partial<BoardUpdatedEvent> | null;
		if (!payload || payload.type !== 'board.updated') return null;

		const boardId = normalizeId(payload.boardId);
		if (!boardId) return null;

		const source: BoardUpdateSource =
			payload.source === 'board' ||
			payload.source === 'list' ||
			payload.source === 'card' ||
			payload.source === 'tag' ||
			payload.source === 'sharing' ||
			payload.source === 'unknown'
				? payload.source
				: 'unknown';

		return {
			type: 'board.updated' as const,
			boardId,
			actorId: normalizeId(payload.actorId),
			source,
			emittedAt:
				typeof payload.emittedAt === 'string' && payload.emittedAt.length > 0
					? payload.emittedAt
					: new Date().toISOString()
		};
	} catch {
		return null;
	}
}

async function ensureRedisSubscriber() {
	if (redisSubscriber || redisSubscriberInitPromise) {
		return;
	}

	redisSubscriberInitPromise = (async () => {
		const subscriber = await rdb.duplicate();
		await subscriber.subscribe(BOARD_EVENTS_REDIS_CHANNEL, (message) => {
			const parsedEvent = parseRedisEvent(message);
			if (!parsedEvent) {
				return;
			}

			dispatchLocally(parsedEvent);
		});

		redisSubscriber = subscriber;
	})()
		.catch((error) => {
			console.error('board events redis subscriber init failed', error);
		})
		.finally(() => {
			redisSubscriberInitPromise = null;
		});

	await redisSubscriberInitPromise;
}

export function notifyBoardUpdated({
	boardId,
	actorId,
	source = 'unknown',
	history
}: {
	boardId: string;
	actorId?: unknown;
	source?: BoardUpdateSource;
	history?: {
		action?: unknown;
		message?: unknown;
		metadata?: unknown;
	};
}) {
	const normalizedBoardId = normalizeId(boardId);
	if (!normalizedBoardId) {
		return;
	}

	const normalizedSource: BoardUpdateSource =
		source === 'board' ||
		source === 'list' ||
		source === 'card' ||
		source === 'tag' ||
		source === 'sharing' ||
		source === 'unknown'
			? source
			: 'unknown';

	const event: BoardUpdatedEvent = {
		type: 'board.updated',
		boardId: normalizedBoardId,
		actorId: normalizeId(actorId),
		source: normalizedSource,
		emittedAt: new Date().toISOString()
	};

	void appendBoardHistoryEntry({
		boardId: normalizedBoardId,
		actorId: event.actorId,
		source: normalizedSource,
		action: history?.action,
		message: history?.message,
		metadata: history?.metadata
	});

	void rdb.publish(BOARD_EVENTS_REDIS_CHANNEL, JSON.stringify(event)).catch((error) => {
		console.error('board event publish failed', error);
		dispatchLocally(event);
	});
}
