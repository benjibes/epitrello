<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { BoardHistoryEntry } from './board.types';

	const { open, historyLoading, historyError, historyEntries } = $props<{
		open: boolean;
		historyLoading: boolean;
		historyError: string;
		historyEntries: BoardHistoryEntry[];
	}>();

	const dispatch = createEventDispatcher<{
		close: undefined;
		refresh: undefined;
	}>();

	function close() {
		dispatch('close');
	}

	function refresh() {
		dispatch('refresh');
	}

	function formatHistoryTimestamp(value: string) {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) {
			return value;
		}

		return date.toLocaleString();
	}
</script>

{#if open}
	<button
		type="button"
		class="fixed inset-0 z-30 bg-slate-950/40 backdrop-blur-[1px]"
		onclick={close}
		aria-label="Close activity panel"
	></button>
	<aside
		id="board-history-panel"
		class="fixed right-0 top-16 z-40 h-[calc(100vh-4rem)] w-full max-w-md border-l border-sky-300/25 bg-slate-900/95 p-4 shadow-2xl shadow-slate-950/80"
	>
		<div class="mb-3 flex items-center justify-between gap-2">
			<h2 class="select-none text-sm font-semibold uppercase tracking-wide text-sky-200">
				Activity History
			</h2>
			<div class="flex items-center gap-2">
				<button
					type="button"
					class="hover:cursor-pointer rounded-md border border-slate-400/40 bg-slate-800/90 px-2 py-1 text-xs text-slate-100 transition-colors hover:bg-slate-700/90"
					onclick={refresh}
				>
					Refresh
				</button>
				<button
					type="button"
					class="hover:cursor-pointer h-8 w-8 rounded-full border border-slate-400/50 bg-slate-800/90 text-slate-200 transition-colors hover:bg-slate-700/90"
					onclick={close}
				>
					✕
				</button>
			</div>
		</div>

		{#if historyLoading}
			<p
				class="rounded-md border border-slate-500/35 bg-slate-800/70 px-3 py-2 text-sm text-slate-300"
			>
				Loading activity...
			</p>
		{:else if historyError}
			<p
				class="rounded-md border border-rose-300/30 bg-rose-500/15 px-3 py-2 text-sm text-rose-100"
			>
				{historyError}
			</p>
		{:else if historyEntries.length === 0}
			<p
				class="rounded-md border border-slate-500/35 bg-slate-800/70 px-3 py-2 text-sm text-slate-300"
			>
				No activity recorded yet.
			</p>
		{:else}
			<ol class="max-h-[calc(100vh-11rem)] space-y-2 overflow-y-auto pr-1">
				{#each historyEntries as entry (entry.id)}
					<li class="rounded-lg border border-slate-500/35 bg-slate-800/70 px-3 py-2">
						<p class="text-sm text-slate-100">{entry.message}</p>
						<div class="mt-1 flex items-center justify-between gap-2">
							<p class="text-xs text-slate-300">
								by <span class="font-semibold text-sky-200">{entry.actor.name}</span>
							</p>
							<span class="text-[11px] text-slate-400">
								{formatHistoryTimestamp(entry.createdAt)}
							</span>
						</div>
					</li>
				{/each}
			</ol>
		{/if}
	</aside>
{/if}
