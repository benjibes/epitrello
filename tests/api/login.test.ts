import { beforeEach, describe, expect, it } from 'bun:test';
import { loginRoute, resetMockState, state } from './routes-db-mocking.shared';

beforeEach(resetMockState);

describe('api/login +server', () => {
	it('POST returns 400 when email is missing', async () => {
		const response = await loginRoute.POST({
			request: new Request('http://localhost/api/login', {
				method: 'POST',
				body: JSON.stringify({})
			})
		} as never);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'Email manquant' });
		expect(state.loginGetByEmailCalls).toHaveLength(0);
		expect(state.loginSaveCalls).toHaveLength(0);
	});

	it('POST returns existing user when email already exists', async () => {
		state.loginUsersByEmail['dev@example.com'] = {
			uuid: 'user-42',
			email: 'dev@example.com',
			username: 'Dev',
			role: 'student'
		};

		const response = await loginRoute.POST({
			request: new Request('http://localhost/api/login', {
				method: 'POST',
				body: JSON.stringify({ email: '  DEV@example.com  ' })
			})
		} as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			id: 'user-42',
			email: 'dev@example.com',
			name: 'Dev',
			role: 'student'
		});
		expect(state.loginGetByEmailCalls).toEqual(['dev@example.com']);
		expect(state.loginSaveCalls).toHaveLength(0);
	});

	it('POST creates and saves user with normalized email and derived name', async () => {
		const response = await loginRoute.POST({
			request: new Request('http://localhost/api/login', {
				method: 'POST',
				body: JSON.stringify({ email: '  New.User@Example.com  ' })
			})
		} as never);

		const payload = await response.json();

		expect(response.status).toBe(200);
		expect(payload.email).toBe('new.user@example.com');
		expect(payload.name).toBe('new.user');
		expect(typeof payload.id).toBe('string');
		expect(payload.id.length).toBeGreaterThan(0);
		expect(state.loginGetByEmailCalls).toEqual(['new.user@example.com']);
		expect(state.loginSaveCalls).toHaveLength(1);
		expect(state.loginSaveCalls[0]).toMatchObject({
			uuid: payload.id,
			email: 'new.user@example.com',
			username: 'new.user',
			role: 'student',
			password_hash: '',
			profile_picture_url: ''
		});
		expect(state.loginSaveCalls[0].boards).toEqual([]);
	});

	it('POST uses provided name when creating a new user', async () => {
		const response = await loginRoute.POST({
			request: new Request('http://localhost/api/login', {
				method: 'POST',
				body: JSON.stringify({
					email: 'product.owner@example.com',
					name: 'Product Owner'
				})
			})
		} as never);

		const payload = await response.json();

		expect(response.status).toBe(200);
		expect(payload.name).toBe('Product Owner');
		expect(payload.role).toBe('student');
		expect(state.loginSaveCalls).toHaveLength(1);
		expect(state.loginSaveCalls[0].username).toBe('Product Owner');
	});
});
