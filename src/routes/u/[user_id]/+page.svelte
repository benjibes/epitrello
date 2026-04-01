<script lang="ts">
	import UserSearchBar from '../../user_search_bar.svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';

	const { data } = $props<{
		data: {
			user_id: string;
			email: string;
			name: string | null;
			role: 'student' | 'ape' | 'admin';
			ownedBoards: Array<{
				uuid: string;
				name: string;
				owner: string;
				role: 'owner';
			}>;
			sharedBoards: Array<{
				uuid: string;
				name: string;
				owner: string;
				ownerName: string;
				role: 'owner' | 'editor' | 'viewer';
			}>;
		};
	}>();

	let ready = $state(false);

	onMount(() => {
		if (!browser) return;

		const raw = localStorage.getItem('user');
		if (!raw) {
			goto(resolve('/login'));
			return;
		}

		let currentUser: { id?: string } | null = null;
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

		if (currentUser.id !== data.user_id) {
			goto(resolve(`/u/${currentUser.id}#profile`));
			return;
		}
		ready = true;
	});

	async function handleDeleteBoard(uuid: string) {
		const confirmDelete = confirm('Delete this board?');
		if (!confirmDelete) return;

		const res = await fetch(
			`/api/boards?id=${encodeURIComponent(uuid)}&userId=${encodeURIComponent(data.user_id)}`,
			{ method: 'DELETE' }
		);

		if (!res.ok) {
			console.error('Board deletion error', await res.text());
			return;
		}

		window.location.reload();
	}
</script>

{#if ready}
	<UserSearchBar />

	<div
		class="mx-8 my-10 rounded-xl border border-sky-300/25 bg-slate-900/75 p-5 text-slate-100 shadow-lg shadow-slate-950/60 backdrop-blur-sm md:mx-24 xl:mx-64"
	>
		<div class="mb-3 flex flex-wrap items-center justify-between gap-3">
			<h2 class="text-xl font-bold tracking-wide select-none">My boards</h2>
			<a
				href={resolve(`/u/${data.user_id}/settings`)}
				class="rounded-md border border-sky-300/25 bg-slate-800/80 px-3 py-2 text-sm font-semibold text-slate-100 transition-colors hover:bg-slate-700/90"
			>
				User Settings
			</a>
		</div>
		{#if data.ownedBoards && data.ownedBoards.length}
			<ul class="flex flex-wrap gap-3">
				{#each data.ownedBoards as board (board.uuid)}
					<li
						class="w-48 rounded-lg border border-sky-300/25 bg-slate-800/85 p-3 text-slate-100 shadow-md shadow-slate-950/50"
					>
						<div class="flex items-center justify-between gap-2">
							<a
								href={resolve(`/b/${board.uuid}`)}
								class="block text-lg font-semibold text-slate-100 hover:underline"
							>
								{board.name}
							</a>
							<button
								type="button"
								class="h-8 w-8 rounded-md border border-rose-300/25 bg-slate-700/80 text-rose-200 transition-all hover:cursor-pointer hover:bg-rose-500/20 hover:text-rose-100"
								onclick={() => handleDeleteBoard(board.uuid)}
								title="Delete this board"
							>
								X
							</button>
						</div>
						<p class="mt-1 text-xs text-slate-400">
							#{board.uuid}
						</p>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-sm text-slate-300">No boards yet. Use the "Create" button to create one.</p>
		{/if}

		<h2 class="mb-3 mt-8 text-xl font-bold tracking-wide select-none">Shared boards</h2>
		{#if data.sharedBoards && data.sharedBoards.length}
			<ul class="flex flex-wrap gap-3">
				{#each data.sharedBoards as board (board.uuid)}
					<li
						class="w-56 rounded-lg border border-sky-300/25 bg-slate-800/85 p-3 text-slate-100 shadow-md shadow-slate-950/50"
					>
						<div class="flex items-center justify-between gap-2">
							<a
								href={resolve(`/b/${board.uuid}`)}
								class="block text-lg font-semibold text-slate-100 hover:underline"
							>
								{board.name}
							</a>
							<span
								class="rounded-md border border-slate-500/60 bg-slate-700/90 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-200"
							>
								{board.role}
							</span>
						</div>
						<p class="mt-1 text-xs text-slate-400">
							Owner: {board.ownerName}
						</p>
						<p class="mt-1 text-xs text-slate-400">
							#{board.uuid}
						</p>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-sm text-slate-300">No shared boards yet.</p>
		{/if}
	</div>
{:else}
	<p class="p-4 text-slate-300">Redirecting...</p>
{/if}
