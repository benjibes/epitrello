import { beforeEach, describe, expect, it } from 'bun:test';
import {
	boardStateRoute,
	expectHttpErrorStatus,
	resetMockState,
	state
} from './routes-db-mocking.shared';

beforeEach(resetMockState);

describe('api/board-state +server', () => {
	it('GET throws 400 when boardId is missing', async () => {
		await expectHttpErrorStatus(
			boardStateRoute.GET({
				url: new URL('http://localhost/api/board-state')
			} as never),
			400
		);
		expect(state.boardStateGetCalls).toHaveLength(0);
	});

	it('GET returns 404 JSON when no board state is stored', async () => {
		const response = await boardStateRoute.GET({
			url: new URL('http://localhost/api/board-state?boardId=board-1')
		} as never);

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ message: 'Not found' });
		expect(state.boardStateGetCalls).toEqual(['board_state:board-1']);
	});

	it('GET returns parsed board state payload', async () => {
		state.boardStateGetValue = JSON.stringify({
			board_name: 'Roadmap',
			lists: [{ id: 'list-1', name: 'Todo' }]
		});

		const response = await boardStateRoute.GET({
			url: new URL('http://localhost/api/board-state?boardId=board-1')
		} as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			board_name: 'Roadmap',
			lists: [{ id: 'list-1', name: 'Todo' }]
		});
	});

	it('GET throws 500 when stored payload is invalid JSON', async () => {
		state.boardStateGetValue = '{not-json}';

		await expectHttpErrorStatus(
			boardStateRoute.GET({
				url: new URL('http://localhost/api/board-state?boardId=board-1')
			} as never),
			500
		);
	});

	it('POST throws 400 when boardId is missing', async () => {
		await expectHttpErrorStatus(
			boardStateRoute.POST({
				request: new Request('http://localhost/api/board-state', {
					method: 'POST',
					body: JSON.stringify({ board_name: 'Roadmap' })
				})
			} as never),
			400
		);
		expect(state.boardStateSetCalls).toHaveLength(0);
	});

	it('POST stores a normalized payload and returns ok', async () => {
		const response = await boardStateRoute.POST({
			request: new Request('http://localhost/api/board-state', {
				method: 'POST',
				body: JSON.stringify({
					boardId: 'board-1',
					board_name: 'Roadmap',
					lists: 'not-an-array'
				})
			})
		} as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(state.boardStateSetCalls).toEqual([
			{
				key: 'board_state:board-1',
				value: JSON.stringify({
					board_name: 'Roadmap',
					lists: []
				})
			}
		]);
	});
});
