import { beforeEach, describe, expect, it } from 'bun:test';
import { resetMockState, state, usersRoute } from './routes-db-mocking.shared';

beforeEach(resetMockState);

describe('api/users +server', () => {
	it('GET returns 400 when requesterId is missing', async () => {
		const response = await usersRoute.GET({
			url: new URL('http://localhost/api/users')
		} as never);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'requesterId is required' });
	});

	it('GET returns 403 when requester is not admin', async () => {
		state.usersById = {
			'user-1': { uuid: 'user-1', role: 'student', username: 'Alice', email: 'alice@example.com' }
		};

		const response = await usersRoute.GET({
			url: new URL('http://localhost/api/users?requesterId=user-1')
		} as never);

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: 'Forbidden' });
	});

	it('GET returns users list for admin requester', async () => {
		state.usersById = {
			'admin-1': {
				uuid: 'admin-1',
				role: 'admin',
				username: 'Admin',
				email: 'admin@example.com'
			},
			'user-1': { uuid: 'user-1', role: 'student', username: 'Alice', email: 'alice@example.com' }
		};

		const response = await usersRoute.GET({
			url: new URL('http://localhost/api/users?requesterId=admin-1')
		} as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			users: expect.arrayContaining([
				{
					uuid: 'admin-1',
					email: 'admin@example.com',
					username: 'Admin',
					role: 'admin'
				},
				{
					uuid: 'user-1',
					email: 'alice@example.com',
					username: 'Alice',
					role: 'student'
				}
			])
		});
	});

	it('POST returns 403 when requester is not admin', async () => {
		state.usersById = {
			'user-1': { uuid: 'user-1', role: 'student', username: 'Alice', email: 'alice@example.com' }
		};

		const response = await usersRoute.POST({
			request: new Request('http://localhost/api/users', {
				method: 'POST',
				body: JSON.stringify({
					requesterId: 'user-1',
					email: 'teacher@example.com',
					role: 'ape'
				})
			})
		} as never);

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: 'Forbidden' });
		expect(state.loginSaveCalls).toHaveLength(0);
	});

	it('POST creates a new account when requester is admin', async () => {
		state.usersById = {
			'admin-1': {
				uuid: 'admin-1',
				role: 'admin',
				username: 'Admin',
				email: 'admin@example.com'
			}
		};

		const response = await usersRoute.POST({
			request: new Request('http://localhost/api/users', {
				method: 'POST',
				body: JSON.stringify({
					requesterId: 'admin-1',
					email: 'teacher@example.com',
					name: 'Teacher',
					role: 'ape'
				})
			})
		} as never);

		const payload = await response.json();
		expect(response.status).toBe(201);
		expect(payload.ok).toBe(true);
		expect(payload.user.email).toBe('teacher@example.com');
		expect(payload.user.username).toBe('Teacher');
		expect(payload.user.role).toBe('ape');
		expect(state.loginSaveCalls).toHaveLength(1);
		expect(state.loginSaveCalls[0]).toMatchObject({
			email: 'teacher@example.com',
			username: 'Teacher',
			role: 'ape'
		});
	});

	it('PATCH returns 400 when payload is incomplete', async () => {
		const response = await usersRoute.PATCH({
			request: new Request('http://localhost/api/users', {
				method: 'PATCH',
				body: JSON.stringify({ userId: 'user-1' })
			})
		} as never);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: 'userId, requesterId and displayName are required'
		});
		expect(state.userUpdateCalls).toHaveLength(0);
	});

	it('PATCH returns 403 when requester does not match target user', async () => {
		const response = await usersRoute.PATCH({
			request: new Request('http://localhost/api/users', {
				method: 'PATCH',
				body: JSON.stringify({
					userId: 'user-1',
					requesterId: 'user-2',
					displayName: 'Alice'
				})
			})
		} as never);

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: 'Forbidden' });
		expect(state.userUpdateCalls).toHaveLength(0);
	});

	it('PATCH returns 404 when user does not exist', async () => {
		state.boardsUser = null;

		const response = await usersRoute.PATCH({
			request: new Request('http://localhost/api/users', {
				method: 'PATCH',
				body: JSON.stringify({
					userId: 'user-1',
					requesterId: 'user-1',
					displayName: 'Alice'
				})
			})
		} as never);

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: 'User not found' });
		expect(state.userUpdateCalls).toHaveLength(0);
	});

	it('PATCH updates display name when payload is valid', async () => {
		const response = await usersRoute.PATCH({
			request: new Request('http://localhost/api/users', {
				method: 'PATCH',
				body: JSON.stringify({
					userId: 'user-1',
					requesterId: 'user-1',
					displayName: '  Alice Cooper  '
				})
			})
		} as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true, name: 'Alice Cooper' });
		expect(state.userUpdateCalls).toEqual([
			{ userId: 'user-1', updates: { username: 'Alice Cooper' } }
		]);
	});

	it('PATCH allows admin to update another user role', async () => {
		state.usersById = {
			'admin-1': {
				uuid: 'admin-1',
				role: 'admin',
				username: 'Admin',
				email: 'admin@example.com'
			},
			'user-1': { uuid: 'user-1', role: 'student', username: 'Alice', email: 'alice@example.com' }
		};

		const response = await usersRoute.PATCH({
			request: new Request('http://localhost/api/users', {
				method: 'PATCH',
				body: JSON.stringify({
					userId: 'user-1',
					requesterId: 'admin-1',
					role: 'ape'
				})
			})
		} as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true, role: 'ape' });
		expect(state.userRoleUpdateCalls).toEqual([{ userId: 'user-1', role: 'ape' }]);
		expect(state.userUpdateCalls).toHaveLength(0);
	});

	it('DELETE returns 400 when query parameters are missing', async () => {
		const response = await usersRoute.DELETE({
			url: new URL('http://localhost/api/users?id=user-1')
		} as never);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'id and requesterId are required' });
		expect(state.userDeleteCalls).toHaveLength(0);
	});

	it('DELETE returns 403 when requester does not match target user', async () => {
		const response = await usersRoute.DELETE({
			url: new URL('http://localhost/api/users?id=user-1&requesterId=user-2')
		} as never);

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: 'Forbidden' });
		expect(state.userDeleteCalls).toHaveLength(0);
	});

	it('DELETE returns 404 when user does not exist', async () => {
		state.boardsUser = null;

		const response = await usersRoute.DELETE({
			url: new URL('http://localhost/api/users?id=user-1&requesterId=user-1')
		} as never);

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: 'User not found' });
		expect(state.userDeleteCalls).toHaveLength(0);
	});

	it('DELETE removes user account when requester matches', async () => {
		const response = await usersRoute.DELETE({
			url: new URL('http://localhost/api/users?id=user-1&requesterId=user-1')
		} as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(state.userDeleteCalls).toEqual(['user-1']);
	});

	it('DELETE allows admin to remove another user account', async () => {
		state.usersById = {
			'admin-1': {
				uuid: 'admin-1',
				role: 'admin',
				username: 'Admin',
				email: 'admin@example.com'
			},
			'user-1': { uuid: 'user-1', role: 'student', username: 'Alice', email: 'alice@example.com' }
		};

		const response = await usersRoute.DELETE({
			url: new URL('http://localhost/api/users?id=user-1&requesterId=admin-1')
		} as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(state.userDeleteCalls).toEqual(['user-1']);
	});
});
