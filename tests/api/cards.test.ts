import { beforeEach, describe, expect, it } from 'bun:test';
import {
	cardsRoute,
	expectHttpErrorStatus,
	resetMockState,
	state
} from './routes-db-mocking.shared';

beforeEach(resetMockState);

describe('api/cards +server', () => {
	it('POST throws 400 when listId or title is missing', async () => {
		await expectHttpErrorStatus(
			cardsRoute.POST({
				request: new Request('http://localhost/api/cards', {
					method: 'POST',
					body: JSON.stringify({})
				})
			} as never),
			400
		);
		expect(state.cardsCreateCalls).toHaveLength(0);
		expect(state.rdbSaddCalls).toHaveLength(0);
	});

	it('POST creates a card and links it to list cards set', async () => {
		state.cardsCreatedCardId = 'card-22';

		const response = await cardsRoute.POST({
			request: new Request('http://localhost/api/cards', {
				method: 'POST',
				body: JSON.stringify({ listId: 'list-3', title: 'Implement tests' })
			})
		} as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ id: 'card-22', title: 'Implement tests' });
		expect(state.cardsCreateCalls).toEqual([{ listId: 'list-3', title: 'Implement tests' }]);
		expect(state.rdbSaddCalls).toContainEqual({ key: 'list:list-3:cards', value: 'card-22' });
	});

	it('POST throws 500 when connector fails', async () => {
		state.cardsCreateError = new Error('create card failed');

		await expectHttpErrorStatus(
			cardsRoute.POST({
				request: new Request('http://localhost/api/cards', {
					method: 'POST',
					body: JSON.stringify({ listId: 'list-3', title: 'Implement tests' })
				})
			} as never),
			500
		);
	});

	it('PATCH throws 400 when cardId is missing', async () => {
		await expectHttpErrorStatus(
			cardsRoute.PATCH({
				request: new Request('http://localhost/api/cards', {
					method: 'PATCH',
					body: JSON.stringify({ name: 'Renamed card' })
				})
			} as never),
			400
		);
		expect(state.rdbHsetCalls).toHaveLength(0);
	});

	it('PATCH updates card name when provided', async () => {
		const response = await cardsRoute.PATCH({
			request: new Request('http://localhost/api/cards', {
				method: 'PATCH',
				body: JSON.stringify({ cardId: 'card-1', name: 'Renamed card' })
			})
		} as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(state.rdbHsetCalls).toEqual([{ key: 'card:card-1', values: { name: 'Renamed card' } }]);
		expect(state.rdbSremCalls).toHaveLength(0);
		expect(state.rdbSaddCalls).toHaveLength(0);
	});

	it('PATCH updates card completed state when provided', async () => {
		const response = await cardsRoute.PATCH({
			request: new Request('http://localhost/api/cards', {
				method: 'PATCH',
				body: JSON.stringify({ cardId: 'card-1', completed: true })
			})
		} as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(state.rdbHsetCalls).toEqual([{ key: 'card:card-1', values: { completed: 1 } }]);
	});

	it('PATCH updates card description and due date when provided', async () => {
		const response = await cardsRoute.PATCH({
			request: new Request('http://localhost/api/cards', {
				method: 'PATCH',
				body: JSON.stringify({
					cardId: 'card-1',
					description: 'Ship v1 with editor',
					dueDate: '2026-02-20'
				})
			})
		} as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(state.rdbHsetCalls).toEqual([
			{ key: 'card:card-1', values: { description: 'Ship v1 with editor' } },
			{ key: 'card:card-1', values: { dueDate: '2026-02-20' } }
		]);
	});

	it('PATCH replaces assignees set when assignees are provided', async () => {
		const response = await cardsRoute.PATCH({
			request: new Request('http://localhost/api/cards', {
				method: 'PATCH',
				body: JSON.stringify({
					cardId: 'card-1',
					assignees: [' Alice ', '', 'Bob']
				})
			})
		} as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(state.rdbDelCalls).toEqual(['card:card-1:assignees']);
		expect(state.rdbSaddCalls).toEqual([
			{ key: 'card:card-1:assignees', value: 'Alice' },
			{ key: 'card:card-1:assignees', value: 'Bob' }
		]);
	});

	it('PATCH reorders a card inside the same list when targetIndex is provided', async () => {
		state.rdbSmembersValues['list:list-a:cards'] = ['card-1', 'card-2', 'card-3'];
		state.rdbHgetValues['card:card-1:order'] = '0';
		state.rdbHgetValues['card:card-2:order'] = '1';
		state.rdbHgetValues['card:card-3:order'] = '2';

		const response = await cardsRoute.PATCH({
			request: new Request('http://localhost/api/cards', {
				method: 'PATCH',
				body: JSON.stringify({
					cardId: 'card-1',
					fromListId: 'list-a',
					toListId: 'list-a',
					targetIndex: 1
				})
			})
		} as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(state.rdbSremCalls).toHaveLength(0);
		expect(state.rdbSaddCalls).toHaveLength(0);
		expect(state.rdbHsetCalls).toEqual([
			{ key: 'card:card-2', values: { list: 'list-a', order: 0 } },
			{ key: 'card:card-1', values: { list: 'list-a', order: 1 } },
			{ key: 'card:card-3', values: { list: 'list-a', order: 2 } }
		]);
	});

	it('PATCH moves a card between lists when both list ids are provided', async () => {
		const response = await cardsRoute.PATCH({
			request: new Request('http://localhost/api/cards', {
				method: 'PATCH',
				body: JSON.stringify({
					cardId: 'card-1',
					fromListId: 'list-a',
					toListId: 'list-b'
				})
			})
		} as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(state.rdbSremCalls).toEqual([{ key: 'list:list-a:cards', value: 'card-1' }]);
		expect(state.rdbSaddCalls).toEqual([{ key: 'list:list-b:cards', value: 'card-1' }]);
		expect(state.rdbHsetCalls).toEqual([{ key: 'card:card-1', values: { list: 'list-b' } }]);
	});

	it('PATCH does not move card when fromListId and toListId are identical', async () => {
		const response = await cardsRoute.PATCH({
			request: new Request('http://localhost/api/cards', {
				method: 'PATCH',
				body: JSON.stringify({
					cardId: 'card-1',
					fromListId: 'list-a',
					toListId: 'list-a'
				})
			})
		} as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(state.rdbSremCalls).toHaveLength(0);
		expect(state.rdbSaddCalls).toHaveLength(0);
		expect(state.rdbHsetCalls).toHaveLength(0);
	});

	it('DELETE removes card using query parameter id', async () => {
		const response = await cardsRoute.DELETE({
			url: new URL('http://localhost/api/cards?id=card-77'),
			request: new Request('http://localhost/api/cards?id=card-77', { method: 'DELETE' })
		} as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(state.cardsDelCalls).toEqual(['card-77']);
	});

	it('DELETE removes card using JSON body fallback', async () => {
		const response = await cardsRoute.DELETE({
			url: new URL('http://localhost/api/cards'),
			request: new Request('http://localhost/api/cards', {
				method: 'DELETE',
				body: JSON.stringify({ cardId: 'card-12' })
			})
		} as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(state.cardsDelCalls).toEqual(['card-12']);
	});

	it('DELETE throws 400 when card id cannot be resolved', async () => {
		await expectHttpErrorStatus(
			cardsRoute.DELETE({
				url: new URL('http://localhost/api/cards'),
				request: new Request('http://localhost/api/cards', {
					method: 'DELETE',
					body: '{}'
				})
			} as never),
			400
		);
		expect(state.cardsDelCalls).toHaveLength(0);
	});

	it('DELETE throws 500 when connector fails', async () => {
		state.cardsDelError = new Error('delete card failed');

		await expectHttpErrorStatus(
			cardsRoute.DELETE({
				url: new URL('http://localhost/api/cards?id=card-77'),
				request: new Request('http://localhost/api/cards?id=card-77', { method: 'DELETE' })
			} as never),
			500
		);
	});
});
