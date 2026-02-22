<script lang="ts">
	import UserSearchBar from '../../user_search_bar.svelte';
	import BoardHistoryPanel from './BoardHistoryPanel.svelte';
	import BoardWorkspace from './BoardWorkspace.svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import type {
		BoardFullResponse,
		BoardHistoryResponse,
		BoardMember,
		BoardUpdatedRealtimeEvent,
		UiList
	} from './board.types';

	const { data } = $props<{
		data: {
			board: { id: string; name: string } | undefined;
		};
	}>();

	const boardId = $derived(data.board?.id);

	let ready = $state(false);
	let board_name = $state('Board');
	let currentUserId = $state('');
	let currentUserName = $state('');
	let currentUserEmail = $state('');
	let boardRole = $state<'owner' | 'editor' | 'viewer' | null>(null);
	let canEdit = $state(false);
	let canManage = $state(false);
	let loadError = $state('');
	let inviteMessage = $state('');
	let historyEntries = $state<BoardHistoryResponse['entries']>([]);
	let historyError = $state('');
	let historyLoading = $state(false);
	let historyPanelOpen = $state(false);
	let filtersPanelOpen = $state(false);
	let mcpPanelOpen = $state(false);
	let mcpLoading = $state(false);
	let mcpError = $state('');
	let mcpOutput = $state('');
	let mcpAction = $state<
		'create_list' | 'create_card' | 'add_tag' | 'get_board_full' | 'prompt_assistant'
	>('create_list');
	let mcpListName = $state('');
	let mcpCardTitle = $state('');
	let mcpTagName = $state('');
	let mcpTargetListId = $state('');
	let mcpTargetCardId = $state('');
	let mcpPrompt = $state(
		'list: Todo, Doing, Done\ncard: Todo | Préparer sprint\ncard: Todo | Écrire tests\ntag: Préparer sprint | urgent'
	);
	let mcpUseAiPlanner = $state(false);
	let mcpAiProvider = $state<'openai' | 'openrouter'>('openai');
	let mcpAiModel = $state('gpt-4.1-mini');
	let mcpAiApiKey = $state('');
	let mcpBatchName = $state('');
	let lastAiBatchOperations = $state<UndoOperation[]>([]);
	let lastAiBatchLabel = $state('');
	let aiBatchMutationInFlight = $state(false);

	let lists = $state<UiList[]>([]);
	let boardMembers = $state<BoardMember[]>([]);
	let boardEventsSource = $state<EventSource | null>(null);
	let realtimeReloadTimer = $state<ReturnType<typeof setTimeout> | null>(null);
	let realtimeReloadInFlight = $state(false);
	let realtimeReloadQueued = $state(false);
	let boardSyncKey = $state('');

	type PromptOperation =
		| { type: 'create_list'; listName: string }
		| { type: 'create_card'; listName: string; cardTitle: string }
		| { type: 'add_tag'; cardTitle: string; tagName: string };

	type BatchPreviewEntry = {
		status: 'ok' | 'warning' | 'blocked';
		description: string;
	};

	type UndoOperation =
		| { type: 'delete_list'; listId: string; listName: string }
		| { type: 'delete_card'; cardId: string; cardTitle: string }
		| { type: 'remove_tag'; cardId: string; tagName: string; cardTitle: string };

	let mcpPreviewEntries = $state<BatchPreviewEntry[]>([]);
	let mcpPreviewSummary = $state('');
	let mcpPreviewBlockedCount = $state(0);

	function applyLoadedState(payload: BoardFullResponse) {
		if (!payload || !payload.board) return;

		board_name = payload.board.name ?? board_name;
		boardRole = payload.board.role;
		canEdit = payload.board.canEdit;
		canManage = payload.board.canManage;
		boardMembers = payload.board.members ?? [];

		let localId = 1;
		lists = payload.lists.map((list) => ({
			uuid: list.uuid,
			name: list.name,
			newCardTitle: '',
			cards: list.cards.map((card) => ({
				id: localId++,
				uuid: card.uuid,
				title: card.title,
				description: card.description ?? '',
				dueDate: card.dueDate ?? '',
				assignees: card.assignees ?? [],
				completed: card.completed ?? false,
				tags: card.tags ?? []
			}))
		}));
	}

	async function loadBoardFull(targetBoardId: string | undefined = boardId) {
		if (!browser || !targetBoardId || !currentUserId) return;
		loadError = '';

		try {
			const res = await fetch(
				`/api/board-full?boardId=${targetBoardId}&userId=${encodeURIComponent(currentUserId)}`
			);
			if (boardId !== targetBoardId) {
				return;
			}
			if (!res.ok) {
				loadError = res.status === 403 ? 'Access denied for this board.' : 'Unable to load board.';
				console.warn('Erreur /api/board-full', await res.text());
				return;
			}

			const payload = (await res.json()) as BoardFullResponse;
			if (boardId !== targetBoardId) {
				return;
			}
			applyLoadedState(payload);
		} catch (err) {
			if (boardId !== targetBoardId) {
				return;
			}
			loadError = 'Network error while loading board.';
			console.error('Erreur réseau /api/board-full', err);
		}
	}

	async function loadBoardHistory(options: { silent?: boolean; boardId?: string } = {}) {
		const targetBoardId = options.boardId ?? boardId;
		if (!browser || !targetBoardId || !currentUserId) return;

		const silent = options.silent ?? false;
		if (!silent) {
			historyLoading = true;
			historyError = '';
		}

		try {
			const params = new URLSearchParams({
				boardId: targetBoardId,
				userId: currentUserId,
				limit: '80'
			});
			const res = await fetch(`/api/board-history?${params.toString()}`);
			if (boardId !== targetBoardId) {
				return;
			}
			if (!res.ok) {
				if (!silent || historyEntries.length === 0) {
					historyError =
						res.status === 403
							? 'Access denied for board activity.'
							: 'Unable to load board activity.';
				}
				console.warn('Erreur /api/board-history', await res.text());
				return;
			}

			const payload = (await res.json()) as BoardHistoryResponse;
			if (boardId !== targetBoardId) {
				return;
			}
			historyEntries = Array.isArray(payload.entries) ? payload.entries : [];
			historyError = '';
		} catch (err) {
			if (boardId !== targetBoardId) {
				return;
			}
			if (!silent || historyEntries.length === 0) {
				historyError = 'Network error while loading board activity.';
			}
			console.error('Erreur réseau /api/board-history', err);
		} finally {
			if (!silent) {
				historyLoading = false;
			}
		}
	}

	function toggleHistoryPanel() {
		historyPanelOpen = !historyPanelOpen;
		if (historyPanelOpen && historyEntries.length === 0 && !historyLoading) {
			void loadBoardHistory();
		}
	}

	const selectableLists = $derived(
		lists
			.filter((list) => typeof list.uuid === 'string' && list.uuid.length > 0)
			.map((list) => ({
				uuid: String(list.uuid),
				name: list.name
			}))
	);

	const selectableCards = $derived(
		lists.flatMap((list) =>
			list.cards
				.filter((card) => typeof card.uuid === 'string' && card.uuid.length > 0)
				.map((card) => ({
					uuid: String(card.uuid),
					title: card.title,
					listName: list.name
				}))
		)
	);

	$effect(() => {
		if (!mcpTargetListId || !selectableLists.some((list) => list.uuid === mcpTargetListId)) {
			mcpTargetListId = selectableLists[0]?.uuid ?? '';
		}
	});

	$effect(() => {
		if (!mcpTargetCardId || !selectableCards.some((card) => card.uuid === mcpTargetCardId)) {
			mcpTargetCardId = selectableCards[0]?.uuid ?? '';
		}
	});

	async function callMcpTool(name: string, args: Record<string, unknown>) {
		const response = await fetch('/api/mcp', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: Date.now(),
				method: 'tools/call',
				params: {
					name,
					arguments: args
				}
			})
		});

		const payload = await response.json();
		if (!response.ok) {
			throw new Error(payload?.error?.message ?? `MCP request failed (${response.status})`);
		}

		return payload;
	}

	function getStructuredContent(payload: unknown): Record<string, unknown> {
		if (!payload || typeof payload !== 'object') {
			return {};
		}

		const root = payload as { result?: unknown };
		if (!root.result || typeof root.result !== 'object') {
			return {};
		}

		const result = root.result as { structuredContent?: unknown };
		if (result.structuredContent && typeof result.structuredContent === 'object') {
			return result.structuredContent as Record<string, unknown>;
		}

		return {};
	}

	function defaultBatchName() {
		const now = new Date();
		const pad = (value: number) => String(value).padStart(2, '0');
		return `ai-batch-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
	}

	function resolveBatchName() {
		const candidate = mcpBatchName.trim();
		return candidate.length > 0 ? candidate : defaultBatchName();
	}

	async function logAiBatchEvent({
		boardId,
		userId,
		batchName,
		phase,
		operationCount
	}: {
		boardId: string;
		userId: string;
		batchName: string;
		phase: 'started' | 'undo_available' | 'undone';
		operationCount: number;
	}) {
		await fetch('/api/ai-batches', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				boardId,
				userId,
				batchName,
				phase,
				operationCount
			})
		});
	}

	function splitValues(raw: string) {
		return raw
			.split(',')
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 0);
	}

	function pushListOperations(operations: PromptOperation[], payload: string) {
		for (const listName of splitValues(payload)) {
			operations.push({ type: 'create_list', listName });
		}
	}

	function pushCardOperations(operations: PromptOperation[], listName: string, payload: string) {
		for (const cardTitle of splitValues(payload)) {
			operations.push({ type: 'create_card', listName: listName.trim(), cardTitle });
		}
	}

	function parsePromptOperations(prompt: string): PromptOperation[] {
		const operations: PromptOperation[] = [];
		const chunks = prompt
			.split(/\n+/)
			.flatMap((line) => line.split(';'))
			.map((line) => line.trim())
			.filter((line) => line.length > 0);

		for (const line of chunks) {
			const lower = line.toLowerCase();

			if (lower.startsWith('list:') || lower.startsWith('liste:')) {
				const payload = line.slice(line.indexOf(':') + 1).trim();
				pushListOperations(operations, payload);
				continue;
			}

			if (
				lower.startsWith('create lists:') ||
				lower.startsWith('create list:') ||
				lower.startsWith('crée listes:') ||
				lower.startsWith('crée liste:') ||
				lower.startsWith('creer listes:') ||
				lower.startsWith('creer liste:')
			) {
				const payload = line.slice(line.indexOf(':') + 1).trim();
				pushListOperations(operations, payload);
				continue;
			}

			if (lower.startsWith('card:') || lower.startsWith('carte:')) {
				const payload = line.slice(line.indexOf(':') + 1).trim();
				const [listNameRaw, cardTitleRaw] = payload.split('|');
				const listName = (listNameRaw ?? '').trim();
				const cardTitle = (cardTitleRaw ?? '').trim();
				if (listName && cardTitle) {
					operations.push({ type: 'create_card', listName, cardTitle });
				}
				continue;
			}

			if (
				lower.startsWith('tag:') ||
				lower.startsWith('étiquette:') ||
				lower.startsWith('etiquette:')
			) {
				const payload = line.slice(line.indexOf(':') + 1).trim();
				const [cardTitleRaw, tagNameRaw] = payload.split('|');
				const cardTitle = (cardTitleRaw ?? '').trim();
				const tagName = (tagNameRaw ?? '').trim();
				if (cardTitle && tagName) {
					operations.push({ type: 'add_tag', cardTitle, tagName });
				}
				continue;
			}

			const createListMatch = line.match(
				/cr[eé]e(?:r)?\s+(?:les?\s+)?listes?\s*:?\s*(.+)$/i
			);
			if (createListMatch) {
				pushListOperations(operations, createListMatch[1]);
				continue;
			}

			const createCardsInListMatch = line.match(
				/(?:ajoute|cr[eé]e(?:r)?)\s+(?:des\s+)?cartes?\s+(?:dans|sur)\s+([^:]+)\s*:?\s*(.+)$/i
			);
			if (createCardsInListMatch) {
				pushCardOperations(operations, createCardsInListMatch[1], createCardsInListMatch[2]);
				continue;
			}

			const createSingleCardMatch = line.match(
				/cr[eé]e(?:r)?\s+(?:une?\s+)?carte\s+(.+)\s+(?:dans|sur)\s+(.+)$/i
			);
			if (createSingleCardMatch) {
				const cardTitle = createSingleCardMatch[1].trim();
				const listName = createSingleCardMatch[2].trim();
				if (listName && cardTitle) {
					operations.push({ type: 'create_card', listName, cardTitle });
				}
				continue;
			}

			const addTagMatch = line.match(
				/(?:ajoute|mets?)\s+(?:le\s+)?tag\s+(.+?)\s+(?:sur|pour|à)\s+(.+)$/i
			);
			if (addTagMatch) {
				const tagName = addTagMatch[1].trim();
				const cardTitle = addTagMatch[2].trim();
				if (cardTitle && tagName) {
					operations.push({ type: 'add_tag', cardTitle, tagName });
				}
			}
		}

		return operations;
	}

	function resetPromptPreview() {
		mcpPreviewEntries = [];
		mcpPreviewSummary = '';
		mcpPreviewBlockedCount = 0;
	}

	function buildPromptPreview(operations: PromptOperation[]) {
		const knownLists = new Set(selectableLists.map((list) => list.name.trim().toLowerCase()));
		const knownCards = new Set(selectableCards.map((card) => card.title.trim().toLowerCase()));
		const previewEntries: BatchPreviewEntry[] = [];
		let warningCount = 0;
		let blockedCount = 0;

		for (const operation of operations) {
			if (operation.type === 'create_list') {
				const normalizedList = operation.listName.trim().toLowerCase();
				if (knownLists.has(normalizedList)) {
					warningCount += 1;
					previewEntries.push({
						status: 'warning',
						description: `Create list "${operation.listName}" (already exists, potential duplicate).`
					});
				} else {
					previewEntries.push({
						status: 'ok',
						description: `Create list "${operation.listName}".`
					});
				}
				knownLists.add(normalizedList);
				continue;
			}

			if (operation.type === 'create_card') {
				const normalizedList = operation.listName.trim().toLowerCase();
				const normalizedCard = operation.cardTitle.trim().toLowerCase();
				if (!knownLists.has(normalizedList)) {
					blockedCount += 1;
					previewEntries.push({
						status: 'blocked',
						description: `Create card "${operation.cardTitle}" in "${operation.listName}" (list not found).`
					});
				} else {
					previewEntries.push({
						status: 'ok',
						description: `Create card "${operation.cardTitle}" in "${operation.listName}".`
					});
				}
				knownCards.add(normalizedCard);
				continue;
			}

			const normalizedCard = operation.cardTitle.trim().toLowerCase();
			if (!knownCards.has(normalizedCard)) {
				blockedCount += 1;
				previewEntries.push({
					status: 'blocked',
					description: `Add tag "${operation.tagName}" on "${operation.cardTitle}" (card not found).`
				});
			} else {
				previewEntries.push({
					status: 'ok',
					description: `Add tag "${operation.tagName}" on "${operation.cardTitle}".`
				});
			}
		}

		mcpPreviewEntries = previewEntries;
		mcpPreviewSummary = `${operations.length} action(s), ${warningCount} warning(s), ${blockedCount} blocked.`;
		mcpPreviewBlockedCount = blockedCount;
	}

	async function planPromptOperationsWithAi() {
		if (!boardId || !currentUserId) {
			throw new Error('Board or user context is missing.');
		}

		const apiKey = mcpAiApiKey.trim();
		const model = mcpAiModel.trim();
		if (!apiKey) {
			throw new Error('AI API key is required when AI planner is enabled.');
		}
		if (!model) {
			throw new Error('AI model is required when AI planner is enabled.');
		}

		const response = await fetch('/api/ai/plan', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				boardId,
				userId: currentUserId,
				prompt: mcpPrompt,
				provider: mcpAiProvider,
				model,
				apiKey
			})
		});
		const payload = (await response.json().catch(() => ({}))) as {
			error?: string;
			message?: string;
			operations?: PromptOperation[];
		};

		if (!response.ok) {
			throw new Error(payload.error ?? payload.message ?? 'AI planner failed.');
		}

		const operations = Array.isArray(payload.operations) ? payload.operations : [];
		if (operations.length === 0) {
			throw new Error('AI planner returned no operations.');
		}

		return operations;
	}

	async function resolvePromptOperations() {
		if (mcpUseAiPlanner) {
			return planPromptOperationsWithAi();
		}

		const operations = parsePromptOperations(mcpPrompt);
		if (operations.length === 0) {
			throw new Error('Prompt not understood. Use syntax: list:, card: list | title, tag: card | tag.');
		}
		return operations;
	}

	async function previewPromptAssistant() {
		const operations = await resolvePromptOperations();
		buildPromptPreview(operations);
	}

	async function runPromptAssistant() {
		if (!boardId || !currentUserId) {
			return;
		}
		if (!canEdit) {
			throw new Error('Read-only mode: you cannot edit this board.');
		}

		aiBatchMutationInFlight = true;
		try {
			const operations = await resolvePromptOperations();
			buildPromptPreview(operations);
			const batchName = resolveBatchName();
			await logAiBatchEvent({
				boardId,
				userId: currentUserId,
				batchName,
				phase: 'started',
				operationCount: operations.length
			});

			const listIdByName = new Map(
				selectableLists.map((list) => [list.name.trim().toLowerCase(), list.uuid] as const)
			);
			const cardIdByTitle = new Map(
				selectableCards.map((card) => [card.title.trim().toLowerCase(), card.uuid] as const)
			);

			const logs: string[] = [];
			const undoOperations: UndoOperation[] = [];

			for (const operation of operations) {
				if (operation.type === 'create_list') {
					const payload = await callMcpTool('create_list', {
						boardId,
						name: operation.listName,
						userId: currentUserId
					});
					const structured = getStructuredContent(payload);
					const createdListId = String(structured.id ?? '');
					if (createdListId) {
						listIdByName.set(operation.listName.trim().toLowerCase(), createdListId);
						undoOperations.push({
							type: 'delete_list',
							listId: createdListId,
							listName: operation.listName
						});
					}
					logs.push(`list created: ${operation.listName}`);
				}

				if (operation.type === 'create_card') {
					const listId = listIdByName.get(operation.listName.trim().toLowerCase());
					if (!listId) {
						throw new Error(`Unknown list "${operation.listName}" for card "${operation.cardTitle}".`);
					}
					const payload = await callMcpTool('create_card', {
						listId,
						title: operation.cardTitle,
						userId: currentUserId
					});
					const structured = getStructuredContent(payload);
					const createdCardId = String(structured.id ?? '');
					if (createdCardId) {
						cardIdByTitle.set(operation.cardTitle.trim().toLowerCase(), createdCardId);
						undoOperations.push({
							type: 'delete_card',
							cardId: createdCardId,
							cardTitle: operation.cardTitle
						});
					}
					logs.push(`card created: ${operation.cardTitle} (list: ${operation.listName})`);
				}

				if (operation.type === 'add_tag') {
					const cardId = cardIdByTitle.get(operation.cardTitle.trim().toLowerCase());
					if (!cardId) {
						throw new Error(`Unknown card "${operation.cardTitle}" for tag "${operation.tagName}".`);
					}
					await callMcpTool('add_tag', {
						cardId,
						name: operation.tagName,
						userId: currentUserId
					});
					undoOperations.push({
						type: 'remove_tag',
						cardId,
						tagName: operation.tagName,
						cardTitle: operation.cardTitle
					});
					logs.push(`tag added: ${operation.tagName} (card: ${operation.cardTitle})`);
				}
			}

			lastAiBatchOperations = undoOperations;
			lastAiBatchLabel = batchName;
			mcpBatchName = batchName;
			await logAiBatchEvent({
				boardId,
				userId: currentUserId,
				batchName,
				phase: 'undo_available',
				operationCount: undoOperations.length
			});

			mcpOutput = JSON.stringify(
				{
					steps: logs,
					operationCount: operations.length,
					undoCount: undoOperations.length
				},
				null,
				2
			);
		} finally {
			aiBatchMutationInFlight = false;
		}
	}

	async function undoLastAiBatch() {
		if (!boardId || !currentUserId || lastAiBatchOperations.length === 0) {
			return;
		}

		mcpLoading = true;
		mcpError = '';
		aiBatchMutationInFlight = true;

		try {
			const logs: string[] = [];
			const operations = [...lastAiBatchOperations].reverse();

			for (const operation of operations) {
				if (operation.type === 'remove_tag') {
					const response = await fetch('/api/tags', {
						method: 'DELETE',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({
							cardId: operation.cardId,
							name: operation.tagName,
							userId: currentUserId
						})
					});

					if (!response.ok) {
						throw new Error(`Undo failed while removing tag "${operation.tagName}".`);
					}
					logs.push(`tag removed: ${operation.tagName} (card: ${operation.cardTitle})`);
				}

				if (operation.type === 'delete_card') {
					const response = await fetch(
						`/api/cards?id=${encodeURIComponent(operation.cardId)}&userId=${encodeURIComponent(currentUserId)}`,
						{
							method: 'DELETE'
						}
					);
					if (!response.ok) {
						throw new Error(`Undo failed while deleting card "${operation.cardTitle}".`);
					}
					logs.push(`card removed: ${operation.cardTitle}`);
				}

				if (operation.type === 'delete_list') {
					const response = await fetch(
						`/api/lists?id=${encodeURIComponent(operation.listId)}&userId=${encodeURIComponent(currentUserId)}`,
						{
							method: 'DELETE'
						}
					);
					if (!response.ok) {
						throw new Error(`Undo failed while deleting list "${operation.listName}".`);
					}
					logs.push(`list removed: ${operation.listName}`);
				}
			}

			lastAiBatchOperations = [];
			const removedBatchName = lastAiBatchLabel || resolveBatchName();
			await logAiBatchEvent({
				boardId,
				userId: currentUserId,
				batchName: removedBatchName,
				phase: 'undone',
				operationCount: operations.length
			});
			lastAiBatchLabel = '';
			mcpOutput = JSON.stringify(
				{
					undo: true,
					steps: logs
				},
				null,
				2
			);
			await Promise.all([loadBoardFull(), loadBoardHistory({ silent: true })]);
		} catch (error) {
			mcpError = error instanceof Error ? error.message : 'Undo failed.';
		} finally {
			mcpLoading = false;
			aiBatchMutationInFlight = false;
		}
	}

	async function clearBoardContent() {
		if (!boardId || !currentUserId) {
			return;
		}
		if (!canManage) {
			throw new Error('Only board owner can clear this board.');
		}

		const confirmed = window.confirm(
			'Clear the whole board content? This deletes all lists, cards and tags.'
		);
		if (!confirmed) {
			return;
		}

		mcpLoading = true;
		mcpError = '';

		try {
			const response = await fetch('/api/board-clear', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					boardId,
					userId: currentUserId
				})
			});
			const payload = (await response.json().catch(() => ({}))) as {
				error?: string;
				message?: string;
				clearedLists?: number;
				clearedCards?: number;
			};

			if (!response.ok) {
				throw new Error(payload.error ?? payload.message ?? 'Unable to clear board.');
			}

			lastAiBatchOperations = [];
			lastAiBatchLabel = '';

			mcpOutput = JSON.stringify(
				{
					cleared: true,
					clearedLists: Number(payload.clearedLists ?? 0),
					clearedCards: Number(payload.clearedCards ?? 0)
				},
				null,
				2
			);

			await Promise.all([loadBoardFull(), loadBoardHistory({ silent: true })]);
		} catch (error) {
			mcpError = error instanceof Error ? error.message : 'Board clear failed.';
		} finally {
			mcpLoading = false;
		}
	}

	async function runBoardMcpAction() {
		if (!browser || !boardId || !currentUserId) {
			return;
		}

		mcpLoading = true;
		mcpError = '';

		try {
			let payload: unknown = null;

			if (mcpAction === 'create_list') {
				if (!canEdit) throw new Error('Read-only mode: you cannot create lists.');
				const name = mcpListName.trim();
				if (!name) throw new Error('List name is required.');
				payload = await callMcpTool('create_list', {
					boardId,
					name,
					userId: currentUserId
				});
			}

			if (mcpAction === 'create_card') {
				if (!canEdit) throw new Error('Read-only mode: you cannot create cards.');
				const title = mcpCardTitle.trim();
				if (!mcpTargetListId) throw new Error('Select a target list first.');
				if (!title) throw new Error('Card title is required.');
				payload = await callMcpTool('create_card', {
					listId: mcpTargetListId,
					title,
					userId: currentUserId
				});
			}

			if (mcpAction === 'add_tag') {
				if (!canEdit) throw new Error('Read-only mode: you cannot add tags.');
				const name = mcpTagName.trim();
				if (!mcpTargetCardId) throw new Error('Select a target card first.');
				if (!name) throw new Error('Tag name is required.');
				payload = await callMcpTool('add_tag', {
					cardId: mcpTargetCardId,
					name,
					userId: currentUserId
				});
			}

			if (mcpAction === 'get_board_full') {
				payload = await callMcpTool('get_board_full', {
					boardId,
					userId: currentUserId
				});
			}

			if (mcpAction === 'prompt_assistant') {
				await runPromptAssistant();
			} else {
				mcpOutput = JSON.stringify(payload ?? {}, null, 2);
				resetPromptPreview();
			}

			if (mcpAction !== 'get_board_full') {
				await Promise.all([loadBoardFull(), loadBoardHistory({ silent: true })]);
			}
		} catch (error) {
			mcpError = error instanceof Error ? error.message : 'MCP action failed.';
		} finally {
			mcpLoading = false;
		}
	}

	async function tryJoinWithInvite(inviteToken: string) {
		if (!browser || !boardId || !currentUserId || !inviteToken) return;

		try {
			const res = await fetch('/api/board-sharing', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					boardId,
					userId: currentUserId,
					inviteToken
				})
			});

			if (!res.ok) {
				inviteMessage = 'Invalid or expired invite link.';
				console.error('Erreur join invite', await res.text());
				return;
			}

			const payload = (await res.json()) as { joined: boolean };
			inviteMessage = payload.joined ? 'You joined this board.' : '';

			const nextUrl = new URL(window.location.href);
			nextUrl.searchParams.delete('invite');
			window.history.replaceState({}, '', nextUrl.toString());
		} catch (err) {
			inviteMessage = 'Unable to join board with invite link.';
			console.error('Erreur réseau join invite', err);
		}
	}

	function stopRealtimeSync() {
		if (boardEventsSource) {
			boardEventsSource.close();
			boardEventsSource = null;
		}
		if (realtimeReloadTimer) {
			clearTimeout(realtimeReloadTimer);
			realtimeReloadTimer = null;
		}
		realtimeReloadInFlight = false;
		realtimeReloadQueued = false;
	}

	async function runRealtimeReload() {
		if (realtimeReloadInFlight) {
			realtimeReloadQueued = true;
			return;
		}

		realtimeReloadInFlight = true;
		try {
			await Promise.all([loadBoardFull(), loadBoardHistory({ silent: true })]);
		} finally {
			realtimeReloadInFlight = false;
			if (realtimeReloadQueued) {
				realtimeReloadQueued = false;
				void runRealtimeReload();
			}
		}
	}

	function scheduleRealtimeReload(delayMs = 120) {
		if (realtimeReloadTimer) {
			clearTimeout(realtimeReloadTimer);
		}

		realtimeReloadTimer = setTimeout(() => {
			realtimeReloadTimer = null;
			void runRealtimeReload();
		}, delayMs);
	}

	function startRealtimeSync() {
		if (!browser || !boardId || !currentUserId) {
			return;
		}

		stopRealtimeSync();

		const params = new URLSearchParams({
			boardId,
			userId: currentUserId
		});
		const source = new EventSource(`/api/board-events?${params.toString()}`);
		boardEventsSource = source;

		source.addEventListener('board-updated', (event: Event) => {
			let actorId: string | null = null;
			try {
				const payload = JSON.parse((event as MessageEvent).data) as BoardUpdatedRealtimeEvent;
				if (typeof payload.actorId === 'string') {
					actorId = payload.actorId;
				}
			} catch (error) {
				void error;
			}

			if (actorId && actorId === currentUserId) {
				if (!aiBatchMutationInFlight && lastAiBatchOperations.length > 0) {
					lastAiBatchOperations = [];
					lastAiBatchLabel = '';
				}
				void loadBoardHistory({ silent: true });
				return;
			}

			scheduleRealtimeReload();
		});
	}

	onMount(() => {
		let cancelled = false;

		const bootstrap = async () => {
			if (!browser) {
				ready = true;
				return;
			}

			const raw = localStorage.getItem('user');
			if (!raw) {
				goto(resolve('/login'));
				return;
			}

			let currentUser: { id?: string; name?: string; email?: string } | null = null;
			try {
				currentUser = JSON.parse(raw);
			} catch {
				localStorage.removeItem('user');
				localStorage.removeItem('authToken');
				goto(resolve('/login'));
				return;
			}

			if (!currentUser?.id) {
				goto(resolve('/login'));
				return;
			}

			currentUserId = currentUser.id;
			currentUserName = currentUser.name ?? '';
			currentUserEmail = currentUser.email ?? '';
			board_name = data.board?.name ?? board_name;

			const inviteToken = new URL(window.location.href).searchParams.get('invite') ?? '';
			if (inviteToken) {
				await tryJoinWithInvite(inviteToken);
			}

			if (cancelled) {
				return;
			}

			ready = true;
		};

		void bootstrap();

		return () => {
			cancelled = true;
			stopRealtimeSync();
		};
	});

	$effect(() => {
		if (mcpAction !== 'prompt_assistant') {
			resetPromptPreview();
		}
	});

	$effect(() => {
		void mcpUseAiPlanner;
		if (mcpAction === 'prompt_assistant') {
			resetPromptPreview();
		}
	});

	$effect(() => {
		if (!browser || !ready || !boardId || !currentUserId) {
			return;
		}

		const nextBoardSyncKey = `${boardId}:${currentUserId}`;
		if (nextBoardSyncKey === boardSyncKey) {
			return;
		}
		boardSyncKey = nextBoardSyncKey;
		board_name = data.board?.name ?? board_name;
		loadError = '';
		historyError = '';
		historyEntries = [];
		historyPanelOpen = false;
		filtersPanelOpen = false;
		boardRole = null;
		canEdit = false;
		canManage = false;
		boardMembers = [];
		lists = [];

		stopRealtimeSync();

		void (async () => {
			await Promise.all([loadBoardFull(boardId), loadBoardHistory({ boardId })]);
			if (boardSyncKey !== nextBoardSyncKey) {
				return;
			}

			startRealtimeSync();
		})();
	});

	async function persistBoardName() {
		if (!browser || !boardId || !canManage) return;

		const name = board_name.trim();
		if (!name) return;

		try {
			await fetch('/api/boards', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ boardId, name, userId: currentUserId })
			});
		} catch (err) {
			console.error('Erreur rename board', err);
		}
	}
</script>

{#if ready}
	<UserSearchBar />
	<div
		class="min-h-[calc(100vh-4rem)] w-screen bg-linear-to-br from-slate-900 via-slate-800 to-sky-900 p-3"
	>
		<div
			class="mb-3 flex items-center gap-3 rounded-xl border border-sky-300/30 bg-slate-800/70 p-3 shadow-md shadow-slate-950/50 backdrop-blur-sm"
		>
			<input
				class="flex-1 rounded-md border-0 bg-transparent px-2 py-1 text-2xl font-bold text-slate-100 transition-colors hover:bg-slate-700/60 focus:outline-0"
				title="Board Name"
				type="text"
				bind:value={board_name}
				placeholder="Board name..."
				readonly={!canManage}
				onblur={persistBoardName}
			/>
			<button
				type="button"
				onclick={toggleHistoryPanel}
				class="hover:cursor-pointer rounded-md border border-sky-300/25 bg-slate-700/75 px-3 py-2 text-sm font-semibold text-slate-100 transition-colors hover:bg-slate-600/90"
				aria-expanded={historyPanelOpen}
				aria-controls="board-history-panel"
			>
				Activity
			</button>
			<button
				type="button"
				onclick={() => (filtersPanelOpen = !filtersPanelOpen)}
				class="hover:cursor-pointer rounded-md border border-sky-300/25 bg-slate-700/75 px-3 py-2 text-sm font-semibold text-slate-100 transition-colors hover:bg-slate-600/90"
				aria-expanded={filtersPanelOpen}
				aria-controls="board-filters-panel"
			>
				Filter
			</button>
			<button
				type="button"
				onclick={() => (mcpPanelOpen = !mcpPanelOpen)}
				class="hover:cursor-pointer rounded-md border border-sky-300/25 bg-slate-700/75 px-3 py-2 text-sm font-semibold text-slate-100 transition-colors hover:bg-slate-600/90"
				aria-expanded={mcpPanelOpen}
				aria-controls="board-mcp-panel"
			>
				AI Tools
			</button>
			{#if boardId && canManage}
				<a
					href={resolve(`/b/${boardId}/settings`)}
					class="rounded-md border border-sky-300/25 bg-slate-700/75 px-3 py-2 text-sm font-semibold text-slate-100 transition-colors hover:bg-slate-600/90"
				>
					Board Settings
				</a>
				<button
					type="button"
					onclick={() => void clearBoardContent()}
					disabled={mcpLoading}
					class="rounded-md border border-rose-300/30 bg-rose-500/15 px-3 py-2 text-sm font-semibold text-rose-100 transition-colors hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-60"
				>
					Clear Board
				</button>
			{/if}
		</div>
		{#if mcpPanelOpen}
			<div
				id="board-mcp-panel"
				class="mb-3 rounded-xl border border-sky-300/20 bg-slate-800/65 p-3 text-slate-100 shadow-sm shadow-slate-950/40"
			>
				<div class="flex flex-wrap items-end gap-2">
					<div class="flex min-w-55 flex-col gap-1">
						<label
							for="board-mcp-action"
							class="select-none text-[11px] font-semibold uppercase tracking-wide text-slate-300"
						>
							Action
						</label>
						<select
							id="board-mcp-action"
							class="rounded-md border border-slate-500/70 bg-slate-700/80 px-2 py-1 text-sm text-slate-100"
							bind:value={mcpAction}
						>
							<option value="create_list">Create list (MCP)</option>
							<option value="create_card">Create card (MCP)</option>
							<option value="add_tag">Add tag (MCP)</option>
							<option value="get_board_full">Inspect board (MCP)</option>
							<option value="prompt_assistant">Prompt IA (multi-actions)</option>
						</select>
					</div>

					{#if mcpAction === 'create_list'}
						<div class="flex min-w-70 flex-col gap-1">
							<label
								for="board-mcp-list-name"
								class="select-none text-[11px] font-semibold uppercase tracking-wide text-slate-300"
							>
								List name
							</label>
							<input
								id="board-mcp-list-name"
								type="text"
								class="rounded-md border border-slate-500/70 bg-slate-700/80 px-2 py-1 text-sm text-slate-100"
								placeholder="Example: Sprint Backlog"
								bind:value={mcpListName}
							/>
						</div>
					{/if}

					{#if mcpAction === 'create_card'}
						<div class="flex min-w-55 flex-col gap-1">
							<label
								for="board-mcp-list"
								class="select-none text-[11px] font-semibold uppercase tracking-wide text-slate-300"
							>
								Target list
							</label>
							<select
								id="board-mcp-list"
								class="rounded-md border border-slate-500/70 bg-slate-700/80 px-2 py-1 text-sm text-slate-100"
								bind:value={mcpTargetListId}
							>
								{#if selectableLists.length === 0}
									<option value="">No list available</option>
								{:else}
									{#each selectableLists as list (list.uuid)}
										<option value={list.uuid}>{list.name}</option>
									{/each}
								{/if}
							</select>
						</div>
						<div class="flex min-w-70 flex-col gap-1">
							<label
								for="board-mcp-card-title"
								class="select-none text-[11px] font-semibold uppercase tracking-wide text-slate-300"
							>
								Card title
							</label>
							<input
								id="board-mcp-card-title"
								type="text"
								class="rounded-md border border-slate-500/70 bg-slate-700/80 px-2 py-1 text-sm text-slate-100"
								placeholder="Example: Implémenter OAuth"
								bind:value={mcpCardTitle}
							/>
						</div>
					{/if}

					{#if mcpAction === 'add_tag'}
						<div class="flex min-w-70 flex-col gap-1">
							<label
								for="board-mcp-card"
								class="select-none text-[11px] font-semibold uppercase tracking-wide text-slate-300"
							>
								Target card
							</label>
							<select
								id="board-mcp-card"
								class="rounded-md border border-slate-500/70 bg-slate-700/80 px-2 py-1 text-sm text-slate-100"
								bind:value={mcpTargetCardId}
							>
								{#if selectableCards.length === 0}
									<option value="">No card available</option>
								{:else}
									{#each selectableCards as card (card.uuid)}
										<option value={card.uuid}>{card.listName} / {card.title}</option>
									{/each}
								{/if}
							</select>
						</div>
						<div class="flex min-w-55 flex-col gap-1">
							<label
								for="board-mcp-tag-name"
								class="select-none text-[11px] font-semibold uppercase tracking-wide text-slate-300"
							>
								Tag name
							</label>
							<input
								id="board-mcp-tag-name"
								type="text"
								class="rounded-md border border-slate-500/70 bg-slate-700/80 px-2 py-1 text-sm text-slate-100"
								placeholder="Example: urgent"
								bind:value={mcpTagName}
							/>
						</div>
					{/if}

					{#if mcpAction === 'prompt_assistant'}
						<div class="flex min-w-[38rem] flex-1 flex-col gap-1">
							<label
								for="board-mcp-batch-name"
								class="select-none text-[11px] font-semibold uppercase tracking-wide text-slate-300"
							>
								Batch name (optional)
							</label>
							<input
								id="board-mcp-batch-name"
								type="text"
								class="rounded-md border border-slate-500/70 bg-slate-700/80 px-2 py-1 text-sm text-slate-100"
								placeholder="ex: sprint-setup-v1"
								bind:value={mcpBatchName}
							/>
							<label
								for="board-mcp-prompt"
								class="select-none text-[11px] font-semibold uppercase tracking-wide text-slate-300"
							>
								Prompt IA
							</label>
							<textarea
								id="board-mcp-prompt"
								rows="5"
								class="rounded-md border border-slate-500/70 bg-slate-700/80 px-2 py-1 text-sm text-slate-100"
								bind:value={mcpPrompt}
							></textarea>
							<label class="mt-1 inline-flex items-center gap-2 text-xs text-slate-300">
								<input
									type="checkbox"
									class="h-4 w-4 rounded border-slate-500/70 bg-slate-700/80"
									bind:checked={mcpUseAiPlanner}
								/>
								Use AI planner (user token + model)
							</label>
							{#if mcpUseAiPlanner}
								<div class="grid grid-cols-1 gap-2 md:grid-cols-3">
									<div class="flex flex-col gap-1">
										<label
											for="board-mcp-ai-provider"
											class="select-none text-[11px] font-semibold uppercase tracking-wide text-slate-300"
										>
											Provider
										</label>
										<select
											id="board-mcp-ai-provider"
											class="rounded-md border border-slate-500/70 bg-slate-700/80 px-2 py-1 text-sm text-slate-100"
											bind:value={mcpAiProvider}
										>
											<option value="openai">OpenAI</option>
											<option value="openrouter">OpenRouter</option>
										</select>
									</div>
									<div class="flex flex-col gap-1">
										<label
											for="board-mcp-ai-model"
											class="select-none text-[11px] font-semibold uppercase tracking-wide text-slate-300"
										>
											Model
										</label>
										<input
											id="board-mcp-ai-model"
											type="text"
											class="rounded-md border border-slate-500/70 bg-slate-700/80 px-2 py-1 text-sm text-slate-100"
											placeholder="gpt-4.1-mini"
											bind:value={mcpAiModel}
										/>
									</div>
									<div class="flex flex-col gap-1">
										<label
											for="board-mcp-ai-key"
											class="select-none text-[11px] font-semibold uppercase tracking-wide text-slate-300"
										>
											API key
										</label>
										<input
											id="board-mcp-ai-key"
											type="password"
											class="rounded-md border border-slate-500/70 bg-slate-700/80 px-2 py-1 text-sm text-slate-100"
											placeholder="sk-..."
											bind:value={mcpAiApiKey}
										/>
									</div>
								</div>
								<p class="text-xs text-slate-400">
									Token is used server-side for this request and not written to board history.
								</p>
							{/if}
							<div class="text-xs text-slate-300">
								<p>{mcpUseAiPlanner ? 'Prompt naturel recommandé:' : 'Format recommandé:'}</p>
								{#if !mcpUseAiPlanner}
									<p><code>list: nom1, nom2, nom3</code></p>
									<p><code>card: listName | cardName</code></p>
									<p><code>tag: cardName | tagName</code></p>
								{/if}
								<p class="mt-1">Exemple naturel:</p>
								<p>
									Crée les listes Todo, Doing, Done; ajoute des cartes dans Todo: Préparer
									sprint, Écrire tests; ajoute le tag urgent sur Préparer sprint
								</p>
							</div>
						</div>
					{/if}

					<button
						type="button"
						class="mb-0.5 h-9 rounded-md bg-sky-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
						onclick={() => void runBoardMcpAction()}
						disabled={mcpLoading || (mcpAction === 'prompt_assistant' && mcpPreviewBlockedCount > 0)}
					>
						{mcpLoading ? 'Running...' : 'Run MCP Action'}
					</button>
					{#if mcpAction === 'prompt_assistant'}
						<button
							type="button"
							class="mb-0.5 h-9 rounded-md border border-cyan-300/40 bg-cyan-500/20 px-3 text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-60"
							onclick={async () => {
								mcpError = '';
								try {
									await previewPromptAssistant();
								} catch (error) {
									mcpError = error instanceof Error ? error.message : 'Preview failed.';
								}
							}}
							disabled={mcpLoading}
						>
							Preview batch
						</button>
					{/if}
					<button
						type="button"
						class="mb-0.5 h-9 rounded-md border border-amber-300/40 bg-amber-500/20 px-3 text-sm font-semibold text-amber-100 transition-colors hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60"
						onclick={() => void undoLastAiBatch()}
						disabled={mcpLoading || lastAiBatchOperations.length === 0}
					>
						Undo last AI batch
					</button>
				</div>

				{#if lastAiBatchOperations.length > 0}
					<p class="mt-2 text-xs text-amber-100/90">
						Undo disponible pour le batch: {lastAiBatchLabel || `${lastAiBatchOperations.length} operations`}
					</p>
				{/if}

				{#if mcpAction === 'prompt_assistant' && mcpPreviewEntries.length > 0}
					<div class="mt-2 rounded-md border border-cyan-300/20 bg-cyan-500/10 p-3 text-xs text-cyan-50">
						<p class="font-semibold text-cyan-100">Batch preview</p>
						<p class="mt-1 text-cyan-100/80">{mcpPreviewSummary}</p>
						<ul class="mt-2 space-y-1">
							{#each mcpPreviewEntries as entry}
								<li class="rounded-sm px-2 py-1 {entry.status === 'blocked'
										? 'bg-rose-500/20 text-rose-100'
										: entry.status === 'warning'
											? 'bg-amber-500/20 text-amber-100'
											: 'bg-emerald-500/20 text-emerald-100'}">
									[{entry.status.toUpperCase()}] {entry.description}
								</li>
							{/each}
						</ul>
					</div>
				{/if}

				{#if mcpError}
					<p class="mt-2 rounded-md border border-rose-300/30 bg-rose-500/15 px-3 py-2 text-sm text-rose-100">
						{mcpError}
					</p>
				{/if}
			</div>
		{/if}
		{#if inviteMessage}
			<p
				class="mb-3 rounded-md border border-emerald-300/30 bg-emerald-500/15 px-3 py-2 text-sm text-emerald-100"
			>
				{inviteMessage}
			</p>
		{/if}
		{#if loadError}
			<p
				class="mb-3 rounded-md border border-rose-300/30 bg-rose-500/15 px-3 py-2 text-sm text-rose-100"
			>
				{loadError}
			</p>
		{/if}
		<p class="mb-1 px-2 text-xs uppercase tracking-wider text-slate-300">
			Role: {boardRole ?? 'unknown'}
			{canEdit ? '(editor access)' : '(read only)'}
		</p>

		<BoardWorkspace
			{boardId}
			{currentUserId}
			{currentUserName}
			{currentUserEmail}
			{canEdit}
			{boardMembers}
			bind:lists
			bind:filtersPanelOpen
		/>
	</div>

	<BoardHistoryPanel
		open={historyPanelOpen}
		{historyLoading}
		{historyError}
		{historyEntries}
		on:close={() => (historyPanelOpen = false)}
		on:refresh={() => void loadBoardHistory()}
	/>
{:else}
	<div
		class="flex min-h-[calc(100vh-4rem)] w-screen items-center justify-center bg-linear-to-br from-slate-900 via-slate-800 to-sky-900"
	>
		<p
			class="rounded-md border border-sky-300/30 bg-slate-900/85 px-3 py-1.5 text-sm text-slate-100 shadow-sm shadow-slate-950/60"
		>
			Chargement du board...
		</p>
	</div>
{/if}
