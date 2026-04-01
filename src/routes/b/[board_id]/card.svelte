<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { assigneeLabel } from './board-filters';
	import type { BoardMember, UiCard } from './board.types';

	const {
		card,
		listIndex,
		cardIndex,
		boardMembers = [],
		canEdit = true,
		canDrag = true
	} = $props<{
		card: UiCard;
		listIndex: number;
		cardIndex: number;
		boardMembers?: BoardMember[];
		canEdit?: boolean;
		canDrag?: boolean;
	}>();

	const dispatch = createEventDispatcher();
	const hasMeta = $derived(
		Boolean(
			(card.tags && card.tags.length) || card.dueDate || (card.assignees && card.assignees.length)
		)
	);

	let suppressClickUntil = 0;

	function handleDelete() {
		if (!canEdit) return;
		dispatch('deleteCard', { listIndex, cardIndex });
	}

	function handleCompletedChange(event: Event) {
		if (!canEdit) return;
		const target = event.currentTarget as HTMLInputElement;
		dispatch('updateCompleted', { listIndex, cardIndex, completed: target.checked });
	}

	function handleDragStart(event: DragEvent) {
		if (!canEdit || !canDrag) {
			event.preventDefault();
			return;
		}
		event.stopPropagation();
		suppressClickUntil = Date.now() + 200;
		event.dataTransfer?.setData('text/plain', `${listIndex}:${cardIndex}`);
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
		}
		const currentTarget = event.currentTarget as HTMLElement | null;
		const height = currentTarget ? Math.round(currentTarget.getBoundingClientRect().height) : null;
		dispatch('dragStart', { listIndex, cardIndex, height });
	}

	function handleDragEnd(event: DragEvent) {
		event.stopPropagation();
		dispatch('dragEnd');
	}

	function handleDropOnCard(event: DragEvent) {
		if (!canEdit || !canDrag) return;
		event.preventDefault();
		const currentTarget = event.currentTarget as HTMLElement | null;
		const rect = currentTarget?.getBoundingClientRect();
		const dropAfter = rect ? event.clientY > rect.top + rect.height / 2 : false;
		dispatch('dropOnCard', { listIndex, cardIndex, dropAfter });
	}

	function handleDragOverCard(event: DragEvent) {
		if (!canEdit || !canDrag) return;
		event.preventDefault();
		const currentTarget = event.currentTarget as HTMLElement | null;
		const rect = currentTarget?.getBoundingClientRect();
		const dropAfter = rect ? event.clientY > rect.top + rect.height / 2 : false;
		dispatch('dragOverCard', { listIndex, cardIndex, dropAfter });
	}

	function handleOpenEditor() {
		if (Date.now() < suppressClickUntil) {
			return;
		}

		dispatch('openDetails', { listIndex, cardIndex });
	}

	function formatAssignee(assignee: string) {
		return assigneeLabel(assignee, boardMembers);
	}
</script>

<li
	draggable={canEdit && canDrag}
	data-card-item="true"
	data-list-index={listIndex}
	data-card-index={cardIndex}
	class="group/card relative flex min-h-14 cursor-pointer flex-col gap-1.5 rounded-lg bg-gradient-to-br from-sky-700 via-sky-600 to-sky-500 p-2.5 text-slate-50 shadow-md shadow-sky-300/30 ring-1 ring-white/20"
	class:justify-center={!hasMeta}
	ondragstart={handleDragStart}
	ondragend={handleDragEnd}
	ondragover={handleDragOverCard}
	ondrop={handleDropOnCard}
>
	<button
		type="button"
		class="absolute inset-0 z-10 cursor-pointer rounded-lg"
		aria-label={`Open details for ${card.title}`}
		onclick={handleOpenEditor}
	></button>

	<div class="flex items-center gap-1.5 px-1" class:mb-1={hasMeta}>
		<span class="relative z-20 flex h-5 items-center">
			<input
				type="checkbox"
				class="mt-1 h-4 w-4 shrink-0 rounded-md border-0 shadow transition-all checked:bg-emerald-500 focus:outline-0"
				title="Mark as complete"
				checked={card.completed}
				disabled={!canEdit}
				onchange={handleCompletedChange}
			/>
		</span>

		<p class="flex-1 px-1 font-mono text-base font-semibold leading-5 text-slate-50">
			{card.title}
		</p>

		{#if canEdit}
			<button
				type="button"
				title="Delete card"
				class="relative z-20 h-7 w-7 shrink-0 cursor-pointer rounded-full border border-sky-100/30 bg-sky-900/25 text-center text-sm font-bold text-sky-50/85 opacity-0 pointer-events-none shadow-sm shadow-black/20 transition-all group-hover/card:opacity-100 group-hover/card:pointer-events-auto hover:border-rose-300/50 hover:bg-rose-500/20 hover:text-rose-100"
				onclick={handleDelete}
			>
				✕
			</button>
		{/if}
	</div>

	{#if card.tags && card.tags.length}
		<div class="mb-1 flex flex-wrap gap-1 px-1">
			{#each card.tags as tag, index (`${tag}-${index}`)}
				<span
					class="inline-flex select-none items-center rounded-md bg-white/20 px-2 py-0.5 text-[11px] font-semibold text-slate-50 shadow-sm"
				>
					{tag}
				</span>
			{/each}
		</div>
	{/if}

	{#if card.dueDate || (card.assignees && card.assignees.length)}
		<div class="flex flex-wrap items-center gap-1 px-1 text-[11px]">
			{#if card.dueDate}
				<span class="rounded-md bg-black/20 px-2 py-0.5 text-sky-100">Due {card.dueDate}</span>
			{/if}
			{#if card.assignees && card.assignees.length}
				{#each card.assignees as assignee, index (`${assignee}-${index}`)}
					<span class="rounded-md bg-white/15 px-2 py-0.5 text-slate-100"
						>@{formatAssignee(assignee)}</span
					>
				{/each}
			{/if}
		</div>
	{/if}
</li>
