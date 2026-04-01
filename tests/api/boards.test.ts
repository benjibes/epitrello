import { beforeEach, describe, expect, it } from 'bun:test';
import {
	boardsRoute,
	expectHttpErrorStatus,
	resetMockState,
	state
} from './routes-db-mocking.shared';

beforeEach(resetMockState);

describe('api/boards +server', () => {
	it('GET includes student boards for APE users', async () => {
		state.usersById = {
			'ape-1': { uuid: 'ape-1', role: 'ape', username: 'Teacher', email: 'ape@example.com' },
			'student-1': {
				uuid: 'student-1',
				role: 'student',
				username: 'Student One',
				email: 'student@example.com'
			}
		};
		state.boardsOwnedByOwnerId['ape-1'] = [];
		state.boardsSharedByUserId['ape-1'] = [];
		state.boardsAll = [{ uuid: 'board-student', name: 'Student board', owner: 'student-1' }];

		const response = await boardsRoute.GET({
			url: new URL('http://localhost/api/boards?userId=ape-1')
		} as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			query: '',
			ownedBoards: [],
			sharedBoards: [
				{
					uuid: 'board-student',
					name: 'Student board',
					owner: 'student-1',
					ownerName: 'Student One',
					role: 'editor'
				}
			]
		});
	});

	it('GET gives admin full access to every board', async () => {
		state.usersById = {
			'admin-1': { uuid: 'admin-1', role: 'admin', username: 'Admin', email: 'admin@example.com' },
			'user-1': { uuid: 'user-1', role: 'student', username: 'Alice', email: 'alice@example.com' }
		};
		state.boardsOwnedByOwnerId['admin-1'] = [];
		state.boardsSharedByUserId['admin-1'] = [];
		state.boardsAll = [{ uuid: 'board-1', name: 'Roadmap', owner: 'user-1' }];

		const response = await boardsRoute.GET({
			url: new URL('http://localhost/api/boards?userId=admin-1')
		} as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			query: '',
			ownedBoards: [],
			sharedBoards: [
				{
					uuid: 'board-1',
					name: 'Roadmap',
					owner: 'user-1',
					ownerName: 'Alice',
					role: 'owner'
				}
			]
		});
	});

	it('POST returns 400 when ownerId or name is missing', async () => {
		const response = await boardsRoute.POST({
			request: new Request('http://localhost/api/boards', {
				method: 'POST',
				body: JSON.stringify({})
			})
		} as never);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'ownerId et name sont requis' });
		expect(state.boardsUserGetCalls).toHaveLength(0);
		expect(state.boardsCreateCalls).toHaveLength(0);
	});

	it('POST returns 404 when the owner does not exist', async () => {
		state.boardsUser = null;

		const response = await boardsRoute.POST({
			request: new Request('http://localhost/api/boards', {
				method: 'POST',
				body: JSON.stringify({ ownerId: 'missing-user', name: 'Roadmap' })
			})
		} as never);

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: 'Utilisateur introuvable' });
		expect(state.boardsCreateCalls).toHaveLength(0);
	});

	it('POST creates a board and returns hydrated board data', async () => {
		state.boardsCreatedBoardId = 'board-42';
		state.boardsBoard = { uuid: 'board-42', name: 'Sprint board', owner: 'user-1' };

		const response = await boardsRoute.POST({
			request: new Request('http://localhost/api/boards', {
				method: 'POST',
				body: JSON.stringify({ ownerId: 'user-1', name: '  Sprint board  ' })
			})
		} as never);

		expect(response.status).toBe(201);
		expect(await response.json()).toEqual({
			uuid: 'board-42',
			name: 'Sprint board',
			owner: 'user-1'
		});
		expect(state.boardsCreateCalls).toEqual([{ ownerId: 'user-1', name: 'Sprint board' }]);
		expect(state.boardsGetCalls).toEqual(['board-42']);
	});

	it('PATCH updates board name in redis and returns ok', async () => {
		const response = await boardsRoute.PATCH({
			request: new Request('http://localhost/api/boards', {
				method: 'PATCH',
				body: JSON.stringify({ boardId: 'board-1', name: 'Renamed board' })
			})
		} as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(state.rdbHsetCalls).toEqual([
			{
				key: 'board:board-1',
				values: { name: 'Renamed board' }
			}
		]);
	});

	it('PATCH allows admin to rename a board owned by another user', async () => {
		state.boardsBoard = { uuid: 'board-1', name: 'Roadmap', owner: 'student-1' };
		state.usersById = {
			'admin-1': { uuid: 'admin-1', role: 'admin', username: 'Admin', email: 'admin@example.com' },
			'student-1': {
				uuid: 'student-1',
				role: 'student',
				username: 'Student',
				email: 'student@example.com'
			}
		};

		const response = await boardsRoute.PATCH({
			request: new Request('http://localhost/api/boards', {
				method: 'PATCH',
				body: JSON.stringify({ boardId: 'board-1', name: 'Admin rename', userId: 'admin-1' })
			})
		} as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(state.rdbHsetCalls).toEqual([
			{
				key: 'board:board-1',
				values: { name: 'Admin rename' }
			}
		]);
	});

	it('PATCH throws 400 when payload is incomplete', async () => {
		await expectHttpErrorStatus(
			boardsRoute.PATCH({
				request: new Request('http://localhost/api/boards', {
					method: 'PATCH',
					body: JSON.stringify({ boardId: 'board-1' })
				})
			} as never),
			400
		);
		expect(state.rdbHsetCalls).toHaveLength(0);
	});

	it('DELETE calls BoardConnector.del and returns ok', async () => {
		const response = await boardsRoute.DELETE({
			url: new URL('http://localhost/api/boards?id=board-99')
		} as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(state.boardsDelCalls).toEqual(['board-99']);
	});
});
