import { beforeEach, describe, expect, it } from 'bun:test';
import {
	boardFullRoute,
	expectHttpErrorStatus,
	resetMockState,
	state
} from './routes-db-mocking.shared';

beforeEach(resetMockState);

describe('api/board-full +server', () => {
	it('GET throws 400 when boardId is missing', async () => {
		await expectHttpErrorStatus(
			boardFullRoute.GET({
				url: new URL('http://localhost/api/board-full')
			} as never),
			400
		);
		expect(state.getFullBoardCalls).toHaveLength(0);
	});

	it('GET throws 400 when userId is missing', async () => {
		await expectHttpErrorStatus(
			boardFullRoute.GET({
				url: new URL('http://localhost/api/board-full?boardId=board-1')
			} as never),
			400
		);
		expect(state.getFullBoardCalls).toHaveLength(0);
	});

	it('GET throws 404 when board does not exist', async () => {
		state.getFullBoardValue = null;

		await expectHttpErrorStatus(
			boardFullRoute.GET({
				url: new URL('http://localhost/api/board-full?boardId=board-404&userId=user-1')
			} as never),
			404
		);
		expect(state.getFullBoardCalls).toEqual(['board-404']);
	});

	it('GET returns hydrated board response with tag names', async () => {
		state.getFullBoardValue = {
			board: { uuid: 'board-1', name: 'Roadmap' },
			lists: [
				{
					uuid: 'list-1',
					name: 'Todo',
					order: 1,
					cards: [
						{ uuid: 'card-1', name: 'Implement integration tests', order: 2, completed: true }
					]
				},
				{
					uuid: 'list-2',
					name: 'Done',
					order: 2,
					cards: []
				}
			]
		};
		state.rdbSmembersValues['card:card-1:tags'] = ['tag-1', 'tag-2', 'tag-3'];
		state.rdbHgetallValues['tag:tag-1'] = { name: 'backend' };
		state.rdbHgetallValues['tag:tag-2'] = { name: 'urgent' };
		state.rdbHgetallValues['tag:tag-3'] = { color: 'gray' };

		const response = await boardFullRoute.GET({
			url: new URL('http://localhost/api/board-full?boardId=board-1&userId=user-1')
		} as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			board: {
				id: 'board-1',
				name: 'Roadmap',
				role: 'owner',
				canEdit: true,
				canManage: true,
				members: [{ userId: 'user-1', role: 'owner', username: '', email: '' }]
			},
			lists: [
				{
					uuid: 'list-1',
					name: 'Todo',
					order: 1,
					cards: [
						{
							uuid: 'card-1',
							title: 'Implement integration tests',
							description: '',
							dueDate: '',
							assignees: [],
							order: 2,
							completed: true,
							tags: ['backend', 'urgent']
						}
					]
				},
				{
					uuid: 'list-2',
					name: 'Done',
					order: 2,
					cards: []
				}
			]
		});
		expect(state.getFullBoardCalls).toEqual(['board-1']);
		expect(state.rdbSmembersCalls).toEqual(['card:card-1:tags', 'card:card-1:assignees']);
		expect(state.rdbHgetCalls).toEqual([
			{ key: 'card:card-1', field: 'dueDate' },
			{ key: 'card:card-1', field: 'description' }
		]);
		expect(state.rdbHgetallCalls).toEqual(['tag:tag-1', 'tag:tag-2', 'tag:tag-3']);
	});
});
