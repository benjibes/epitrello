import { beforeEach, describe, expect, it } from 'bun:test';
import { mcpRoute, resetMockState, state } from './routes-db-mocking.shared';

beforeEach(resetMockState);

describe('api/mcp +server', () => {
	it('GET returns endpoint metadata', async () => {
		const response = await mcpRoute.GET({} as never);

		expect(response.status).toBe(200);
		const payload = await response.json();
		expect(payload).toMatchObject({
			name: 'epitrello-mcp',
			endpoint: '/api/mcp'
		});
		expect(Array.isArray(payload.methods)).toBe(true);
	});

	it('POST initialize returns protocol and capabilities', async () => {
		const response = await mcpRoute.POST({
			request: new Request('http://localhost/api/mcp', {
				method: 'POST',
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'initialize'
				})
			})
		} as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			jsonrpc: '2.0',
			id: 1,
			result: {
				protocolVersion: '2024-11-05',
				capabilities: {
					tools: {
						listChanged: false
					}
				}
			}
		});
	});

	it('POST tools/list exposes available tools', async () => {
		const response = await mcpRoute.POST({
			request: new Request('http://localhost/api/mcp', {
				method: 'POST',
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 'tools',
					method: 'tools/list'
				})
			})
		} as never);

		expect(response.status).toBe(200);
		const payload = await response.json();
		expect(payload.result.tools.map((tool: { name: string }) => tool.name)).toEqual(
			expect.arrayContaining(['create_board', 'create_list', 'create_card', 'add_tag', 'get_board_full'])
		);
	});

	it('POST tools/call create_board executes underlying route', async () => {
		state.boardsCreatedBoardId = 'board-42';
		state.boardsBoard = { uuid: 'board-42', name: 'Planning', owner: 'user-1' };

		const response = await mcpRoute.POST({
			request: new Request('http://localhost/api/mcp', {
				method: 'POST',
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 'call-1',
					method: 'tools/call',
					params: {
						name: 'create_board',
						arguments: {
							ownerId: 'user-1',
							name: 'Planning'
						}
					}
				})
			})
		} as never);

		expect(response.status).toBe(200);
		const payload = await response.json();
		expect(payload.result.isError).toBeUndefined();
		expect(payload.result.structuredContent).toEqual({
			uuid: 'board-42',
			name: 'Planning',
			owner: 'user-1'
		});
		expect(state.boardsCreateCalls).toEqual([{ ownerId: 'user-1', name: 'Planning' }]);
	});

	it('POST returns method not found for unknown json-rpc method', async () => {
		const response = await mcpRoute.POST({
			request: new Request('http://localhost/api/mcp', {
				method: 'POST',
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 10,
					method: 'unknown/method'
				})
			})
		} as never);

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({
			jsonrpc: '2.0',
			id: 10,
			error: {
				code: -32601,
				message: 'Method not found'
			}
		});
	});
});
