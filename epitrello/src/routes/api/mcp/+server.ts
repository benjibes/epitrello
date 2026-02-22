import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import * as boardsApi from '../boards/+server';
import * as listsApi from '../lists/+server';
import * as cardsApi from '../cards/+server';
import * as tagsApi from '../tags/+server';
import * as boardFullApi from '../board-full/+server';

const PROTOCOL_VERSION = '2024-11-05';

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
	jsonrpc?: string;
	id?: JsonRpcId;
	method?: string;
	params?: Record<string, unknown>;
};

type ToolDefinition = {
	name: string;
	description: string;
	inputSchema: {
		type: 'object';
		properties: Record<string, Record<string, unknown>>;
		required?: string[];
	};
};

const tools: ToolDefinition[] = [
	{
		name: 'create_board',
		description: 'Creates a board for an owner.',
		inputSchema: {
			type: 'object',
			properties: {
				ownerId: { type: 'string', description: 'User id of the board owner.' },
				name: { type: 'string', description: 'Board name.' }
			},
			required: ['ownerId', 'name']
		}
	},
	{
		name: 'create_list',
		description: 'Creates a list inside a board.',
		inputSchema: {
			type: 'object',
			properties: {
				boardId: { type: 'string', description: 'Target board id.' },
				name: { type: 'string', description: 'List name.' },
				userId: { type: 'string', description: 'Optional actor user id.' }
			},
			required: ['boardId', 'name']
		}
	},
	{
		name: 'create_card',
		description: 'Creates a card in a list.',
		inputSchema: {
			type: 'object',
			properties: {
				listId: { type: 'string', description: 'Target list id.' },
				title: { type: 'string', description: 'Card title.' },
				userId: { type: 'string', description: 'Optional actor user id.' }
			},
			required: ['listId', 'title']
		}
	},
	{
		name: 'add_tag',
		description: 'Adds a label tag to a card.',
		inputSchema: {
			type: 'object',
			properties: {
				cardId: { type: 'string', description: 'Target card id.' },
				name: { type: 'string', description: 'Tag label.' },
				userId: { type: 'string', description: 'Optional actor user id.' }
			},
			required: ['cardId', 'name']
		}
	},
	{
		name: 'get_board_full',
		description: 'Returns a fully hydrated board (lists/cards/members).',
		inputSchema: {
			type: 'object',
			properties: {
				boardId: { type: 'string', description: 'Target board id.' },
				userId: { type: 'string', description: 'Caller user id.' }
			},
			required: ['boardId', 'userId']
		}
	}
];

function createResult(id: JsonRpcId, result: unknown) {
	return {
		jsonrpc: '2.0',
		id: id ?? null,
		result
	};
}

function createError(id: JsonRpcId, code: number, message: string, data?: unknown) {
	return {
		jsonrpc: '2.0',
		id: id ?? null,
		error: {
			code,
			message,
			...(data !== undefined ? { data } : {})
		}
	};
}

function toRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

async function readResponsePayload(response: Response) {
	const text = await response.text();
	if (!text) {
		return null;
	}

	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

async function executeTool(name: string, args: Record<string, unknown>) {
	if (name === 'create_board') {
		const response = await boardsApi.POST({
			request: new Request('http://localhost/api/boards', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					ownerId: args.ownerId,
					name: args.name
				})
			})
		} as never);
		return response;
	}

	if (name === 'create_list') {
		const response = await listsApi.POST({
			request: new Request('http://localhost/api/lists', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					boardId: args.boardId,
					name: args.name,
					userId: args.userId
				})
			})
		} as never);
		return response;
	}

	if (name === 'create_card') {
		const response = await cardsApi.POST({
			request: new Request('http://localhost/api/cards', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					listId: args.listId,
					title: args.title,
					userId: args.userId
				})
			})
		} as never);
		return response;
	}

	if (name === 'add_tag') {
		const response = await tagsApi.POST({
			request: new Request('http://localhost/api/tags', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					cardId: args.cardId,
					name: args.name,
					userId: args.userId
				})
			})
		} as never);
		return response;
	}

	if (name === 'get_board_full') {
		const boardId = encodeURIComponent(String(args.boardId ?? ''));
		const userId = encodeURIComponent(String(args.userId ?? ''));
		const response = await boardFullApi.GET({
			url: new URL(`http://localhost/api/board-full?boardId=${boardId}&userId=${userId}`)
		} as never);
		return response;
	}

	return null;
}

export const GET: RequestHandler = async () => {
	return json({
		name: 'epitrello-mcp',
		description: 'MCP-like JSON-RPC endpoint for AI tool calls.',
		protocolVersion: PROTOCOL_VERSION,
		endpoint: '/api/mcp',
		methods: ['initialize', 'tools/list', 'tools/call'],
		toolCount: tools.length
	});
};

export const POST: RequestHandler = async ({ request }) => {
	let payload: JsonRpcRequest;
	try {
		payload = (await request.json()) as JsonRpcRequest;
	} catch {
		return json(createError(null, -32700, 'Parse error'), { status: 400 });
	}

	const id = payload?.id ?? null;
	if (payload?.jsonrpc !== '2.0' || typeof payload?.method !== 'string') {
		return json(createError(id, -32600, 'Invalid Request'), { status: 400 });
	}

	if (payload.method === 'initialize') {
		return json(
			createResult(id, {
				protocolVersion: PROTOCOL_VERSION,
				serverInfo: {
					name: 'epitrello-mcp',
					version: '1.0.0'
				},
				capabilities: {
					tools: {
						listChanged: false
					}
				}
			})
		);
	}

	if (payload.method === 'tools/list') {
		return json(createResult(id, { tools }));
	}

	if (payload.method === 'tools/call') {
		const params = toRecord(payload.params);
		const toolName = typeof params.name === 'string' ? params.name : '';
		const args = toRecord(params.arguments);

		if (!toolName) {
			return json(createError(id, -32602, 'Tool name is required'), { status: 400 });
		}

		const tool = tools.find((candidate) => candidate.name === toolName);
		if (!tool) {
			return json(createError(id, -32602, `Unknown tool "${toolName}"`), { status: 400 });
		}

		try {
			const response = await executeTool(toolName, args);
			if (!response) {
				return json(createError(id, -32603, 'Tool dispatch failed'), { status: 500 });
			}

			const payload = await readResponsePayload(response);
			if (!response.ok) {
				return json(
					createResult(id, {
						content: [
							{
								type: 'text',
								text: JSON.stringify(payload ?? { error: `HTTP ${response.status}` })
							}
						],
						isError: true,
						structuredContent: {
							status: response.status,
							body: payload
						}
					})
				);
			}

			return json(
				createResult(id, {
					content: [{ type: 'text', text: JSON.stringify(payload ?? {}) }],
					structuredContent: payload ?? {}
				})
			);
		} catch (error) {
			const typedError = error as { status?: number; body?: unknown; message?: string } | null;
			const message = typedError?.message ?? 'Tool execution failed';
			return json(
				createResult(id, {
					content: [{ type: 'text', text: message }],
					isError: true,
					structuredContent: {
						status: typedError?.status ?? 500,
						body: typedError?.body ?? null
					}
				})
			);
		}
	}

	return json(createError(id, -32601, 'Method not found'), { status: 404 });
};
