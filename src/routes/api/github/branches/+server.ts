import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import {
	BoardConnector,
	CardConnector,
	UserConnector,
	rdb,
	type UUID
} from '$lib/server/redisConnector';
import { getBoardIdFromCard, requireBoardAccess } from '$lib/server/boardAccess';

function slugifyBranchPart(value: string) {
	return value
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/-+/g, '-');
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

function encodeGitRefPath(value: string) {
	return value
		.split('/')
		.map((segment) => encodeURIComponent(segment))
		.join('/');
}

export const POST: RequestHandler = async ({ request }) => {
	const { cardId, userId, branchName } = await request.json();

	if (!cardId || !userId) {
		throw error(400, 'cardId and userId required');
	}

	const boardId = await getBoardIdFromCard(String(cardId));
	if (!boardId) {
		throw error(404, 'Board not found for card');
	}

	await requireBoardAccess(boardId as UUID, userId, 'edit');

	const board = await BoardConnector.get(boardId as UUID);
	if (!board) {
		throw error(404, 'Board not found');
	}

	if (!board.github_enabled) {
		throw error(400, 'GitHub is not enabled for this board');
	}

	if (!board.github_repo_owner || !board.github_repo_name || !board.github_base_branch) {
		throw error(400, 'GitHub board configuration is incomplete');
	}

	const githubToken = await UserConnector.getGithubToken(userId as UUID);
	if (!githubToken) {
		throw error(400, 'GitHub account not connected');
	}
	const user = await UserConnector.get(userId as UUID);
	if (!user) {
		throw error(404, 'User not found');
	}
	const repoCounterKey = `github_repo:${board.github_repo_owner}:${board.github_repo_name}:branch_counter`;
	const repoLockKey = `github_repo:${board.github_repo_owner}:${board.github_repo_name}:branch_lock`;
	const lockValue = crypto.randomUUID();
	const card = await CardConnector.get(cardId as UUID);
	if (!card) {
		throw error(404, 'Card not found');
	}

	if (card.github_branch_name && card.github_branch_status === 'created') {
		throw error(400, 'A GitHub branch already exists for this card');
	}

	const cardSlug = slugifyBranchPart(card.name || 'card');
	const githubLogin = slugifyBranchPart(user.github_login || user.username || 'user');

	const existingLock = await rdb.get(repoLockKey);
	if (existingLock) {
		throw error(409, 'Another branch is being created for this repo, try again.');
	}

	await rdb.set(repoLockKey, lockValue);

	let normalizedBranchName = '';

	try {
		let nextBranchNumber: number | null = null;

		if (typeof branchName === 'string' && branchName.trim()) {
			normalizedBranchName = slugifyBranchPart(branchName.trim());
		} else {
			const currentCounterRaw = await rdb.get(repoCounterKey);
			const currentCounter = Number.parseInt(String(currentCounterRaw ?? '0'), 10);
			nextBranchNumber = Number.isFinite(currentCounter) ? currentCounter + 1 : 1;

			normalizedBranchName = `${nextBranchNumber}-${cardSlug}-${githubLogin}`;
		}

		const githubUserAgent = 'EpiTrello-GitHub/1.0';

		const refRes = await fetch(
			`https://api.github.com/repos/${board.github_repo_owner}/${board.github_repo_name}/git/ref/heads/${board.github_base_branch}`,
			{
				headers: githubHeaders(githubToken, githubUserAgent)
			}
		);

		if (!refRes.ok) {
			const body = await refRes.text();
			console.error('GitHub base ref error', refRes.status, body);
			throw error(502, 'Unable to read GitHub base branch');
		}

		const refJson = (await refRes.json()) as {
			object?: { sha?: string };
		};

		const baseSha = refJson.object?.sha;
		if (!baseSha) {
			throw error(502, 'GitHub base branch SHA not found');
		}

		const createRes = await fetch(
			`https://api.github.com/repos/${board.github_repo_owner}/${board.github_repo_name}/git/refs`,
			{
				method: 'POST',
				headers: githubHeaders(githubToken, githubUserAgent, {
					'Content-Type': 'application/json'
				}),
				body: JSON.stringify({
					ref: `refs/heads/${normalizedBranchName}`,
					sha: baseSha
				})
			}
		);

		if (!createRes.ok) {
			const body = await createRes.text();
			console.error('GitHub create ref error', createRes.status, body);
			throw error(502, 'Unable to create GitHub branch');
		}

		if (nextBranchNumber !== null) {
			await rdb.set(repoCounterKey, String(nextBranchNumber));
		}

		const branchUrl = `https://github.com/${board.github_repo_owner}/${board.github_repo_name}/tree/${normalizedBranchName}`;

		card.github_branch_name = normalizedBranchName;
		card.github_branch_url = branchUrl;
		card.github_branch_status = 'created';

		await CardConnector.save(card);

		return json({
			ok: true,
			branchName: normalizedBranchName,
			branchUrl
		});
	} finally {
		const currentLockValue = await rdb.get(repoLockKey);
		if (currentLockValue === lockValue) {
			await rdb.del(repoLockKey);
		}
	}
};

export const DELETE: RequestHandler = async ({ request }) => {
	const { cardId, userId } = await request.json();

	if (!cardId || !userId) {
		throw error(400, 'cardId and userId required');
	}

	const boardId = await getBoardIdFromCard(String(cardId));
	if (!boardId) {
		throw error(404, 'Board not found for card');
	}

	await requireBoardAccess(boardId as UUID, userId, 'edit');

	const board = await BoardConnector.get(boardId as UUID);
	if (!board) {
		throw error(404, 'Board not found');
	}

	if (!board.github_enabled || !board.github_repo_owner || !board.github_repo_name) {
		throw error(400, 'GitHub board configuration is incomplete');
	}

	const githubToken = await UserConnector.getGithubToken(userId as UUID);
	if (!githubToken) {
		throw error(400, 'GitHub account not connected');
	}

	const card = await CardConnector.get(cardId as UUID);
	if (!card) {
		throw error(404, 'Card not found');
	}

	if (!card.github_branch_name || card.github_branch_status !== 'created') {
		throw error(400, 'No active GitHub branch found for this card');
	}

	const githubUserAgent = 'EpiTrello-GitHub/1.0';
	const deleteRes = await fetch(
		`https://api.github.com/repos/${board.github_repo_owner}/${board.github_repo_name}/git/refs/heads/${encodeGitRefPath(card.github_branch_name)}`,
		{
			method: 'DELETE',
			headers: githubHeaders(githubToken, githubUserAgent)
		}
	);

	if (!deleteRes.ok) {
		const body = await deleteRes.text();
		const branchAlreadyMissing =
			deleteRes.status === 422 && body.includes('Reference does not exist');
		if (!branchAlreadyMissing) {
			console.error('GitHub delete ref error', deleteRes.status, body);
			throw error(502, 'Unable to delete GitHub branch');
		}
	}

	card.github_branch_status = 'deleted';
	card.github_branch_url = '';

	await CardConnector.save(card);

	return json({
		ok: true,
		branchName: card.github_branch_name,
		status: 'deleted'
	});
};
