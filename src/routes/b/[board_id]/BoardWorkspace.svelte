<script lang="ts">
	import Card from './card.svelte';
	import BoardCardDetailsModal from './BoardCardDetailsModal.svelte';
	import { buildVisibleLists, extractAllTags, memberLabel } from './board-filters';
	import { moveCardInLists, moveListInLists } from './board-dnd';
	import type { BoardMember, CardRef, DueDateOperator, UiList } from './board.types';

	let {
		boardId,
		currentUserId,
		currentUserName,
		currentUserEmail,
		canEdit,
		boardMembers,
		lists = $bindable(),
		filtersPanelOpen = $bindable()
	}: {
		boardId: string | undefined;
		currentUserId: string;
		currentUserName: string;
		currentUserEmail: string;
		canEdit: boolean;
		boardMembers: BoardMember[];
		lists: UiList[];
		filtersPanelOpen: boolean;
	} = $props();

	let newListName = $state('');
	let assigneeFilter = $state('all');
	let dueDateOperator = $state<DueDateOperator>('none');
	let dueDateFilterValue = $state('');
	let tagFilter = $state('all');
	let nextLocalCardId = 1;
	let selectedCardRef = $state<CardRef | null>(null);
	let selectedCardKey = $state<string | null>(null);
	let draggedCardRef = $state<CardRef | null>(null);
	let cardDropPreview = $state<{ listIndex: number; targetIndex: number } | null>(null);
	let draggedCardHeight = $state(56);
	let draggedListIndex = $state<number | null>(null);
	let listDropPreviewIndex = $state<number | null>(null);

	const selectedList = $derived<UiList | null>(
		selectedCardRef && lists[selectedCardRef.listIndex] ? lists[selectedCardRef.listIndex] : null
	);

	const selectedCard = $derived(
		selectedCardRef && selectedList && selectedList.cards[selectedCardRef.cardIndex]
			? selectedList.cards[selectedCardRef.cardIndex]
			: null
	);

	const hasActiveFilters = $derived(
		assigneeFilter !== 'all' ||
			(dueDateOperator !== 'none' && dueDateFilterValue.trim().length > 0) ||
			tagFilter !== 'all'
	);

	const canDragAndDrop = $derived(canEdit && !hasActiveFilters);

	const allTags = $derived(extractAllTags(lists));

	const visibleLists = $derived(
		buildVisibleLists(lists, {
			assigneeFilter,
			dueDateOperator,
			dueDateFilterValue,
			tagFilter,
			boardMembers,
			currentUser: {
				id: currentUserId,
				name: currentUserName,
				email: currentUserEmail
			}
		})
	);

	function selectionKeyForCard(card: { uuid?: string; id: number }) {
		return card.uuid ? `uuid:${card.uuid}` : `local:${card.id}`;
	}

	$effect(() => {
		const maxId = lists.reduce(
			(currentMax, list) => Math.max(currentMax, ...list.cards.map((card) => card.id), 0),
			0
		);

		if (maxId >= nextLocalCardId) {
			nextLocalCardId = maxId + 1;
		}
	});

	$effect(() => {
		if (!selectedCardKey) {
			selectedCardRef = null;
			return;
		}

		let restoredRef: CardRef | null = null;

		for (let listIndex = 0; listIndex < lists.length; listIndex += 1) {
			const cardIndex = lists[listIndex].cards.findIndex(
				(card) => selectionKeyForCard(card) === selectedCardKey
			);
			if (cardIndex >= 0) {
				restoredRef = { listIndex, cardIndex };
				break;
			}
		}

		if (!restoredRef) {
			selectedCardRef = null;
			selectedCardKey = null;
			return;
		}

		if (
			!selectedCardRef ||
			selectedCardRef.listIndex !== restoredRef.listIndex ||
			selectedCardRef.cardIndex !== restoredRef.cardIndex
		) {
			selectedCardRef = restoredRef;
		}
	});

	function resetFilters() {
		assigneeFilter = 'all';
		dueDateOperator = 'none';
		dueDateFilterValue = '';
		tagFilter = 'all';
	}

	async function addList() {
		if (!canEdit) return;
		const name = newListName.trim();
		if (!name || !boardId || !currentUserId) return;

		try {
			const res = await fetch('/api/lists', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ boardId, name, userId: currentUserId })
			});

			if (!res.ok) {
				console.error('Erreur création liste', await res.text());
				return;
			}

			const payload = (await res.json()) as { id: string; name: string };

			lists = [
				...lists,
				{
					uuid: payload.id,
					name: payload.name,
					cards: [],
					newCardTitle: ''
				}
			];

			newListName = '';
		} catch (err) {
			console.error('Erreur réseau /api/lists', err);
		}
	}

	async function deleteList(index: number) {
		if (!canEdit) return;
		const list = lists[index];
		if (!list) return;

		if (selectedCardRef && selectedCardRef.listIndex === index) {
			closeDetails();
		}

		lists = lists.filter((_, i) => i !== index);
		if (list.uuid) {
			try {
				const userParam = encodeURIComponent(currentUserId);
				const listParam = encodeURIComponent(list.uuid);
				const res = await fetch(`/api/lists?id=${listParam}&userId=${userParam}`, {
					method: 'DELETE'
				});
				if (!res.ok) {
					console.error('Erreur API delete list', await res.text());
				}
			} catch (err) {
				console.error('Erreur réseau delete list', err);
			}
		}
	}

	async function updateListName(index: number, event: Event) {
		if (!canEdit) return;
		const target = event.currentTarget as HTMLInputElement;
		if (!lists[index]) return;

		const newName = target.value;
		lists[index].name = newName;

		const listUuid = lists[index].uuid;
		if (!listUuid) return;

		try {
			await fetch('/api/lists', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ listId: listUuid, name: newName.trim(), userId: currentUserId })
			});
		} catch (err) {
			console.error('Erreur rename list', err);
		}
	}

	function updateListNewCardTitle(index: number, event: Event) {
		const target = event.currentTarget as HTMLInputElement;
		if (!lists[index]) return;
		lists[index].newCardTitle = target.value;
	}

	async function addCard(listIndex: number) {
		if (!canEdit) return;
		const list = lists[listIndex];
		if (!list || !list.uuid) return;

		const title = (list.newCardTitle ?? '').trim();
		if (!title) return;

		const localId = nextLocalCardId++;
		list.cards.push({
			id: localId,
			title,
			description: '',
			dueDate: '',
			assignees: [],
			completed: false,
			tags: [],
			uuid: undefined
		});
		list.newCardTitle = '';

		try {
			const res = await fetch('/api/cards', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ listId: list.uuid, title, userId: currentUserId })
			});

			if (!res.ok) {
				console.error('Erreur création carte', await res.text());
				return;
			}

			const payload = (await res.json()) as { id: string; title: string };
			const card = list.cards.find((entry) => entry.id === localId);
			if (card) {
				card.uuid = payload.id;
			}
		} catch (err) {
			console.error('Erreur réseau /api/cards', err);
		}
	}

	async function deleteCardAt(listIndex: number, cardIndex: number) {
		if (!canEdit) return;
		if (!Array.isArray(lists) || !lists[listIndex] || !Array.isArray(lists[listIndex].cards)) {
			return;
		}

		const card = lists[listIndex].cards[cardIndex];
		if (!card) {
			return;
		}

		const cardKey = selectionKeyForCard(card);
		const cardUuid = card.uuid;

		if (selectedCardKey === cardKey) {
			closeDetails();
		} else if (
			selectedCardRef &&
			selectedCardRef.listIndex === listIndex &&
			selectedCardRef.cardIndex > cardIndex
		) {
			selectedCardRef = {
				listIndex,
				cardIndex: selectedCardRef.cardIndex - 1
			};
		}

		lists = lists.map((list, li) =>
			li === listIndex
				? {
						...list,
						cards: list.cards.filter((_, ci) => ci !== cardIndex)
					}
				: list
		);

		if (!cardUuid) {
			return;
		}

		try {
			const encodedCardId = encodeURIComponent(cardUuid);
			const encodedUserId = encodeURIComponent(currentUserId);
			const res = await fetch(`/api/cards?id=${encodedCardId}&userId=${encodedUserId}`, {
				method: 'DELETE'
			});

			if (!res.ok) {
				console.error('Erreur API delete card', await res.text());
			}
		} catch (err) {
			console.error('Erreur réseau API delete card', err);
		}
	}

	async function handleDeleteCard(event: CustomEvent<{ listIndex: number; cardIndex: number }>) {
		const { listIndex, cardIndex } = event.detail;
		await deleteCardAt(listIndex, cardIndex);
	}

	async function handleDeleteCardFromEditor() {
		if (!selectedCardRef) return;
		await deleteCardAt(selectedCardRef.listIndex, selectedCardRef.cardIndex);
	}

	function handleOpenDetails(event: CustomEvent<{ listIndex: number; cardIndex: number }>) {
		const { listIndex, cardIndex } = event.detail;
		const card = lists[listIndex]?.cards[cardIndex];
		if (!card) return;

		selectedCardRef = { listIndex, cardIndex };
		selectedCardKey = selectionKeyForCard(card);
	}

	function closeDetails() {
		selectedCardRef = null;
		selectedCardKey = null;
	}

	async function persistCardFields(cardUuid: string | undefined, fields: Record<string, unknown>) {
		if (!cardUuid || !canEdit) return;

		try {
			await fetch('/api/cards', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					cardId: cardUuid,
					userId: currentUserId,
					...fields
				})
			});
		} catch (err) {
			console.error('Erreur update card fields', err);
		}
	}

	async function handleUpdateCompleted(
		event: CustomEvent<{ listIndex: number; cardIndex: number; completed: boolean }>
	) {
		const { listIndex, cardIndex, completed } = event.detail;
		const card = lists[listIndex]?.cards[cardIndex];
		if (!card) return;

		card.completed = completed;
		await persistCardFields(card.uuid, { completed });
	}

	async function persistCardMove(
		cardUuid: string | undefined,
		fromListUuid: string | undefined,
		toListUuid: string | undefined,
		targetIndex: number
	) {
		if (!cardUuid || !fromListUuid || !toListUuid || !canEdit) return;

		try {
			await fetch('/api/cards', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					cardId: cardUuid,
					fromListId: fromListUuid,
					toListId: toListUuid,
					targetIndex,
					userId: currentUserId
				})
			});
		} catch (err) {
			console.error('Erreur move card', err);
		}
	}

	async function persistListsOrder() {
		if (!canEdit) return;

		const updates = lists
			.map((list, order) => (list.uuid ? { listId: list.uuid, order } : null))
			.filter((entry): entry is { listId: string; order: number } => entry !== null);

		await Promise.all(
			updates.map(async ({ listId, order }) => {
				try {
					const res = await fetch('/api/lists', {
						method: 'PATCH',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ listId, order, userId: currentUserId })
					});
					if (!res.ok) {
						console.error('Erreur persist list order', listId, order, await res.text());
					}
				} catch (err) {
					console.error('Erreur persist list order', err);
				}
			})
		);
	}

	function setCardDropPreview(targetListIndex: number, targetCardIndex: number) {
		if (!draggedCardRef) return;
		cardDropPreview = {
			listIndex: targetListIndex,
			targetIndex: targetCardIndex
		};
	}

	function handleDragStart(
		event: CustomEvent<{ listIndex: number; cardIndex: number; height?: number | null }>
	) {
		if (!canDragAndDrop) return;
		const { listIndex, cardIndex, height } = event.detail;
		draggedCardRef = { listIndex, cardIndex };
		draggedCardHeight = height && height > 0 ? height : 56;
		cardDropPreview = null;
		listDropPreviewIndex = null;
	}

	function handleDragEnd() {
		draggedCardRef = null;
		cardDropPreview = null;
		draggedCardHeight = 56;
	}

	function handleListDragStart(index: number, event: DragEvent) {
		if (!canDragAndDrop) {
			event.preventDefault();
			return;
		}

		const target = event.target as HTMLElement | null;
		if (
			target?.closest(
				'input, button, textarea, select, a, [contenteditable="true"], li[draggable="true"]'
			)
		) {
			event.preventDefault();
			return;
		}

		draggedListIndex = index;
		cardDropPreview = null;
		listDropPreviewIndex = null;
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', `list:${index}`);
		}
	}

	function handleListDragEnd() {
		draggedListIndex = null;
		listDropPreviewIndex = null;
	}

	function setListDropPreview(targetInsertIndex: number) {
		if (draggedListIndex === null) return;
		const previewIndex = Math.max(0, Math.min(targetInsertIndex, lists.length));
		const isNoOpPosition =
			previewIndex === draggedListIndex || previewIndex === draggedListIndex + 1;
		listDropPreviewIndex = isNoOpPosition ? null : previewIndex;
	}

	function handleListDragOver(targetIndex: number, event: DragEvent) {
		if (draggedListIndex === null) return;
		event.preventDefault();

		const targetElement = event.currentTarget as HTMLElement | null;
		const rect = targetElement?.getBoundingClientRect();
		const dropAfter = rect ? event.clientX > rect.left + rect.width / 2 : false;
		const targetInsertIndex = dropAfter ? targetIndex + 1 : targetIndex;
		setListDropPreview(targetInsertIndex);
	}

	async function handleListDrop(targetIndex: number, event: DragEvent) {
		if (!canDragAndDrop) return;
		if (draggedListIndex === null) return;
		event.preventDefault();

		const targetElement = event.currentTarget as HTMLElement | null;
		const rect = targetElement?.getBoundingClientRect();
		const dropAfter = rect ? event.clientX > rect.left + rect.width / 2 : false;
		const targetInsertIndex = dropAfter ? targetIndex + 1 : targetIndex;

		const moved = moveListInLists(lists, draggedListIndex, targetInsertIndex);
		draggedListIndex = null;
		listDropPreviewIndex = null;
		if (!moved || !moved.changed) return;

		lists = moved.nextLists;
		await persistListsOrder();
	}

	function handleListPreviewDragOver(insertIndex: number, event: DragEvent) {
		if (draggedListIndex === null) return;
		event.preventDefault();
		setListDropPreview(insertIndex);
	}

	async function handleListPreviewDrop(insertIndex: number, event: DragEvent) {
		if (!canDragAndDrop) return;
		if (draggedListIndex === null) return;
		event.preventDefault();

		const moved = moveListInLists(lists, draggedListIndex, insertIndex);
		draggedListIndex = null;
		listDropPreviewIndex = null;
		if (!moved || !moved.changed) return;

		lists = moved.nextLists;
		await persistListsOrder();
	}

	function handleCardDragOver(
		event: CustomEvent<{ listIndex: number; cardIndex: number; dropAfter: boolean }>
	) {
		if (!canDragAndDrop) return;
		if (!draggedCardRef) return;
		const { listIndex, cardIndex, dropAfter } = event.detail;
		const targetIndex = cardIndex + (dropAfter ? 1 : 0);
		setCardDropPreview(listIndex, targetIndex);
	}

	function getCardInsertIndexFromPointer(listIndex: number, event: DragEvent) {
		const list = lists[listIndex];
		const currentTarget = event.currentTarget as HTMLElement | null;
		if (!list || !currentTarget) return 0;

		const cardElements = Array.from(
			currentTarget.querySelectorAll<HTMLElement>('[data-card-item="true"]')
		);
		if (!cardElements.length) return 0;

		for (let i = 0; i < cardElements.length; i += 1) {
			const rect = cardElements[i].getBoundingClientRect();
			const shouldInsertBefore = event.clientY < rect.top + rect.height / 2;
			if (shouldInsertBefore) {
				return i;
			}
		}

		return cardElements.length;
	}

	function handleCardListDragOver(listIndex: number, event: DragEvent) {
		if (!canDragAndDrop) return;
		if (!draggedCardRef || !lists[listIndex]) return;
		event.preventDefault();
		const targetIndex = getCardInsertIndexFromPointer(listIndex, event);
		setCardDropPreview(listIndex, targetIndex);
	}

	async function handleDropOnCard(
		event: CustomEvent<{ listIndex: number; cardIndex: number; dropAfter: boolean }>
	) {
		if (!canDragAndDrop) return;
		if (!draggedCardRef) return;
		const { listIndex, cardIndex, dropAfter } = event.detail;
		const targetIndex = cardIndex + (dropAfter ? 1 : 0);

		const moved = moveCardInLists(
			lists,
			draggedCardRef.listIndex,
			draggedCardRef.cardIndex,
			listIndex,
			targetIndex
		);

		draggedCardRef = null;
		cardDropPreview = null;
		draggedCardHeight = 56;
		if (!moved || moved.unchanged) return;

		lists = moved.nextLists;
		await persistCardMove(moved.card.uuid, moved.fromListUuid, moved.toListUuid, moved.insertIndex);
	}

	async function handleDropOnList(listIndex: number, event: DragEvent) {
		if (!canDragAndDrop) return;
		if (!draggedCardRef || !lists[listIndex]) return;
		event.preventDefault();
		const targetIndex = getCardInsertIndexFromPointer(listIndex, event);

		const moved = moveCardInLists(
			lists,
			draggedCardRef.listIndex,
			draggedCardRef.cardIndex,
			listIndex,
			targetIndex
		);

		draggedCardRef = null;
		cardDropPreview = null;
		draggedCardHeight = 56;
		if (!moved || moved.unchanged) return;

		lists = moved.nextLists;
		await persistCardMove(moved.card.uuid, moved.fromListUuid, moved.toListUuid, moved.insertIndex);
	}
</script>

{#if filtersPanelOpen}
	<div
		id="board-filters-panel"
		class="mb-2 mx-2 rounded-xl border border-sky-300/20 bg-slate-800/65 px-3 py-2 text-slate-100 shadow-sm shadow-slate-950/40"
	>
		<div class="flex flex-wrap items-end gap-2">
			<div class="flex min-w-45 flex-col gap-1">
				<label
					for="board-filter-assignee"
					class="select-none text-[11px] font-semibold uppercase tracking-wide text-slate-300"
				>
					Assignee
				</label>
				<select
					id="board-filter-assignee"
					class="hover:cursor-pointer rounded-md border border-slate-500/70 bg-slate-700/80 px-2 py-1 text-sm text-slate-100"
					bind:value={assigneeFilter}
				>
					<option value="all">Toutes</option>
					<option value="me">Moi</option>
					{#each boardMembers as member (member.userId)}
						<option value={`member:${member.userId}`}>{memberLabel(member)}</option>
					{/each}
				</select>
			</div>

			<div class="flex min-w-30 flex-col gap-1">
				<label
					for="board-filter-due-op"
					class="select-none text-[11px] font-semibold uppercase tracking-wide text-slate-300"
				>
					Due Date
				</label>
				<select
					id="board-filter-due-op"
					class="hover:cursor-pointer rounded-md border border-slate-500/70 bg-slate-700/80 px-2 py-1 text-sm text-slate-100"
					bind:value={dueDateOperator}
				>
					<option value="none">Toutes</option>
					<option value="lt">&lt;</option>
					<option value="lte">&lt;=</option>
					<option value="gt">&gt;</option>
					<option value="gte">&gt;=</option>
					<option value="eq">==</option>
					<option value="neq">~=</option>
				</select>
			</div>

			<div class="flex min-w-42.5 flex-col gap-1">
				<label
					for="board-filter-due-date"
					class="select-none text-[11px] font-semibold uppercase tracking-wide text-slate-300"
				>
					Date
				</label>
				<input
					id="board-filter-due-date"
					type="date"
					class="hover:cursor-pointer rounded-md border border-slate-500/70 bg-slate-700/80 px-2 py-1 text-sm text-slate-100 scheme-dark"
					bind:value={dueDateFilterValue}
				/>
			</div>

			<div class="flex min-w-40 flex-col gap-1">
				<label
					for="board-filter-tag"
					class="select-none text-[11px] font-semibold uppercase tracking-wide text-slate-300"
				>
					Tag
				</label>
				<select
					id="board-filter-tag"
					class="hover:cursor-pointer rounded-md border border-slate-500/70 bg-slate-700/80 px-2 py-1 text-sm text-slate-100"
					bind:value={tagFilter}
				>
					<option value="all">Tous</option>
					{#each allTags as tag (tag)}
						<option value={tag}>{tag}</option>
					{/each}
				</select>
			</div>

			<button
				type="button"
				class="hover:cursor-pointer mb-0.5 h-9 rounded-md border border-slate-400/60 bg-slate-700/80 px-3 text-xs font-semibold text-slate-100 transition-colors hover:bg-slate-600/90"
				onclick={resetFilters}
				disabled={!hasActiveFilters}
			>
				Reset
			</button>
		</div>
		{#if hasActiveFilters}
			<p class="mt-2 text-xs text-amber-200">
				Filtre actif: le drag and drop est temporairement désactivé.
			</p>
		{/if}
	</div>
{/if}

<div class="flex gap-3 overflow-x-auto px-2 py-3">
	{#each visibleLists as list, i (list.uuid ?? i)}
		{#if canDragAndDrop && listDropPreviewIndex === i}
			<div
				class={`min-w-55 self-stretch rounded-xl border-2 border-dashed border-sky-300/70 bg-sky-400/20 ${draggedListIndex === null ? 'pointer-events-none' : ''}`}
				role="group"
				aria-label="List drop preview"
				ondragover={(event) => handleListPreviewDragOver(i, event)}
				ondrop={(event) => void handleListPreviewDrop(i, event)}
			></div>
		{/if}
		<div
			class="group/list relative flex min-w-55 flex-col rounded-xl border border-sky-300/20 bg-slate-800/70 p-3 text-slate-100 shadow-md shadow-slate-950/50 backdrop-blur-sm"
			role="group"
			draggable={canDragAndDrop}
			ondragstart={(event) => handleListDragStart(i, event)}
			ondragend={handleListDragEnd}
			ondragover={(event) => handleListDragOver(i, event)}
			ondrop={(event) => void handleListDrop(i, event)}
		>
			<div class="flex min-w-full flex-row items-center gap-2">
				<input
					class="w-full flex-1 rounded-md border-0 bg-transparent px-1 py-1 font-mono text-lg font-bold text-slate-100 transition-colors hover:bg-slate-700/50"
					value={list.name}
					readonly={!canEdit}
					oninput={(event) => void updateListName(i, event)}
				/>
				{#if canEdit}
					<div class="group/list-corner relative h-8 w-8 shrink-0">
						<button
							type="button"
							title="Delete list"
							class="absolute right-0 top-0 h-8 w-8 cursor-pointer rounded-full border border-rose-300/20 bg-slate-800/90 text-center text-sm font-bold text-rose-200 shadow-sm shadow-black/30 transition-all hover:border-rose-300/60 hover:bg-rose-500/20 hover:text-rose-100"
							onclick={() => void deleteList(i)}
						>
							✕
						</button>
					</div>
				{/if}
			</div>

			<ol
				class="mt-3 flex min-h-0 flex-1 flex-col gap-1.5"
				ondragover={(event) => {
					if (!canDragAndDrop) return;
					if (draggedListIndex !== null) {
						handleListDragOver(i, event);
						return;
					}
					handleCardListDragOver(i, event);
				}}
				ondrop={(event) => {
					if (!canDragAndDrop) return;
					if (draggedListIndex !== null) {
						void handleListDrop(i, event);
						return;
					}
					void handleDropOnList(i, event);
				}}
			>
				{#each list.cards as cardRef, j (cardRef.card.uuid ?? cardRef.card.id ?? j)}
					{#if canDragAndDrop && cardDropPreview && cardDropPreview.listIndex === i && cardDropPreview.targetIndex === j}
						<li
							class="pointer-events-none rounded-lg border-2 border-dashed border-sky-300/70 bg-sky-400/20"
							style={`height: ${draggedCardHeight}px;`}
						></li>
					{/if}
					<Card
						card={cardRef.card}
						{boardMembers}
						{canEdit}
						canDrag={canDragAndDrop}
						listIndex={i}
						cardIndex={cardRef.cardIndex}
						on:updateCompleted={handleUpdateCompleted}
						on:deleteCard={handleDeleteCard}
						on:openDetails={handleOpenDetails}
						on:dragStart={handleDragStart}
						on:dragEnd={handleDragEnd}
						on:dragOverCard={handleCardDragOver}
						on:dropOnCard={handleDropOnCard}
					/>
				{/each}
				{#if canDragAndDrop && cardDropPreview && cardDropPreview.listIndex === i && cardDropPreview.targetIndex === list.cards.length}
					<li
						class="pointer-events-none rounded-lg border-2 border-dashed border-sky-300/70 bg-sky-400/20"
						style={`height: ${draggedCardHeight}px;`}
					></li>
				{/if}
			</ol>

			<form
				class="mt-2.5 flex gap-1.5"
				ondragover={(event) => {
					if (!canDragAndDrop) return;
					if (draggedListIndex !== null) {
						handleListDragOver(i, event);
					}
				}}
				ondrop={(event) => {
					if (!canDragAndDrop) return;
					if (draggedListIndex !== null) {
						void handleListDrop(i, event);
					}
				}}
				onsubmit={(event) => {
					event.preventDefault();
					void addCard(i);
				}}
			>
				<input
					type="text"
					class="w-full rounded-md border border-slate-600/60 bg-slate-700/80 p-1.5 font-mono text-sm text-slate-100 shadow-sm shadow-black/20 placeholder:text-slate-300"
					placeholder="New card title..."
					value={list.newCardTitle}
					disabled={!canEdit}
					oninput={(event) => updateListNewCardTitle(i, event)}
				/>
				<button
					type="submit"
					disabled={!canEdit}
					class="w-20 cursor-pointer rounded-md bg-sky-600 px-2 text-sm font-semibold text-white shadow-sm shadow-sky-900/50 transition-colors hover:bg-sky-500"
				>
					+ Add
				</button>
			</form>
		</div>
	{/each}
	{#if canDragAndDrop && listDropPreviewIndex === lists.length}
		<div
			class={`min-w-55 self-stretch rounded-xl border-2 border-dashed border-sky-300/70 bg-sky-400/20 ${draggedListIndex === null ? 'pointer-events-none' : ''}`}
			role="group"
			aria-label="List drop preview"
			ondragover={(event) => handleListPreviewDragOver(lists.length, event)}
			ondrop={(event) => void handleListPreviewDrop(lists.length, event)}
		></div>
	{/if}

	{#if canEdit}
		<div
			class="min-w-55 rounded-xl border border-dashed border-sky-300/35 bg-slate-800/55 p-3 text-slate-100 shadow-md shadow-slate-950/40 backdrop-blur-sm"
		>
			<form
				onsubmit={(event) => {
					event.preventDefault();
					void addList();
				}}
				class="flex flex-col gap-2"
			>
				<input
					type="text"
					class="h-9 w-full rounded-md border border-slate-600/60 bg-slate-700/80 p-1.5 font-mono text-sm text-slate-100 shadow-sm shadow-black/20 placeholder:text-slate-300"
					placeholder="New list name..."
					bind:value={newListName}
				/>
				<button
					type="submit"
					class="h-9 w-full rounded-md bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm shadow-sky-900/50 transition-colors hover:cursor-pointer hover:bg-sky-500"
				>
					+ Add List
				</button>
			</form>
		</div>
	{/if}
</div>

<BoardCardDetailsModal
	{selectedCard}
	selectedListName={selectedList?.name ?? null}
	{boardMembers}
	{currentUserId}
	{canEdit}
	on:close={closeDetails}
	on:delete={() => void handleDeleteCardFromEditor()}
/>
