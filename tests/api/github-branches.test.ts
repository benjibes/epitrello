import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

const state = {
	board: {
		uuid: 'board-1',
		name: 'Roadmap',
		owner: 'user-1',
		github_enabled: true,
		github_repo_owner: 'octocat',
		github_repo_name: 'hello-world',
		github_base_branch: 'main'
	},
	card: {
		uuid: 'card-1',
		list: 'list-1',
		name: 'Implement feature',
		description: '',
		order: 0,
		date: '',
		completed: false,
		github_branch_name: '',
		github_branch_url: '',
		github_branch_status: ''
	},
	githubToken: 'gho_test_token',
	cardSaveCalls: [] as Array<Record<string, unknown>>,
	boardAccessCalls: [] as Array<{ boardId: string; userId: string; mode: string }>
};

mock.module('@sveltejs/kit', () => ({
	json: (data: unknown, init?: ResponseInit) =>
		new Response(JSON.stringify(data), {
			status: init?.status ?? 200,
			headers: {
				'content-type': 'application/json',
				...(init?.headers ?? {})
			}
		}),
	error: (status: number, body?: string) => {
		throw { status, body };
	}
}));

mock.module('$lib/server/redisConnector', () => ({
	BoardConnector: {
		get: async () => state.board
	},
	CardConnector: {
		get: async () => state.card,
		save: async (card: Record<string, unknown>) => {
			state.cardSaveCalls.push(card);
			state.card = card as typeof state.card;
		}
	},
	UserConnector: {
		getGithubToken: async () => state.githubToken
	}
}));

mock.module('$lib/server/boardAccess', () => ({
	getBoardIdFromCard: async () => 'board-1',
	requireBoardAccess: async (boardId: string, userId: string, mode: string) => {
		state.boardAccessCalls.push({ boardId, userId, mode });
		return { board: state.board, role: 'owner' };
	}
}));

const githubBranchesRoute = await import('../../src/routes/api/github/branches/+server');

const originalFetch = globalThis.fetch;

const expectHttpErrorStatus = async (maybePromise: PromiseLike<unknown> | unknown, status: number) => {
	try {
		await maybePromise;
		throw new Error('Expected handler to throw an HttpError');
	} catch (error: unknown) {
		expect((error as { status?: number } | null)?.status).toBe(status);
	}
};

beforeEach(() => {
	state.board = {
		uuid: 'board-1',
		name: 'Roadmap',
		owner: 'user-1',
		github_enabled: true,
		github_repo_owner: 'octocat',
		github_repo_name: 'hello-world',
		github_base_branch: 'main'
	};
	state.card = {
		uuid: 'card-1',
		list: 'list-1',
		name: 'Implement feature',
		description: '',
		order: 0,
		date: '',
		completed: false,
		github_branch_name: '',
		github_branch_url: '',
		github_branch_status: ''
	};
	state.githubToken = 'gho_test_token';
	state.cardSaveCalls.length = 0;
	state.boardAccessCalls.length = 0;
	globalThis.fetch = originalFetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe('api/github/branches +server', () => {
	it('POST creates a GitHub branch and saves it on the card', async () => {
		const fetchMock = mock(async (input: string | URL, init?: RequestInit) => {
			const url = String(input);

			if (url.endsWith('/git/ref/heads/main')) {
				expect(init?.method).toBeUndefined();
				return new Response(JSON.stringify({ object: { sha: 'abc123' } }), { status: 200 });
			}

			if (url.endsWith('/git/refs')) {
				expect(init?.method).toBe('POST');
				expect(init?.body).toBe(
					JSON.stringify({
						ref: 'refs/heads/feature/test-branch',
						sha: 'abc123'
					})
				);
				return new Response(JSON.stringify({ ref: 'refs/heads/feature/test-branch' }), {
					status: 201
				});
			}

			throw new Error(`Unexpected fetch call: ${url}`);
		});

		globalThis.fetch = fetchMock as typeof fetch;

		const response = await githubBranchesRoute.POST({
			request: new Request('http://localhost/api/github/branches', {
				method: 'POST',
				body: JSON.stringify({
					cardId: 'card-1',
					userId: 'user-1',
					branchName: 'feature/test-branch'
				})
			})
		} as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			ok: true,
			branchName: 'feature/test-branch',
			branchUrl: 'https://github.com/octocat/hello-world/tree/feature/test-branch'
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(state.boardAccessCalls).toEqual([
			{ boardId: 'board-1', userId: 'user-1', mode: 'edit' }
		]);
		expect(state.cardSaveCalls).toEqual([
			{
				uuid: 'card-1',
				list: 'list-1',
				name: 'Implement feature',
				description: '',
				order: 0,
				date: '',
				completed: false,
				github_branch_name: 'feature/test-branch',
				github_branch_url: 'https://github.com/octocat/hello-world/tree/feature/test-branch',
				github_branch_status: 'created'
			}
		]);
	});

	it('POST throws 400 when the GitHub token is missing', async () => {
		state.githubToken = '';

		await expectHttpErrorStatus(
			githubBranchesRoute.POST({
				request: new Request('http://localhost/api/github/branches', {
					method: 'POST',
					body: JSON.stringify({
						cardId: 'card-1',
						userId: 'user-1'
					})
				})
			} as never),
			400
		);

		expect(state.cardSaveCalls).toHaveLength(0);
	});
});
