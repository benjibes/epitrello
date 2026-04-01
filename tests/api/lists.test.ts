import { beforeEach, describe, expect, it } from 'bun:test';
import {
	expectHttpErrorStatus,
	listsRoute,
	resetMockState,
	state
} from './routes-db-mocking.shared';

beforeEach(resetMockState);

describe('api/lists +server', () => {
	it('POST throws 400 when boardId or name is missing', async () => {
		await expectHttpErrorStatus(
			listsRoute.POST({
				request: new Request('http://localhost/api/lists', {
					method: 'POST',
					body: JSON.stringify({})
				})
			} as never),
			400
		);
		expect(state.listsCreateCalls).toHaveLength(0);
		expect(state.rdbSaddCalls).toHaveLength(0);
	});

	it('POST creates a list and links it to the board', async () => {
		state.listsCreatedListId = 'list-42';

		const response = await listsRoute.POST({
			request: new Request('http://localhost/api/lists', {
				method: 'POST',
				body: JSON.stringify({ boardId: 'board-1', name: 'Todo' })
			})
		} as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ id: 'list-42', name: 'Todo' });
		expect(state.listsCreateCalls).toEqual([{ boardId: 'board-1', name: 'Todo' }]);
		expect(state.rdbSaddCalls).toContainEqual({
			key: 'board:board-1:lists',
			value: 'list-42'
		});
	});

	it('POST allows APE to create a list on a student board', async () => {
		state.boardsBoard = { uuid: 'board-1', name: 'Roadmap', owner: 'student-1' };
		state.usersById = {
			'ape-1': { uuid: 'ape-1', role: 'ape', username: 'APE', email: 'ape@example.com' },
			'student-1': {
				uuid: 'student-1',
				role: 'student',
				username: 'Student',
				email: 'student@example.com'
			}
		};

		const response = await listsRoute.POST({
			request: new Request('http://localhost/api/lists', {
				method: 'POST',
				body: JSON.stringify({ boardId: 'board-1', name: 'Teacher notes', userId: 'ape-1' })
			})
		} as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ id: 'list-1', name: 'Teacher notes' });
		expect(state.listsCreateCalls).toEqual([{ boardId: 'board-1', name: 'Teacher notes' }]);
	});

	it('POST denies APE access on non-student owner boards', async () => {
		state.boardsBoard = { uuid: 'board-1', name: 'Roadmap', owner: 'admin-2' };
		state.usersById = {
			'ape-1': { uuid: 'ape-1', role: 'ape', username: 'APE', email: 'ape@example.com' },
			'admin-2': { uuid: 'admin-2', role: 'admin', username: 'Admin', email: 'admin@example.com' }
		};

		await expectHttpErrorStatus(
			listsRoute.POST({
				request: new Request('http://localhost/api/lists', {
					method: 'POST',
					body: JSON.stringify({ boardId: 'board-1', name: 'Teacher notes', userId: 'ape-1' })
				})
			} as never),
			403
		);
		expect(state.listsCreateCalls).toHaveLength(0);
	});

	it('POST throws 500 when connector fails', async () => {
		state.listsCreateError = new Error('create list failed');

		await expectHttpErrorStatus(
			listsRoute.POST({
				request: new Request('http://localhost/api/lists', {
					method: 'POST',
					body: JSON.stringify({ boardId: 'board-1', name: 'Todo' })
				})
			} as never),
			500
		);
	});

	it('PATCH updates list name', async () => {
		const response = await listsRoute.PATCH({
			request: new Request('http://localhost/api/lists', {
				method: 'PATCH',
				body: JSON.stringify({ listId: 'list-1', name: 'Done' })
			})
		} as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(state.rdbHsetCalls).toEqual([{ key: 'list:list-1', values: { name: 'Done' } }]);
	});

	it('PATCH updates list order', async () => {
		const response = await listsRoute.PATCH({
			request: new Request('http://localhost/api/lists', {
				method: 'PATCH',
				body: JSON.stringify({ listId: 'list-1', order: 3 })
			})
		} as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(state.rdbHsetCalls).toEqual([{ key: 'list:list-1', values: { order: 3 } }]);
	});

	it('PATCH throws 400 when payload is incomplete', async () => {
		await expectHttpErrorStatus(
			listsRoute.PATCH({
				request: new Request('http://localhost/api/lists', {
					method: 'PATCH',
					body: JSON.stringify({ listId: 'list-1' })
				})
			} as never),
			400
		);
		expect(state.rdbHsetCalls).toHaveLength(0);
	});

	it('DELETE throws 400 when id is missing', async () => {
		await expectHttpErrorStatus(
			listsRoute.DELETE({
				url: new URL('http://localhost/api/lists')
			} as never),
			400
		);
		expect(state.listsDelCalls).toHaveLength(0);
	});

	it('DELETE removes list and returns ok', async () => {
		const response = await listsRoute.DELETE({
			url: new URL('http://localhost/api/lists?id=list-9')
		} as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(state.listsDelCalls).toEqual(['list-9']);
	});

	it('DELETE throws 500 when connector fails', async () => {
		state.listsDelError = new Error('delete list failed');

		await expectHttpErrorStatus(
			listsRoute.DELETE({
				url: new URL('http://localhost/api/lists?id=list-9')
			} as never),
			500
		);
	});
});
