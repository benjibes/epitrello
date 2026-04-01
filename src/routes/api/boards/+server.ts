import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { rdb } from '$lib/server/redisConnector';
import type { UUID } from 'crypto';
import {
	UserConnector,
	BoardConnector,
	ListConnector,
	CardConnector,
	TagConnector
} from '$lib/server/redisConnector';
import { requireBoardAccess } from '$lib/server/boardAccess';
import { notifyBoardUpdated } from '$lib/server/boardEvents';
import { getVisibleBoardsForUser } from '$lib/server/boardVisibility';

const MAX_SEARCH_QUERY_LENGTH = 120;
const MAX_SEARCH_LIMIT = 20;
const DEFAULT_SEARCH_LIMIT = 8;

type BoardTemplate = {
	id: 'product_roadmap' | 'sprint_planning' | 'personal_project';
	name: string;
	lists: Array<{
		name: string;
		cards: Array<{
			title: string;
			tags?: string[];
		}>;
	}>;
};

const BOARD_TEMPLATES: BoardTemplate[] = [
	{
		id: 'product_roadmap',
		name: 'Product Roadmap',
		lists: [
			{
				name: 'Ideas',
				cards: [
					{ title: 'Collect customer feedback', tags: ['research'] },
					{ title: 'Define next quarter outcomes', tags: ['strategy'] },
					{ title: 'Finalize roadmap v1', tags: ['planning'] },
					{ title: 'Prepare stakeholder review', tags: ['alignment'] },
					{ title: 'Validate onboarding concept', tags: ['ux'] }
				]
			},
			{
				name: 'Planned',
				cards: []
			},
			{
				name: 'In Progress',
				cards: []
			},
			{
				name: 'Released',
				cards: []
			}
		]
	},
	{
		id: 'sprint_planning',
		name: 'Sprint Planning',
		lists: [
			{
				name: 'Backlog',
				cards: [
					{ title: 'Collect user stories', tags: ['planning'] },
					{ title: 'Refine acceptance criteria', tags: ['analysis'] },
					{ title: 'Prepare sprint goal', tags: ['priority'] },
					{ title: 'Break down tasks', tags: ['planning'] },
					{ title: 'Validate completed tasks', tags: ['quality'] }
				]
			},
			{
				name: 'Todo',
				cards: []
			},
			{
				name: 'Doing',
				cards: []
			},
			{
				name: 'Review',
				cards: []
			},
			{
				name: 'Done',
				cards: []
			}
		]
	},
	{
		id: 'personal_project',
		name: 'Personal Project',
		lists: [
			{
				name: 'Inbox',
				cards: [
					{ title: 'Capture project ideas', tags: ['brainstorm'] },
					{ title: 'List next actions', tags: ['planning'] },
					{ title: 'Create weekly goal', tags: ['focus'] },
					{ title: 'Timebox first milestone', tags: ['schedule'] },
					{ title: 'Work 30 min on core task', tags: ['habit'] },
					{ title: 'Set up project workspace', tags: ['setup'] }
				]
			},
			{
				name: 'Next',
				cards: []
			},
			{
				name: 'In Progress',
				cards: []
			},
			{
				name: 'Done',
				cards: []
			}
		]
	}
];

function normalizeText(value: string | null) {
	return typeof value === 'string' ? value.trim() : '';
}

function parseSearchLimit(value: string | null) {
	const parsed = Number.parseInt(String(value ?? ''), 10);
	if (!Number.isFinite(parsed)) {
		return DEFAULT_SEARCH_LIMIT;
	}

	return Math.min(MAX_SEARCH_LIMIT, Math.max(1, parsed));
}

function boardMatchesSearch(boardName: string, boardId: string, ownerName: string, query: string) {
	if (!query) {
		return true;
	}

	const normalizedName = boardName.toLowerCase();
	const normalizedId = boardId.toLowerCase();
	const normalizedOwnerName = ownerName.toLowerCase();
	return (
		normalizedName.includes(query) ||
		normalizedId.includes(query) ||
		normalizedOwnerName.includes(query)
	);
}

function compareBoardsByName<T extends { name: string }>(left: T, right: T) {
	return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
}

function resolveBoardTemplate(templateId: unknown) {
	const normalizedTemplateId = typeof templateId === 'string' ? templateId.trim() : '';
	if (!normalizedTemplateId) {
		return null;
	}

	return BOARD_TEMPLATES.find((template) => template.id === normalizedTemplateId) ?? null;
}

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
	const repoName = slugifyGithubRepoName(boardName);
	if (!repoName) {
		throw error(400, 'Unable to derive a valid GitHub repository name from board name');
	}

	const createRepoRes = await fetch('https://api.github.com/user/repos', {
		method: 'POST',
		headers: githubHeaders(githubToken, githubUserAgent, {
			'Content-Type': 'application/json'
		}),
		body: JSON.stringify({
			name: repoName,
			auto_init: true
		})
	});

	if (!createRepoRes.ok) {
		const body = await createRepoRes.text();
		console.error('GitHub create repo error', createRepoRes.status, body);
		throw error(502, 'Unable to create GitHub repository');
	}

	const createdRepo = (await createRepoRes.json()) as {
		name: string;
		default_branch?: string;
		owner?: { login?: string };
	};

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

async function seedBoardFromTemplate(boardId: string, template: BoardTemplate) {
	let createdCardCount = 0;

	for (const list of template.lists) {
		const listId = await ListConnector.create(boardId as UUID, list.name);

		for (const card of list.cards) {
			const currentCardIds = await rdb.smembers(`list:${listId}:cards`);
			const cardId = await CardConnector.create(listId as UUID, card.title);

			await rdb.sadd(`list:${listId}:cards`, cardId);
			await rdb.hset(`card:${cardId}`, {
				list: String(listId),
				order: currentCardIds.length
			});
			createdCardCount += 1;

			for (const tagName of card.tags ?? []) {
				const tagId = await TagConnector.create(cardId as UUID, tagName, 'label', 'gray');
				await rdb.sadd(`card:${cardId}:tags`, tagId);
			}
		}
	}

	return {
		listCount: template.lists.length,
		cardCount: createdCardCount
	};
}

export const GET: RequestHandler = async ({ url }) => {
	const userId = normalizeText(url.searchParams.get('userId'));
	if (!userId) {
		return json({ error: 'userId is required' }, { status: 400 });
	}

	const query = normalizeText(url.searchParams.get('q'));
	if (query.length > MAX_SEARCH_QUERY_LENGTH) {
		return json(
			{ error: `q cannot exceed ${MAX_SEARCH_QUERY_LENGTH} characters` },
			{ status: 400 }
		);
	}

	const visibility = await getVisibleBoardsForUser(userId as UUID);
	if (!visibility) {
		return json({ error: 'User not found' }, { status: 404 });
	}

	const normalizedQuery = query.toLowerCase();
	const searchLimit = parseSearchLimit(url.searchParams.get('limit'));

	const normalizedOwnedBoards = visibility.ownedBoards
		.filter((board) => boardMatchesSearch(board.name, board.uuid, board.ownerName, normalizedQuery))
		.sort(compareBoardsByName)
		.slice(0, searchLimit)
		.map((board) => ({ ...board }));

	const normalizedSharedBoards = visibility.sharedBoards
		.filter((board) => boardMatchesSearch(board.name, board.uuid, board.ownerName, normalizedQuery))
		.sort(compareBoardsByName)
		.slice(0, searchLimit)
		.map((board) => ({ ...board }));

	return json({
		query,
		ownedBoards: normalizedOwnedBoards,
		sharedBoards: normalizedSharedBoards
	});
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);

	if (!body || !body.ownerId || !body.name) {
		return json({ error: 'ownerId et name sont requis' }, { status: 400 });
	}

	const ownerId = body.ownerId as UUID;
	const name = String(body.name).trim();
	const createGithubRepo = Boolean(body.createGithubRepo);

	if (!name) {
		return json({ error: 'Le nom du board ne peut pas être vide' }, { status: 400 });
	}

	const template = resolveBoardTemplate(body.templateId);
	if (body.templateId && !template) {
		return json({ error: 'Template de board inconnu' }, { status: 400 });
	}

	const user = await UserConnector.get(ownerId);
	if (!user) {
		return json({ error: 'Utilisateur introuvable' }, { status: 404 });
	}

	const uuid = await BoardConnector.create(ownerId, name);

	if (template) {
		try {
			const seeded = await seedBoardFromTemplate(String(uuid), template);
			notifyBoardUpdated({
				boardId: String(uuid),
				actorId: ownerId,
				source: 'board',
				history: {
					action: 'board.template.applied',
					message: `Applied template "${template.name}" (${seeded.listCount} list(s), ${seeded.cardCount} card(s)).`,
					metadata: {
						templateId: template.id,
						templateName: template.name,
						listCount: seeded.listCount,
						cardCount: seeded.cardCount
					}
				}
			});
		} catch (seedError) {
			console.error('Erreur seed board template', seedError);
			await BoardConnector.del(uuid as UUID);
			return json({ error: 'Unable to apply board template' }, { status: 500 });
		}
	}

	if (createGithubRepo) {
		try {
			const board = await BoardConnector.get(uuid as UUID);
			if (!board) {
				throw error(404, 'Board not found after creation');
			}

			const githubRepo = await createGithubRepoForBoard({
				userId: ownerId,
				boardName: name
			});

			board.github_enabled = true;
			board.github_repo_owner = githubRepo.repoOwner;
			board.github_repo_name = githubRepo.repoName;
			board.github_base_branch = githubRepo.baseBranch;
			await BoardConnector.save(board);

			notifyBoardUpdated({
				boardId: String(uuid),
				actorId: ownerId,
				source: 'board',
				history: {
					action: 'board.github.repo_linked',
					message: `Linked GitHub repository "${githubRepo.repoOwner}/${githubRepo.repoName}".`,
					metadata: {
						repoOwner: githubRepo.repoOwner,
						repoName: githubRepo.repoName,
						baseBranch: githubRepo.baseBranch
					}
				}
			});
		} catch (githubError) {
			console.error('Erreur create linked GitHub repo', githubError);
			await BoardConnector.del(uuid as UUID);
			if (
				typeof githubError === 'object' &&
				githubError !== null &&
				'status' in githubError &&
				'body' in githubError
			) {
				throw githubError;
			}
			return json({ error: 'Unable to create linked GitHub repository' }, { status: 500 });
		}
	}

	const board = await BoardConnector.get(uuid as UUID);
	const createdBoardName = board?.name ?? name;

	notifyBoardUpdated({
		boardId: String(uuid),
		actorId: ownerId,
		source: 'board',
		history: {
			action: 'board.created',
			message: `Created board "${createdBoardName}".`,
			metadata: { name: createdBoardName }
		}
	});

	if (!board) {
		return json(
			{
				uuid,
				name,
				owner: ownerId
			},
			{ status: 201 }
		);
	}

	return json(
		{
			uuid: board.uuid,
			name: board.name,
			owner: board.owner
		},
		{ status: 201 }
	);
};
export const PATCH: RequestHandler = async ({ request }) => {
	const { boardId, name, userId, githubEnabled, githubRepoOwner, githubRepoName, githubBaseBranch } = await request.json();

	if (!boardId || !userId) {
		throw error(400, 'boardId and userId required');
	}

	await requireBoardAccess(boardId as UUID, userId, 'owner', {
		allowLegacyWithoutUserId: true
	});

	const board = await BoardConnector.get(boardId as UUID);
	if (!board) {
		throw error(404, 'Board not found');
	}

	const normalizedName = typeof name === 'string' ? name.trim() : '';
	if (typeof name === 'string' && !normalizedName) {
		throw error(400, 'name cannot be empty');
	}

	if (githubEnabled && (!githubRepoOwner || !githubRepoName || !githubBaseBranch)) {
		throw error(400, 'GitHub config incomplete');
	}

	if (normalizedName) {
		board.name = normalizedName;
	}
	board.github_enabled = Boolean(githubEnabled);
	board.github_repo_owner = githubEnabled ? (githubRepoOwner ?? '').trim() : '';
	board.github_repo_name = githubEnabled ? (githubRepoName ?? '').trim() : '';
	board.github_base_branch = githubEnabled ? (githubBaseBranch ?? '').trim() : '';
	await BoardConnector.save(board);
	return json({ ok: true, board });
};

export const DELETE: RequestHandler = async ({ url }) => {
	const id = url.searchParams.get('id');
	const userId = url.searchParams.get('userId');

	if (!id) {
		return json({ error: 'Paramètre id manquant' }, { status: 400 });
	}

	await requireBoardAccess(id as UUID, userId, 'owner', {
		allowLegacyWithoutUserId: true
	});

	await BoardConnector.del(id as UUID);

	return json({ ok: true });
};
