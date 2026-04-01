<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	type UiCard = {
		id: number;
		uuid?: string;
		title: string;
		tags?: string[];
	};

	const { card, listName } = $props<{
		card: UiCard;
		listName: string;
	}>();

	const dispatch = createEventDispatcher<{
		close: undefined;
	}>();

	function close() {
		dispatch('close');
	}

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) {
			close();
		}
	}

	function handleBackdropKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			close();
		}
	}
</script>

{#if card}
	<!-- backdrop -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75"
		role="dialog"
		aria-modal="true"
		tabindex="0"
		onclick={handleBackdropClick}
		onkeydown={handleBackdropKeydown}
	>
		<!-- panneau -->
		<div
			class="flex max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-xl border border-sky-300/25 bg-slate-900/95 text-slate-100 shadow-xl shadow-slate-950/70"
		>
			<div class="flex-1 p-6 space-y-4 overflow-y-auto">
				<!-- Header -->
				<div class="flex items-start justify-between gap-4">
					<div>
						<div class="mb-1 text-xs text-slate-300">
							in list <span class="underline">{listName}</span>
						</div>
						<h2 class="text-2xl font-bold">{card.title}</h2>
					</div>

					<button
						type="button"
						class="h-8 w-8 cursor-pointer rounded-full border border-slate-500/70 bg-slate-800/90 text-lg text-slate-300 shadow-sm shadow-slate-950/60 transition-all hover:border-sky-300/70 hover:bg-sky-500/20 hover:text-slate-100"
						onclick={close}
					>
						✕
					</button>
				</div>

				<!-- Tags (lecture seule pour l'instant) -->
				<section class="space-y-2">
					<h3 class="text-sm font-semibold text-sky-200">Labels</h3>

					{#if card.tags && card.tags.length}
						<div class="flex flex-wrap gap-2">
							{#each card.tags as tag (tag)}
								<span
									class="inline-flex items-center rounded-full border border-sky-300/30 bg-sky-500/20 px-2 py-0.5 text-xs text-sky-100"
								>
									{tag}
								</span>
							{/each}
						</div>
					{:else}
						<p class="text-xs text-slate-400">No labels yet.</p>
					{/if}
				</section>

				<!-- Placeholder description / attachments (on verra plus tard) -->
				<section class="space-y-2">
					<h3 class="text-sm font-semibold text-sky-200">Description</h3>
					<p class="text-xs text-slate-400">
						Description and other details will come in a next step.
					</p>
				</section>
			</div>
		</div>
	</div>
{/if}
