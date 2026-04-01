import { beforeEach, describe, expect, it } from 'bun:test';
import {
	expectHttpErrorStatus,
	resetMockState,
	state,
	tagsRoute
} from './routes-db-mocking.shared';

beforeEach(resetMockState);

describe('api/tags +server', () => {
	it('POST throws 400 when cardId or name is missing', async () => {
		await expectHttpErrorStatus(
			tagsRoute.POST({
				request: new Request('http://localhost/api/tags', {
					method: 'POST',
					body: JSON.stringify({})
				})
			} as never),
			400
		);
		expect(state.tagsCreateCalls).toHaveLength(0);
		expect(state.rdbSaddCalls).toHaveLength(0);
	});

	it('POST creates a tag and adds it to card tags set', async () => {
		state.tagsCreatedTagId = 'tag-42';

		const response = await tagsRoute.POST({
			request: new Request('http://localhost/api/tags', {
				method: 'POST',
				body: JSON.stringify({ cardId: 'card-1', name: 'urgent' })
			})
		} as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ id: 'tag-42', name: 'urgent' });
		expect(state.tagsCreateCalls).toEqual([
			{ cardId: 'card-1', name: 'urgent', type: 'label', color: 'gray' }
		]);
		expect(state.rdbSaddCalls).toContainEqual({ key: 'card:card-1:tags', value: 'tag-42' });
	});

	it('POST throws 500 when connector fails', async () => {
		state.tagsCreateError = new Error('create tag failed');

		await expectHttpErrorStatus(
			tagsRoute.POST({
				request: new Request('http://localhost/api/tags', {
					method: 'POST',
					body: JSON.stringify({ cardId: 'card-1', name: 'urgent' })
				})
			} as never),
			500
		);
	});

	it('DELETE throws 400 when body is not valid JSON', async () => {
		await expectHttpErrorStatus(
			tagsRoute.DELETE({
				request: new Request('http://localhost/api/tags', {
					method: 'DELETE',
					body: 'not-json'
				})
			} as never),
			400
		);
	});

	it('DELETE throws 400 when cardId or name is missing', async () => {
		await expectHttpErrorStatus(
			tagsRoute.DELETE({
				request: new Request('http://localhost/api/tags', {
					method: 'DELETE',
					body: JSON.stringify({ cardId: 'card-1' })
				})
			} as never),
			400
		);
	});

	it('DELETE removes only matching tag names', async () => {
		state.rdbSmembersValues['card:card-1:tags'] = ['tag-a', 'tag-b', 'tag-c'];
		state.rdbHgetValues['tag:tag-a:name'] = 'urgent';
		state.rdbHgetValues['tag:tag-b:name'] = 'feature';
		state.rdbHgetValues['tag:tag-c:name'] = 'urgent';

		const response = await tagsRoute.DELETE({
			request: new Request('http://localhost/api/tags', {
				method: 'DELETE',
				body: JSON.stringify({ cardId: 'card-1', name: 'urgent' })
			})
		} as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(state.rdbSremCalls).toEqual([
			{ key: 'card:card-1:tags', value: 'tag-a' },
			{ key: 'card:card-1:tags', value: 'tag-c' }
		]);
		expect(state.rdbDelCalls).toEqual(['tag:tag-a', 'tag:tag-c']);
	});

	it('DELETE returns ok without deleting when no tag matches', async () => {
		state.rdbSmembersValues['card:card-1:tags'] = ['tag-b'];
		state.rdbHgetValues['tag:tag-b:name'] = 'feature';

		const response = await tagsRoute.DELETE({
			request: new Request('http://localhost/api/tags', {
				method: 'DELETE',
				body: JSON.stringify({ cardId: 'card-1', name: 'urgent' })
			})
		} as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(state.rdbSremCalls).toHaveLength(0);
		expect(state.rdbDelCalls).toHaveLength(0);
	});

	it('DELETE throws 500 when redis lookup fails', async () => {
		state.rdbSmembersError = new Error('redis unavailable');

		await expectHttpErrorStatus(
			tagsRoute.DELETE({
				request: new Request('http://localhost/api/tags', {
					method: 'DELETE',
					body: JSON.stringify({ cardId: 'card-1', name: 'urgent' })
				})
			} as never),
			500
		);
	});
});
