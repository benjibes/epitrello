import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { requireBoardAccess } from '$lib/server/boardAccess';
import { getFullBoard, type UUID } from '$lib/server/redisConnector';

type PlannerOperation =
	| { type: 'create_list'; listName: string }
	| { type: 'create_card'; listName: string; cardTitle: string }
	| { type: 'add_tag'; cardTitle: string; tagName: string };

function normalizeText(value: unknown) {
	if (typeof value !== 'string') {
		return '';
	}

	return value.trim();
}

function parseOperation(raw: unknown): PlannerOperation | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return null;
	}

	const item = raw as Record<string, unknown>;
	const type = normalizeText(item.type);

	if (type === 'create_list') {
		const listName = normalizeText(item.listName);
		return listName ? { type, listName } : null;
	}

	if (type === 'create_card') {
		const listName = normalizeText(item.listName);
		const cardTitle = normalizeText(item.cardTitle);
		return listName && cardTitle ? { type, listName, cardTitle } : null;
	}

	if (type === 'add_tag') {
		const cardTitle = normalizeText(item.cardTitle);
		const tagName = normalizeText(item.tagName);
		return cardTitle && tagName ? { type, cardTitle, tagName } : null;
	}

	return null;
}

function extractJsonObject(rawText: string) {
	const trimmed = rawText.trim();
	if (!trimmed) {
		return null;
	}

	try {
		return JSON.parse(trimmed);
	} catch {
		const start = trimmed.indexOf('{');
		const end = trimmed.lastIndexOf('}');
		if (start >= 0 && end > start) {
			try {
				return JSON.parse(trimmed.slice(start, end + 1));
			} catch {
				return null;
			}
		}
		return null;
	}
}

function resolveProviderEndpoint(provider: string) {
	if (provider === 'openrouter') {
		return 'https://openrouter.ai/api/v1/chat/completions';
	}

	return 'https://api.openai.com/v1/chat/completions';
}

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as
		| {
				boardId?: unknown;
				userId?: unknown;
				prompt?: unknown;
				provider?: unknown;
				model?: unknown;
				apiKey?: unknown;
		  }
		| null;

	const boardId = normalizeText(body?.boardId);
	const userId = normalizeText(body?.userId);
	const prompt = normalizeText(body?.prompt);
	const provider = normalizeText(body?.provider || 'openai').toLowerCase();
	const model = normalizeText(body?.model);
	const apiKey = normalizeText(body?.apiKey);

	if (!boardId || !userId || !prompt || !model || !apiKey) {
		throw error(400, 'boardId, userId, prompt, provider, model and apiKey are required');
	}

	if (provider !== 'openai' && provider !== 'openrouter') {
		throw error(400, 'provider must be openai or openrouter');
	}

	await requireBoardAccess(boardId as UUID, userId, 'edit');

	const boardSnapshot = await getFullBoard(boardId as UUID);
	const listsSnapshot = (boardSnapshot?.lists ?? []).map((list) => ({
		name: list.name,
		cards: (list.cards ?? []).map((card) => card.name)
	}));

	const response = await fetch(resolveProviderEndpoint(provider), {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${apiKey}`
		},
		body: JSON.stringify({
			model,
			temperature: 0,
			messages: [
				{
					role: 'system',
					content:
						'Convert user request into JSON operations for a kanban board. Output ONLY JSON with shape {"operations":[...]} and no markdown.'
				},
				{
					role: 'user',
					content: JSON.stringify({
						task:
							'Generate operations using only these types: create_list(listName), create_card(listName, cardTitle), add_tag(cardTitle, tagName).',
						rules: [
							'Prefer existing list/card names when possible.',
							'Keep order as requested by user.',
							'Do not invent extra operations.',
							'Return valid JSON only.'
						],
						boardContext: listsSnapshot,
						prompt
					})
				}
			]
		})
	});

	if (!response.ok) {
		const providerError = await response.text();
		throw error(502, `AI provider error: ${providerError.slice(0, 220)}`);
	}

	const payload = (await response.json()) as {
		choices?: Array<{ message?: { content?: string | Array<{ text?: string; type?: string }> } }>;
	};
	const content = payload?.choices?.[0]?.message?.content;
	const rawText = Array.isArray(content)
		? content
				.map((part) => (part?.type === 'text' ? normalizeText(part.text) : ''))
				.filter((part) => part.length > 0)
				.join('\n')
		: normalizeText(content);

	const parsed = extractJsonObject(rawText);
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw error(502, 'AI output is not valid JSON');
	}

	const operationsRaw = (parsed as { operations?: unknown }).operations;
	if (!Array.isArray(operationsRaw)) {
		throw error(502, 'AI output missing operations array');
	}

	const operations = operationsRaw
		.map((operation) => parseOperation(operation))
		.filter((operation): operation is PlannerOperation => operation !== null);

	if (operations.length === 0) {
		throw error(502, 'AI returned no valid operations');
	}

	return json({
		ok: true,
		provider,
		model,
		operationCount: operations.length,
		operations
	});
};
