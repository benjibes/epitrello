import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { requireBoardAccess } from '$lib/server/boardAccess';
import { subscribeToBoardEvents, type BoardUpdatedEvent } from '$lib/server/boardEvents';
import type { UUID } from '$lib/server/redisConnector';

const encoder = new TextEncoder();

function toSseChunk(eventName: string, payload: unknown) {
	return encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
}

export const GET: RequestHandler = async ({ url, request }) => {
	const boardId = url.searchParams.get('boardId');
	const userId = url.searchParams.get('userId');

	if (!boardId) {
		throw error(400, 'boardId required');
	}
	if (!userId) {
		throw error(400, 'userId required');
	}

	await requireBoardAccess(boardId as UUID, userId, 'view');

	let unsubscribe = () => {};
	let heartbeat: ReturnType<typeof setInterval> | null = null;
	let closed = false;

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const cleanup = () => {
				if (closed) return;
				closed = true;
				unsubscribe();
				if (heartbeat) {
					clearInterval(heartbeat);
					heartbeat = null;
				}
			};

			const send = (eventName: string, payload: unknown) => {
				if (closed) return;
				try {
					controller.enqueue(toSseChunk(eventName, payload));
				} catch {
					cleanup();
				}
			};

			send('ready', { boardId, emittedAt: new Date().toISOString() });

			unsubscribe = subscribeToBoardEvents(boardId, (event: BoardUpdatedEvent) => {
				send('board-updated', event);
			});

			heartbeat = setInterval(() => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(': ping\n\n'));
				} catch {
					cleanup();
				}
			}, 25000);

			request.signal.addEventListener('abort', () => {
				cleanup();
				try {
					controller.close();
				} catch (error) {
					void error;
				}
			});
		},
		cancel() {
			if (closed) return;
			closed = true;
			unsubscribe();
			if (heartbeat) {
				clearInterval(heartbeat);
				heartbeat = null;
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
};
