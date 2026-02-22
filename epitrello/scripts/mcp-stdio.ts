import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const baseUrl = (process.env.EPITRELLO_BASE_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
const rpcEndpoint = `${baseUrl}/api/mcp`;

type RpcSuccess = {
	jsonrpc: '2.0';
	id: string | number | null;
	result: unknown;
};

type RpcError = {
	jsonrpc: '2.0';
	id: string | number | null;
	error: {
		code: number;
		message: string;
		data?: unknown;
	};
};

function isRpcError(payload: unknown): payload is RpcError {
	return Boolean(
		payload &&
			typeof payload === 'object' &&
			'error' in payload &&
			(payload as { error?: unknown }).error
	);
}

async function callRpc(method: string, params?: Record<string, unknown>) {
	const id = `rpc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
	const response = await fetch(rpcEndpoint, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			jsonrpc: '2.0',
			id,
			method,
			...(params ? { params } : {})
		})
	});

	const payload = (await response.json()) as RpcSuccess | RpcError;
	if (!response.ok || isRpcError(payload)) {
		const message =
			isRpcError(payload) ? payload.error.message : `Request failed with status ${response.status}`;
		throw new Error(message);
	}

	return payload.result;
}

function normalizeToolResult(result: unknown) {
	if (result && typeof result === 'object' && 'content' in result) {
		return result as {
			content: Array<{ type: string; text: string }>;
			isError?: boolean;
			structuredContent?: unknown;
		};
	}

	return {
		content: [{ type: 'text', text: JSON.stringify(result ?? {}) }],
		structuredContent: result ?? {}
	};
}

const server = new McpServer(
	{
		name: 'epitrello-stdio-mcp',
		version: '1.0.0'
	},
	{
		capabilities: {
			tools: {}
		}
	}
);

server.tool(
	'create_board',
	'Creates a board for an owner.',
	{
		ownerId: z.string(),
		name: z.string()
	},
	async ({ ownerId, name }) =>
		normalizeToolResult(
			await callRpc('tools/call', {
				name: 'create_board',
				arguments: { ownerId, name }
			})
		)
);

server.tool(
	'create_list',
	'Creates a list inside a board.',
	{
		boardId: z.string(),
		name: z.string(),
		userId: z.string().optional()
	},
	async ({ boardId, name, userId }) =>
		normalizeToolResult(
			await callRpc('tools/call', {
				name: 'create_list',
				arguments: { boardId, name, userId }
			})
		)
);

server.tool(
	'create_card',
	'Creates a card in a list.',
	{
		listId: z.string(),
		title: z.string(),
		userId: z.string().optional()
	},
	async ({ listId, title, userId }) =>
		normalizeToolResult(
			await callRpc('tools/call', {
				name: 'create_card',
				arguments: { listId, title, userId }
			})
		)
);

server.tool(
	'add_tag',
	'Adds a label tag to a card.',
	{
		cardId: z.string(),
		name: z.string(),
		userId: z.string().optional()
	},
	async ({ cardId, name, userId }) =>
		normalizeToolResult(
			await callRpc('tools/call', {
				name: 'add_tag',
				arguments: { cardId, name, userId }
			})
		)
);

server.tool(
	'get_board_full',
	'Returns a fully hydrated board (lists/cards/members).',
	{
		boardId: z.string(),
		userId: z.string()
	},
	async ({ boardId, userId }) =>
		normalizeToolResult(
			await callRpc('tools/call', {
				name: 'get_board_full',
				arguments: { boardId, userId }
			})
		)
);

async function start() {
	await callRpc('initialize').catch(() => null);
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

start().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`[mcp-stdio] startup failed: ${message}`);
	process.exit(1);
});
