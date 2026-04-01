<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import {
		assigneeLabel,
		getAvailableAssigneeMembers,
		isMemberAssignedToCard,
		memberLabel
	} from './board-filters';
	import type { BoardMember, UiCard } from './board.types';

	let {
		selectedCard,
		selectedListName,
		boardMembers,
		currentUserId,
		canEdit
	}: {
		selectedCard: UiCard | null;
		selectedListName: string | null;
		boardMembers: BoardMember[];
		currentUserId: string;
		canEdit: boolean;
	} = $props();

	const dispatch = createEventDispatcher<{
		close: undefined;
		delete: undefined;
	}>();

	let editorDescription = $state('');
	let editorDueDate = $state('');
	let editorNewTag = $state('');
	let editorSelectedAssignee = $state('');
	let initializedForCard = $state<string | null>(null);
	let githubBranchLoading = $state(false);
	let githubBranchError = $state('');

	const selectedCardKey = $derived(
		selectedCard
			? selectedCard.uuid
				? `uuid:${selectedCard.uuid}`
				: `local:${selectedCard.id}`
			: null
	);

	const availableAssigneeMembers = $derived(
		getAvailableAssigneeMembers(selectedCard, boardMembers)
	);

	$effect(() => {
		if (selectedCardKey === initializedForCard) {
			return;
		}

		initializedForCard = selectedCardKey;
		if (!selectedCard) {
			editorDescription = '';
			editorDueDate = '';
			editorNewTag = '';
			editorSelectedAssignee = '';
			githubBranchLoading = false;
			githubBranchError = '';
			return;
		}

		editorDescription = selectedCard.description ?? '';
		editorDueDate = selectedCard.dueDate ?? '';
		editorNewTag = '';
		editorSelectedAssignee = '';
		githubBranchLoading = false;
		githubBranchError = '';
	});

	function closeDetails() {
		dispatch('close');
	}

	async function createGithubBranch() {
		if (!canEdit || !selectedCard || !selectedCard.uuid) return;

		githubBranchLoading = true;
		githubBranchError = '';

		try {
			const response = await fetch('/api/github/branches', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					cardId: selectedCard.uuid,
					userId: currentUserId
				})
			});

			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
				githubBranchError =
					payload?.message ?? payload?.error ?? 'Unable to create GitHub branch';
				return;
			}

			const result = await response.json();

			selectedCard.github_branch_name = result.branchName;
			selectedCard.github_branch_url = result.branchUrl;
			selectedCard.github_branch_status = 'created';
		} catch (err) {
			console.error('Erreur création branche GitHub', err);
			githubBranchError = 'Network error while creating GitHub branch';
		} finally {
			githubBranchLoading = false;
		}
	}

	async function deleteGithubBranch() {
		if (!canEdit || !selectedCard || !selectedCard.uuid) return;

		githubBranchLoading = true;
		githubBranchError = '';

		try {
			const response = await fetch('/api/github/branches', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					cardId: selectedCard.uuid,
					userId: currentUserId
				})
			});

			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as
					| { message?: string; error?: string }
					| null;
				githubBranchError = payload?.message ?? payload?.error ?? 'Unable to delete GitHub branch';
				return;
			}

			selectedCard.github_branch_url = '';
			selectedCard.github_branch_status = 'deleted';
		} catch (err) {
			console.error('Erreur suppression branche GitHub', err);
			githubBranchError = 'Network error while deleting GitHub branch';
		} finally {
			githubBranchLoading = false;
		}
	}

	async function persistCardFields(cardUuid: string | undefined, fields: Record<string, unknown>) {
		if (!cardUuid || !canEdit) {
			return;
		}

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

	function handleEditorTitleInput(event: Event) {
		if (!canEdit || !selectedCard) return;
		const target = event.currentTarget as HTMLInputElement;
		selectedCard.title = target.value;
	}

	async function handleEditorTitleBlur() {
		if (!canEdit || !selectedCard) return;

		const normalizedTitle = selectedCard.title.trim();
		if (!normalizedTitle) return;

		selectedCard.title = normalizedTitle;
		await persistCardFields(selectedCard.uuid, { name: normalizedTitle });
	}

	function handleEditorDescriptionInput(event: Event) {
		if (!canEdit || !selectedCard) return;
		const target = event.currentTarget as HTMLTextAreaElement;
		editorDescription = target.value;
		selectedCard.description = target.value;
	}

	async function handleEditorDescriptionBlur() {
		if (!canEdit || !selectedCard) return;
		await persistCardFields(selectedCard.uuid, { description: editorDescription });
	}

	function handleEditorDueDateInput(event: Event) {
		if (!canEdit) return;
		const target = event.currentTarget as HTMLInputElement;
		editorDueDate = target.value;
	}

	async function saveEditorDueDate() {
		if (!canEdit || !selectedCard) return;
		selectedCard.dueDate = editorDueDate;
		await persistCardFields(selectedCard.uuid, { dueDate: editorDueDate });
	}

	async function clearEditorDueDate() {
		if (!canEdit || !selectedCard) return;

		editorDueDate = '';
		selectedCard.dueDate = '';
		await persistCardFields(selectedCard.uuid, { dueDate: '' });
	}

	async function addEditorAssignee() {
		if (!canEdit || !selectedCard) return;
		const memberId = editorSelectedAssignee.trim();
		if (!memberId) return;

		const member = boardMembers.find((entry) => entry.userId === memberId);
		if (!member) {
			editorSelectedAssignee = '';
			return;
		}

		if (isMemberAssignedToCard(selectedCard, member)) {
			editorSelectedAssignee = '';
			return;
		}

		selectedCard.assignees = [...selectedCard.assignees, member.userId];
		editorSelectedAssignee = '';
		await persistCardFields(selectedCard.uuid, { assignees: selectedCard.assignees });
	}

	async function removeEditorAssignee(assignee: string) {
		if (!canEdit || !selectedCard) return;

		selectedCard.assignees = selectedCard.assignees.filter((entry) => entry !== assignee);
		await persistCardFields(selectedCard.uuid, { assignees: selectedCard.assignees });
	}

	async function addEditorTag() {
		if (!canEdit || !selectedCard || !selectedCard.uuid) return;
		const tag = editorNewTag.trim();
		if (!tag) return;

		if (selectedCard.tags.some((existingTag) => existingTag.toLowerCase() === tag.toLowerCase())) {
			editorNewTag = '';
			return;
		}

		selectedCard.tags = [...selectedCard.tags, tag];
		editorNewTag = '';

		try {
			const res = await fetch('/api/tags', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ cardId: selectedCard.uuid, name: tag, userId: currentUserId })
			});

			if (!res.ok) {
				selectedCard.tags = selectedCard.tags.filter((existingTag) => existingTag !== tag);
				console.error('Erreur API add tag', await res.text());
			}
		} catch (err) {
			selectedCard.tags = selectedCard.tags.filter((existingTag) => existingTag !== tag);
			console.error('Erreur réseau add tag', err);
		}
	}

	async function removeEditorTag(tag: string) {
		if (!canEdit || !selectedCard || !selectedCard.uuid) return;

		selectedCard.tags = selectedCard.tags.filter((entry) => entry !== tag);

		try {
			const res = await fetch('/api/tags', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ cardId: selectedCard.uuid, name: tag, userId: currentUserId })
			});

			if (!res.ok) {
				console.error('Erreur API delete tag', await res.text());
			}
		} catch (err) {
			console.error('Erreur réseau API delete tag', err);
		}
	}

	function handleDeleteCardFromEditor() {
		dispatch('delete');
	}

	function formatAssigneeLabel(assignee: string) {
		return assigneeLabel(assignee, boardMembers);
	}
</script>

{#if selectedCard}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
		<div
			class="relative w-full max-w-3xl rounded-xl border border-sky-300/30 bg-slate-900/95 p-5 text-slate-100 shadow-xl shadow-slate-950/70 backdrop-blur-sm"
		>
			<div class="mb-1 flex items-start gap-2">
				<input
					type="text"
					class="h-10 min-w-0 flex-1 rounded-md border border-slate-600 bg-slate-800/80 px-2 py-1 text-lg font-bold text-slate-100 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
					value={selectedCard.title}
					readonly={!canEdit}
					oninput={handleEditorTitleInput}
					onblur={handleEditorTitleBlur}
				/>
				{#if canEdit}
					<button
						type="button"
						title="Delete card"
						class="ml-1 h-10 shrink-0 cursor-pointer rounded-md border border-rose-300/35 bg-rose-500/15 px-3 text-sm font-semibold text-rose-100 shadow-md shadow-slate-950/70 transition-all hover:border-rose-300/60 hover:bg-rose-500/25"
						onclick={handleDeleteCardFromEditor}
					>
						Delete
					</button>
				{/if}
				<button
					type="button"
					class="ml-2 mt-0.5 h-8 w-8 shrink-0 cursor-pointer rounded-full border border-slate-500/70 bg-slate-800/90 text-slate-300 shadow-md shadow-slate-950/70 transition-all hover:border-sky-300/70 hover:bg-sky-500/20 hover:text-slate-100"
					onclick={closeDetails}
				>
					✕
				</button>
			</div>
			<p class="mb-4 text-xs text-slate-300">
				in list <span class="font-semibold text-sky-200">{selectedListName ?? ''}</span>
			</p>

			<div class="grid gap-4 md:grid-cols-2">
				<section class="md:col-span-2">
					<h3 class="mb-1 text-xs font-semibold uppercase tracking-wide text-sky-200">
						Description
					</h3>
					<textarea
						class="min-h-28 w-full rounded-md border border-slate-600 bg-slate-800/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
						placeholder="Write a description..."
						value={editorDescription}
						readonly={!canEdit}
						oninput={handleEditorDescriptionInput}
						onblur={handleEditorDescriptionBlur}
					></textarea>
				</section>

				<section class="min-w-0">
					<h3 class="mb-1 text-xs font-semibold uppercase tracking-wide text-sky-200">Assignees</h3>
					<div class="mb-2 flex flex-wrap gap-1.5">
						{#if selectedCard.assignees?.length}
							{#each selectedCard.assignees as assignee (assignee)}
								<span
									class="inline-flex items-center gap-1 rounded-md bg-slate-700/90 px-2 py-1 text-xs text-slate-100 ring-1 ring-slate-500"
								>
									{formatAssigneeLabel(assignee)}
									{#if canEdit}
										<button
											type="button"
											class="cursor-pointer rounded px-1 text-slate-300 shadow-sm shadow-slate-950/60 transition-all hover:bg-rose-500/25 hover:text-rose-200 active:translate-y-px"
											onclick={() => removeEditorAssignee(assignee)}
											title="Remove assignee"
										>
											✕
										</button>
									{/if}
								</span>
							{/each}
						{:else}
							<p class="text-xs text-slate-400">No assignees yet.</p>
						{/if}
					</div>
					<form
						class="flex w-full gap-1.5"
						onsubmit={(event) => {
							event.preventDefault();
							void addEditorAssignee();
						}}
					>
						<select
							class="min-w-0 flex-1 rounded-md border border-slate-600 bg-slate-800/80 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
							disabled={!canEdit}
							bind:value={editorSelectedAssignee}
						>
							<option value="">Select a board member...</option>
							{#each availableAssigneeMembers as member (member.userId)}
								<option value={member.userId}>{memberLabel(member)}</option>
							{/each}
						</select>
						<button
							type="submit"
							disabled={!canEdit || !editorSelectedAssignee}
							class="h-8 w-16 min-w-16 shrink-0 cursor-pointer whitespace-nowrap rounded-md bg-sky-600 px-2 py-1 text-center text-xs font-semibold text-white shadow-md shadow-sky-900/50 transition-all hover:bg-sky-500 active:translate-y-px"
						>
							+ Add
						</button>
					</form>
					{#if availableAssigneeMembers.length === 0}
						<p class="mt-1 text-xs text-slate-400">All board members are already assigned.</p>
					{/if}
				</section>

				<section>
					<h3 class="mb-1 text-xs font-semibold uppercase tracking-wide text-sky-200">Due Date</h3>
					<div class="mb-2 flex flex-wrap gap-1.5">
						{#if selectedCard.dueDate}
							<span
								class="inline-flex items-center gap-1 rounded-md bg-slate-700/90 px-2 py-1 text-xs text-slate-100 ring-1 ring-slate-500"
							>
								{selectedCard.dueDate}
								{#if canEdit}
									<button
										type="button"
										class="cursor-pointer rounded px-1 text-slate-300 shadow-sm shadow-slate-950/60 transition-all hover:bg-rose-500/25 hover:text-rose-200 active:translate-y-px"
										onclick={clearEditorDueDate}
										title="Clear due date"
									>
										✕
									</button>
								{/if}
							</span>
						{:else}
							<p class="text-xs text-slate-400">No due date.</p>
						{/if}
					</div>
					<form
						class="flex w-full gap-1.5"
						onsubmit={(event) => {
							event.preventDefault();
							void saveEditorDueDate();
						}}
					>
						<input
							type="date"
							class="min-w-0 flex-1 appearance-none rounded-md border border-slate-600 bg-slate-800/80 px-2 py-1 text-sm text-slate-100 focus:border-sky-400 focus:outline-none scheme-dark [&::-webkit-calendar-picker-indicator]:m-0 [&::-webkit-calendar-picker-indicator]:h-0 [&::-webkit-calendar-picker-indicator]:w-0 [&::-webkit-calendar-picker-indicator]:opacity-0"
							value={editorDueDate}
							disabled={!canEdit}
							oninput={handleEditorDueDateInput}
						/>
						<button
							type="submit"
							disabled={!canEdit}
							class="h-8 w-16 min-w-16 shrink-0 cursor-pointer whitespace-nowrap rounded-md bg-sky-600 px-2 py-1 text-center text-xs font-semibold text-white shadow-md shadow-sky-900/50 transition-all hover:bg-sky-500 active:translate-y-px"
						>
							Set
						</button>
					</form>
				</section>

				<section>
					<h3 class="mb-1 text-xs font-semibold uppercase tracking-wide text-sky-200">
						GitHub Branch
					</h3>
					<div class="rounded-md border border-slate-700 bg-slate-800/60 p-3">
						{#if selectedCard.github_branch_name}
							{#if selectedCard.github_branch_status === 'created' && selectedCard.github_branch_url}
								<p class="text-sm text-slate-300">
									Linked branch:
									<a
										href={selectedCard.github_branch_url}
										target="_blank"
										rel="noreferrer"
										class="font-medium text-sky-300 underline decoration-sky-400/70 underline-offset-2 transition-colors hover:text-sky-200"
									>
										{selectedCard.github_branch_name}
									</a>
								</p>
								{#if canEdit}
									<button
										type="button"
										class="mt-3 inline-flex h-8 min-w-36 cursor-pointer items-center justify-center rounded-md border border-rose-300/35 bg-rose-500/15 px-3 py-1 text-xs font-semibold text-rose-100 transition-all hover:border-rose-300/60 hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-60"
										onclick={deleteGithubBranch}
										disabled={githubBranchLoading}
									>
										{githubBranchLoading ? 'Deleting...' : 'Delete GitHub branch'}
									</button>
								{/if}
							{:else}
								<p class="text-sm text-slate-300">
									Last linked branch:
									<span class="font-medium text-slate-200">{selectedCard.github_branch_name}</span>
								</p>
								{#if canEdit}
									<button
										type="button"
										class="mt-3 inline-flex h-8 min-w-40 cursor-pointer items-center justify-center rounded-md bg-sky-600 px-3 py-1 text-xs font-semibold text-white shadow-md shadow-sky-900/50 transition-all hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
										onclick={createGithubBranch}
										disabled={githubBranchLoading}
									>
										{githubBranchLoading ? 'Creating...' : 'Create new GitHub branch'}
									</button>
								{/if}
							{/if}
						{:else if canEdit}
							<button
								type="button"
								class="inline-flex h-8 min-w-36 cursor-pointer items-center justify-center rounded-md bg-sky-600 px-3 py-1 text-xs font-semibold text-white shadow-md shadow-sky-900/50 transition-all hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
								onclick={createGithubBranch}
								disabled={githubBranchLoading}
							>
								{githubBranchLoading ? 'Creating...' : 'Create GitHub branch'}
							</button>
						{:else}
							<p class="text-xs text-slate-400">No GitHub branch linked to this card.</p>
						{/if}

						{#if selectedCard.github_branch_status}
							<p class="mt-2 text-xs text-slate-400">
								Status: <span class="font-medium text-slate-200">{selectedCard.github_branch_status}</span>
							</p>
						{/if}

						{#if githubBranchError}
							<p class="mt-2 text-xs text-rose-300">{githubBranchError}</p>
						{/if}
					</div>
				</section>

				<section class="md:col-span-2">
					<h3 class="mb-1 text-xs font-semibold uppercase tracking-wide text-sky-200">Tags</h3>
					<div class="mb-2 flex flex-wrap gap-1.5">
						{#if selectedCard.tags?.length}
							{#each selectedCard.tags as tag (tag)}
								<span
									class="inline-flex items-center gap-1 rounded-md bg-sky-500/20 px-2 py-1 text-xs text-sky-100 ring-1 ring-sky-300/30"
								>
									{tag}
									{#if canEdit}
										<button
											type="button"
											class="cursor-pointer rounded px-1 text-sky-200 shadow-sm shadow-slate-950/60 transition-all hover:bg-rose-500/25 hover:text-rose-200 active:translate-y-px"
											onclick={() => removeEditorTag(tag)}
											title="Remove tag"
										>
											✕
										</button>
									{/if}
								</span>
							{/each}
						{:else}
							<p class="text-xs text-slate-400">No tags yet.</p>
						{/if}
					</div>
					<form
						class="flex gap-1.5"
						onsubmit={(event) => {
							event.preventDefault();
							void addEditorTag();
						}}
					>
						<input
							type="text"
							class="w-full rounded-md border border-slate-600 bg-slate-800/80 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
							placeholder="Add tag..."
							disabled={!canEdit}
							bind:value={editorNewTag}
						/>
						<button
							type="submit"
							disabled={!canEdit}
							class="h-8 w-16 min-w-16 shrink-0 cursor-pointer whitespace-nowrap rounded-md bg-sky-600 px-2 py-1 text-center text-xs font-semibold text-white shadow-md shadow-sky-900/50 transition-all hover:bg-sky-500 active:translate-y-px"
						>
							+ Add
						</button>
					</form>
				</section>
			</div>
		</div>
	</div>
{/if}
