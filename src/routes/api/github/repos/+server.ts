import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { BoardConnector, UserConnector, type UUID } from '$lib/server/redisConnector';
import { requireBoardAccess } from '$lib/server/boardAccess';

function slugifyGithubRepoName(value: string) {
	return value
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9._-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/-+/g, '-')
		.slice(0, 100);
}

function githubHeaders(token: string, userAgent: string, extraHeaders: Record<string, string> = {}) {
	return {
		Authorization: `Bearer ${token}`,
		Accept: 'application/vnd.github+json',
		'User-Agent': userAgent,
		'X-GitHub-Api-Version': '2022-11-28',
		...extraHeaders
	};
}

async function createGithubRepoForBoard({
	userId,
	boardName
}: {
	userId: UUID;
	boardName: string;
}) {
	const githubToken = await UserConnector.getGithubToken(userId);
	if (!githubToken) {
		throw error(400, 'GitHub account not connected');
	}

	const githubUserAgent = 'EpiTrello-GitHub/1.0';
	const baseRepoName = slugifyGithubRepoName(boardName);
	if (!baseRepoName) {
		throw error(400, 'Unable to derive a valid GitHub repository name from board name');
	}

	let createRepoRes: Response | null = null;
	let createdRepo:
		| {
				name: string;
				default_branch?: string;
				owner?: { login?: string };
		  }
		| null = null;

	for (let attempt = 0; attempt < 6; attempt += 1) {
		const candidateName =
			attempt === 0 ? baseRepoName : `${baseRepoName}-${attempt + 1}`.slice(0, 100);

		createRepoRes = await fetch('https://api.github.com/user/repos', {
			method: 'POST',
			headers: githubHeaders(githubToken, githubUserAgent, {
				'Content-Type': 'application/json'
			}),
			body: JSON.stringify({
				name: candidateName,
				auto_init: true
			})
		});

		if (createRepoRes.ok) {
			createdRepo = (await createRepoRes.json()) as {
				name: string;
				default_branch?: string;
				owner?: { login?: string };
			};
			break;
		}

		const responseText = await createRepoRes.text();
		const repoNameAlreadyExists =
			createRepoRes.status === 422 && responseText.includes('name already exists on this account');

		if (!repoNameAlreadyExists) {
			console.error('GitHub create repo error', createRepoRes.status, responseText);
			throw error(502, 'Unable to create GitHub repository');
		}
	}

	if (!createdRepo) {
		throw error(
			409,
			'A repository with this board name already exists on GitHub. Try renaming the board or unlinking the existing repository.'
		);
	}

	const repoOwner = createdRepo.owner?.login?.trim();
	const createdRepoName = createdRepo.name?.trim();
	const currentDefaultBranch = createdRepo.default_branch?.trim() || 'main';

	if (!repoOwner || !createdRepoName) {
		throw error(502, 'GitHub repository created but response was incomplete');
	}

	if (currentDefaultBranch !== 'main') {
		const refRes = await fetch(
			`https://api.github.com/repos/${repoOwner}/${createdRepoName}/git/ref/heads/${currentDefaultBranch}`,
			{
				headers: githubHeaders(githubToken, githubUserAgent)
			}
		);

		if (!refRes.ok) {
			const body = await refRes.text();
			console.error('GitHub repo default branch read error', refRes.status, body);
			throw error(502, 'Unable to initialize GitHub main branch');
		}

		const refJson = (await refRes.json()) as { object?: { sha?: string } };
		const baseSha = refJson.object?.sha;
		if (!baseSha) {
			throw error(502, 'GitHub repository SHA not found for default branch');
		}

		const createMainRes = await fetch(
			`https://api.github.com/repos/${repoOwner}/${createdRepoName}/git/refs`,
			{
				method: 'POST',
				headers: githubHeaders(githubToken, githubUserAgent, {
					'Content-Type': 'application/json'
				}),
				body: JSON.stringify({
					ref: 'refs/heads/main',
					sha: baseSha
				})
			}
		);

		if (!createMainRes.ok) {
			const body = await createMainRes.text();
			console.error('GitHub create main branch error', createMainRes.status, body);
			throw error(502, 'Unable to create GitHub main branch');
		}

		const patchRepoRes = await fetch(`https://api.github.com/repos/${repoOwner}/${createdRepoName}`, {
			method: 'PATCH',
			headers: githubHeaders(githubToken, githubUserAgent, {
				'Content-Type': 'application/json'
			}),
			body: JSON.stringify({
				default_branch: 'main'
			})
		});

		if (!patchRepoRes.ok) {
			const body = await patchRepoRes.text();
			console.error('GitHub set main default branch error', patchRepoRes.status, body);
			throw error(502, 'Unable to set GitHub main branch as default');
		}
	}

	return {
		repoOwner,
		repoName: createdRepoName,
		baseBranch: 'main'
	};
}

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);

	if (!body?.boardId || !body?.userId) {
		throw error(400, 'boardId and userId required');
	}

	const boardId = String(body.boardId) as UUID;
	const userId = String(body.userId) as UUID;

	await requireBoardAccess(boardId, userId, 'owner');

	const board = await BoardConnector.get(boardId);
	if (!board) {
		throw error(404, 'Board not found');
	}

	if (board.github_enabled && board.github_repo_owner && board.github_repo_name) {
		throw error(400, 'A GitHub repository is already linked to this board');
	}

	const githubRepo = await createGithubRepoForBoard({
		userId,
		boardName: board.name
	});

	board.github_enabled = true;
	board.github_repo_owner = githubRepo.repoOwner;
	board.github_repo_name = githubRepo.repoName;
	board.github_base_branch = githubRepo.baseBranch;

	await BoardConnector.save(board);

	return json({
		ok: true,
		repoOwner: githubRepo.repoOwner,
		repoName: githubRepo.repoName,
		baseBranch: githubRepo.baseBranch
	});
};

export const DELETE: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);

	if (!body?.boardId || !body?.userId) {
		throw error(400, 'boardId and userId required');
	}

	const boardId = String(body.boardId) as UUID;
	const userId = String(body.userId) as UUID;
	const deleteOnGithub = Boolean(body.deleteOnGithub);

	await requireBoardAccess(boardId, userId, 'owner');

	const board = await BoardConnector.get(boardId);
	if (!board) {
		throw error(404, 'Board not found');
	}

	if (!board.github_repo_owner || !board.github_repo_name) {
		board.github_enabled = false;
		board.github_repo_owner = '';
		board.github_repo_name = '';
		board.github_base_branch = '';
		await BoardConnector.save(board);
		return json({ ok: true, status: 'unlinked' });
	}

	if (deleteOnGithub) {
		const githubToken = await UserConnector.getGithubToken(userId);
		if (!githubToken) {
			throw error(400, 'GitHub account not connected');
		}

		const githubUserAgent = 'EpiTrello-GitHub/1.0';
		const deleteRepoRes = await fetch(
			`https://api.github.com/repos/${board.github_repo_owner}/${board.github_repo_name}`,
			{
				method: 'DELETE',
				headers: githubHeaders(githubToken, githubUserAgent)
			}
		);

		if (!deleteRepoRes.ok) {
			const bodyText = await deleteRepoRes.text();
			const repoAlreadyMissing =
				deleteRepoRes.status === 404 && bodyText.toLowerCase().includes('not found');

			if (!repoAlreadyMissing) {
				console.error('GitHub delete repo error', deleteRepoRes.status, bodyText);
				throw error(502, 'Unable to delete GitHub repository');
			}
		}
	}

	board.github_enabled = false;
	board.github_repo_owner = '';
	board.github_repo_name = '';
	board.github_base_branch = '';
	await BoardConnector.save(board);

	return json({
		ok: true,
		status: deleteOnGithub ? 'deleted' : 'unlinked'
	});
};
