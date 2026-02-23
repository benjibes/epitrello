<script lang="ts">
	import UserSearchBar from '../../../user_search_bar.svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';

	type ShareMember = {
		userId: string;
		role: 'owner' | 'editor' | 'viewer';
		username: string;
		email: string;
	};

	const { data } = $props<{
		data: {
			board: {
				id: string;
				name: string;
				owner: string;
				ownerUser: string;
				listCount: number;
				theme: string;
				backgroundImageUrl: string;
			};
		};
	}>();

	let ready = $state(false);
	let boardName = $state('');
	let currentUserId = $state('');
	let isOwner = $state(false);
	let saving = $state(false);
	let deleting = $state(false);
	let clearing = $state(false);
	let errorMessage = $state('');
	let successMessage = $state('');
	let sharingError = $state('');
	let sharingLoading = $state(false);
	let shareLink = $state('');
	let defaultPermission = $state<'viewer' | 'editor'>('viewer');
	let members = $state<ShareMember[]>([]);

	onMount(() => {
		if (!browser) return;

		const rawUser = localStorage.getItem('user');
		if (!rawUser) {
			goto(resolve('/login'));
			return;
		}

		let currentUser: { id?: string } | null = null;
		try {
			currentUser = JSON.parse(rawUser);
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
		isOwner = currentUser.id === data.board.owner;
		boardName = data.board.name;
		if (isOwner) {
			void loadSharingSettings();
		}
		ready = true;
	});

	async function loadSharingSettings() {
		if (!isOwner) return;

		sharingLoading = true;
		sharingError = '';

		try {
			const res = await fetch(
				`/api/board-sharing?boardId=${encodeURIComponent(data.board.id)}&requesterId=${encodeURIComponent(currentUserId)}`
			);
			if (!res.ok) {
				sharingError = 'Unable to load sharing settings.';
				return;
			}

			const payload = (await res.json()) as {
				sharePath: string;
				defaultRole: 'viewer' | 'editor';
				members: ShareMember[];
			};
			shareLink = `${window.location.origin}${payload.sharePath}`;
			defaultPermission = payload.defaultRole;
			members = payload.members;
		} catch (err) {
			console.error('Erreur load sharing settings', err);
			sharingError = 'Network error while loading sharing settings.';
		} finally {
			sharingLoading = false;
		}
	}

	async function copyShareLink() {
		if (!shareLink) return;

		try {
			await navigator.clipboard.writeText(shareLink);
			successMessage = 'Share link copied.';
		} catch (err) {
			console.error('Erreur clipboard', err);
			errorMessage = 'Unable to copy share link.';
		}
	}

	async function handleDefaultPermissionChange(event: Event) {
		const target = event.currentTarget as HTMLSelectElement;
		const nextRole = target.value === 'editor' ? 'editor' : 'viewer';
		defaultPermission = nextRole;

		try {
			const response = await fetch('/api/board-sharing', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					boardId: data.board.id,
					requesterId: currentUserId,
					defaultRole: nextRole
				})
			});

			if (!response.ok) {
				sharingError = 'Unable to update default permission.';
				return;
			}

			successMessage = 'Default permission updated.';
		} catch (err) {
			console.error('Erreur update default permission', err);
			sharingError = 'Network error while updating default permission.';
		}
	}

	async function updateMemberRole(memberUserId: string, role: 'viewer' | 'editor' | 'remove') {
		try {
			const response = await fetch('/api/board-sharing', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					boardId: data.board.id,
					requesterId: currentUserId,
					memberUserId,
					memberRole: role
				})
			});

			if (!response.ok) {
				sharingError = 'Unable to update member permissions.';
				return;
			}

			await loadSharingSettings();
			successMessage = 'Member permissions updated.';
		} catch (err) {
			console.error('Erreur update member role', err);
			sharingError = 'Network error while updating member permissions.';
		}
	}

	async function handleSave(event: SubmitEvent) {
		event.preventDefault();
		if (saving) return;

		const trimmedName = boardName.trim();
		errorMessage = '';
		successMessage = '';

		if (!trimmedName) {
			errorMessage = 'Board name cannot be empty.';
			return;
		}

		saving = true;
		try {
			const response = await fetch('/api/boards', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ boardId: data.board.id, name: trimmedName, userId: currentUserId })
			});

			if (!response.ok) {
				errorMessage = 'Unable to save board settings.';
				return;
			}

			boardName = trimmedName;
			successMessage = 'Settings saved.';
		} catch (err) {
			console.error('Erreur save board settings', err);
			errorMessage = 'Network error, please try again.';
		} finally {
			saving = false;
		}
	}

	async function handleDeleteBoard() {
		if (!currentUserId || deleting || !isOwner) return;

		const confirmDelete = confirm(
			`Permanently delete "${boardName.trim() || data.board.name}" board?`
		);
		if (!confirmDelete) return;

		deleting = true;
		errorMessage = '';
		successMessage = '';

		try {
			const response = await fetch(
				`/api/boards?id=${encodeURIComponent(data.board.id)}&userId=${encodeURIComponent(currentUserId)}`,
				{
					method: 'DELETE'
				}
			);

			if (!response.ok) {
				errorMessage = 'Board deletion failed.';
				return;
			}

			goto(resolve(`/u/${currentUserId}`));
		} catch (err) {
			console.error('Erreur delete board', err);
			errorMessage = 'Network error while deleting.';
		} finally {
			deleting = false;
		}
	}

	async function handleClearBoardContent() {
		if (!currentUserId || clearing || !isOwner) return;

		const confirmClear = confirm(
			`Clear all lists/cards/tags inside "${boardName.trim() || data.board.name}"?`
		);
		if (!confirmClear) return;

		clearing = true;
		errorMessage = '';
		successMessage = '';

		try {
			const response = await fetch('/api/board-clear', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					boardId: data.board.id,
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
				errorMessage = payload.error ?? payload.message ?? 'Board clear failed.';
				return;
			}

			successMessage = `Board content cleared (${Number(payload.clearedLists ?? 0)} list(s), ${Number(payload.clearedCards ?? 0)} card(s)).`;
		} catch (err) {
			console.error('Erreur clear board content', err);
			errorMessage = 'Network error while clearing board content.';
		} finally {
			clearing = false;
		}
	}
</script>

{#if ready}
	<UserSearchBar />
	<main
		class="mx-auto min-h-[calc(100vh-4rem)] w-full max-w-5xl px-4 py-6 text-slate-100 sm:px-8 lg:px-12"
	>
		<section
			class="select-none rounded-xl border border-sky-300/25 bg-slate-900/75 p-5 shadow-lg shadow-slate-950/60 backdrop-blur-sm"
		>
			<div class="mb-5 flex flex-wrap items-start justify-between gap-3">
				<div>
					<p class="text-xs font-semibold uppercase tracking-[0.2em] text-sky-200/90">
						Board Settings
					</p>
					<h1 class="mt-1 text-2xl font-bold">Board Settings</h1>
					<p class="mt-1 text-sm text-slate-300">
						Configure board ownership and sharing permissions.
					</p>
				</div>

				<a
					href={resolve(`/b/${data.board.id}`)}
					class="rounded-md border border-sky-300/25 bg-slate-800/80 px-4 py-2 text-sm font-semibold text-slate-100 transition-colors hover:bg-slate-700/90"
				>
					Back to board
				</a>
			</div>

			<form onsubmit={handleSave} class="grid gap-4">
				<div class="grid gap-1.5">
					<label for="board-name" class="text-sm font-semibold text-slate-200">Board name</label>
					<input
						id="board-name"
						type="text"
						maxlength="120"
						bind:value={boardName}
						readonly={!isOwner}
						class="rounded-md border border-slate-600/70 bg-slate-800/80 px-3 py-2 text-slate-100 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
						placeholder="Board name..."
					/>
				</div>

				<button
					type="submit"
					disabled={saving || !isOwner}
					class="w-fit cursor-pointer rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-sky-900/50 transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
				>
					{saving ? 'Saving...' : 'Save'}
				</button>
				{#if !isOwner}
					<p class="text-sm text-slate-300">Only the board owner can update these settings.</p>
				{/if}
			</form>

			{#if successMessage}
				<p
					class="mt-3 rounded-md border border-emerald-300/30 bg-emerald-500/15 px-3 py-2 text-sm text-emerald-100"
				>
					{successMessage}
				</p>
			{/if}
			{#if errorMessage}
				<p
					class="mt-3 rounded-md border border-rose-300/30 bg-rose-500/15 px-3 py-2 text-sm text-rose-100"
				>
					{errorMessage}
				</p>
			{/if}
		</section>

		<section
			class="mt-5 rounded-xl border border-sky-300/25 bg-slate-900/75 p-5 shadow-lg shadow-slate-950/60 backdrop-blur-sm"
		>
			<h2 class="select-none text-lg font-semibold">Information</h2>
			<div class="mt-3 grid gap-2 text-sm text-slate-300">
				<p><span class="font-semibold text-slate-100">ID:</span> {data.board.id}</p>
				<p>
					<span class="font-semibold text-slate-100">User:</span>
					{data.board.ownerUser || 'Unknown'}
				</p>
				<p><span class="font-semibold text-slate-100">Owner:</span> {data.board.owner}</p>
				<p><span class="font-semibold text-slate-100">Lists:</span> {data.board.listCount}</p>
				<p>
					<span class="font-semibold text-slate-100">Theme:</span>
					{data.board.theme || 'default'}
				</p>
			</div>
		</section>

		{#if isOwner}
			<section
				class=" select-none mt-5 rounded-xl border border-sky-300/25 bg-slate-900/75 p-5 shadow-lg shadow-slate-950/60 backdrop-blur-sm"
			>
				<h2 class="text-lg font-semibold">Sharing</h2>
				<p class="mt-1 text-sm text-slate-300">
					Share this link so users can join with the default permission below.
				</p>

				<div class="mt-4 grid gap-2">
					<label for="share-link" class="text-sm font-semibold text-slate-200">Invite link</label>
					<div class="flex flex-wrap gap-2">
						<input
							id="share-link"
							type="text"
							class="min-w-0 flex-1 rounded-md border border-slate-600/70 bg-slate-800/80 px-3 py-2 text-sm text-slate-100"
							value={shareLink}
							readonly
						/>
						<button
							type="button"
							class="hover:cursor-pointer rounded-md border border-sky-300/30 bg-sky-700/80 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-600/90"
							onclick={copyShareLink}
						>
							Copy
						</button>
					</div>
				</div>

				<div class="mt-4 grid gap-2">
					<label for="default-role" class="text-sm font-semibold text-slate-200">
						Default permission for new users
					</label>
					<select
						id="default-role"
						class="hover:cursor-pointer w-fit rounded-md border border-slate-600/70 bg-slate-800/80 px-3 py-2 text-sm text-slate-100"
						value={defaultPermission}
						onchange={handleDefaultPermissionChange}
					>
						<option value="viewer">Reader</option>
						<option value="editor">Editor</option>
					</select>
				</div>

				<div class="mt-4">
					<h3 class="text-sm font-semibold text-slate-200">Members</h3>
					{#if sharingLoading}
						<p class="mt-2 text-sm text-slate-300">Loading members...</p>
					{:else if members.length}
						<ul class="select-text mt-3 grid gap-2">
							{#each members as member (member.userId)}
								<li
									class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-700 bg-slate-800/70 px-3 py-2 text-sm"
								>
									<div class="min-w-0">
										<p class="truncate font-semibold text-slate-100">
											{member.username || member.email || member.userId}
										</p>
										<p class="truncate text-xs text-slate-400">{member.email || member.userId}</p>
									</div>
									{#if member.role === 'owner'}
										<span
											class="select-none rounded-md border border-sky-300/30 bg-sky-500/20 px-2 py-1 text-xs font-semibold text-sky-100"
										>
											Owner
										</span>
									{:else}
										<div class="flex items-center gap-2">
											<select
												class="rounded-md border border-slate-600/70 bg-slate-700/80 px-2 py-1 text-xs text-slate-100"
												value={member.role}
												onchange={(event) =>
													updateMemberRole(
														member.userId,
														(event.currentTarget as HTMLSelectElement).value as 'viewer' | 'editor'
													)}
											>
												<option value="viewer">Reader</option>
												<option value="editor">Editor</option>
											</select>
											<button
												type="button"
												class="rounded-md border border-rose-300/30 bg-rose-500/20 px-2 py-1 text-xs font-semibold text-rose-100 transition-colors hover:bg-rose-500/35"
												onclick={() => updateMemberRole(member.userId, 'remove')}
											>
												Remove
											</button>
										</div>
									{/if}
								</li>
							{/each}
						</ul>
					{:else}
						<p class="mt-2 text-sm text-slate-300">No shared members yet.</p>
					{/if}
				</div>

				{#if sharingError}
					<p
						class="mt-3 rounded-md border border-rose-300/30 bg-rose-500/15 px-3 py-2 text-sm text-rose-100"
					>
						{sharingError}
					</p>
				{/if}
			</section>
		{/if}

		<section
			class="mt-5 rounded-xl border border-rose-300/25 bg-slate-900/75 p-5 shadow-lg shadow-slate-950/60 backdrop-blur-sm"
		>
			<h2 class="text-lg font-semibold text-rose-200">Danger zone</h2>
			<p class="mt-1 text-sm text-slate-300">High-impact actions on this board.</p>
			<div class="mt-4 flex flex-wrap items-center gap-3">
				<button
					type="button"
					class="cursor-pointer rounded-md border border-amber-300/40 bg-amber-500/20 px-4 py-2 text-sm font-semibold text-amber-100 transition-colors hover:bg-amber-500/35 disabled:cursor-not-allowed disabled:opacity-60"
					disabled={clearing || !isOwner}
					onclick={handleClearBoardContent}
				>
					{clearing ? 'Clearing...' : 'Clear board content'}
				</button>
				<button
					type="button"
					class="cursor-pointer rounded-md border border-rose-300/40 bg-rose-500/20 px-4 py-2 text-sm font-semibold text-rose-100 transition-colors hover:bg-rose-500/35 disabled:cursor-not-allowed disabled:opacity-60"
					disabled={deleting || !isOwner}
					onclick={handleDeleteBoard}
				>
					{deleting ? 'Deleting...' : 'Delete board'}
				</button>
			</div>
			{#if !isOwner}
				<p class="mt-2 text-sm text-slate-300">
					Only the board owner can clear board content or delete this board.
				</p>
			{/if}
		</section>
	</main>
{:else}
	<p class="p-4 text-slate-300">Loading...</p>
{/if}
