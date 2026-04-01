<script lang="ts">
	import EpitrelloLogo from '$lib/assets/logos/epitrello-logo.png';
	import LogoutButton from '$lib/LogoutButton.svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount, tick } from 'svelte';

	type SessionUser = {
		id: string;
	};

	type BoardSearchItem = {
		uuid: string;
		name: string;
		owner: string;
		ownerName: string;
		role: 'owner' | 'editor' | 'viewer';
	};

	type BoardSearchResponse = {
		ownedBoards: BoardSearchItem[];
		sharedBoards: BoardSearchItem[];
	};

	type SuggestionEntry = {
		board: BoardSearchItem;
		group: 'owned' | 'shared';
		index: number;
	};

	type NotificationItem = {
		id: string;
		type: 'board.added' | 'card.due_date';
		title: string;
		message: string;
		boardId: string | null;
		boardName: string | null;
		cardId: string | null;
		cardTitle: string | null;
		dueDate: string | null;
		createdAt: string;
		readAt: string | null;
	};

	type NotificationsResponse = {
		notifications: NotificationItem[];
	};

	const SEARCH_DEBOUNCE_MS = 180;
	const SEARCH_SUGGESTIONS_LIMIT = 8;
	const NOTIFICATIONS_REFRESH_INTERVAL_MS = 45000;
	type BoardTemplateId = 'product_roadmap' | 'sprint_planning' | 'personal_project';

	let currentUserId = $state('');
	let isCreatePanelOpen = $state(false);
	let createBoardName = $state('');
	let createBoardTemplateId = $state<BoardTemplateId | ''>('');
	let createBoardError = $state('');
	let isCreatingBoard = $state(false);
	let createNameInput = $state<HTMLInputElement | null>(null);
	let userSearchBarElement = $state<HTMLElement | null>(null);
	let searchInputElement = $state<HTMLInputElement | null>(null);
	let searchQuery = $state('');
	let isSearchOpen = $state(false);
	let isSearchLoading = $state(false);
	let searchError = $state('');
	let searchOwnedBoards = $state<BoardSearchItem[]>([]);
	let searchSharedBoards = $state<BoardSearchItem[]>([]);
	let highlightedSuggestionIndex = $state(-1);
	let searchDebounceTimer = $state<ReturnType<typeof setTimeout> | null>(null);
	let notificationsRefreshTimer = $state<ReturnType<typeof setInterval> | null>(null);
	let lastSearchFetchToken = 0;
	let notifications = $state<NotificationItem[]>([]);
	let isNotificationsOpen = $state(false);
	let isNotificationsLoading = $state(false);
	let notificationsError = $state('');
	let isMarkingNotificationsRead = $state(false);

	const ownedSuggestionEntries = $derived<SuggestionEntry[]>(
		searchOwnedBoards.map((board, index) => ({
			board,
			group: 'owned',
			index
		}))
	);

	const sharedSuggestionEntries = $derived<SuggestionEntry[]>(
		searchSharedBoards.map((board, index) => ({
			board,
			group: 'shared',
			index: searchOwnedBoards.length + index
		}))
	);

	const searchSuggestionEntries = $derived<SuggestionEntry[]>([
		...ownedSuggestionEntries,
		...sharedSuggestionEntries
	]);

	const shouldShowSuggestionDropdown = $derived(
		isSearchOpen &&
			(isSearchLoading ||
				searchError.length > 0 ||
				searchQuery.trim().length > 0 ||
				searchSuggestionEntries.length > 0)
	);

	const unreadNotificationsCount = $derived(
		notifications.reduce((total, notification) => total + (notification.readAt ? 0 : 1), 0)
	);

	function readCurrentUser(): SessionUser | null {
		if (!browser) return null;

		const raw = localStorage.getItem('user');
		if (!raw) {
			return null;
		}

		let parsedUser: { id?: string } | null = null;
		try {
			parsedUser = JSON.parse(raw);
		} catch {
			return null;
		}

		if (!parsedUser?.id) {
			return null;
		}

		return { id: parsedUser.id };
	}

	function getCurrentUserOrRedirect(): SessionUser | null {
		const user = readCurrentUser();
		if (!user) {
			localStorage.removeItem('user');
			localStorage.removeItem('authToken');
			goto(resolve('/login'));
			return null;
		}

		return user;
	}

	function clearSearchDebounceTimer() {
		if (!searchDebounceTimer) {
			return;
		}

		clearTimeout(searchDebounceTimer);
		searchDebounceTimer = null;
	}

	function clearNotificationsRefreshTimer() {
		if (!notificationsRefreshTimer) {
			return;
		}

		clearInterval(notificationsRefreshTimer);
		notificationsRefreshTimer = null;
	}

	function closeSearchSuggestions() {
		isSearchOpen = false;
		highlightedSuggestionIndex = -1;
	}

	function closeNotificationsPanel() {
		isNotificationsOpen = false;
	}

	function boardRoleLabel(role: BoardSearchItem['role']) {
		if (role === 'owner') return 'Owner';
		if (role === 'editor') return 'Editor';
		return 'Viewer';
	}

	function boardSubtitle(entry: SuggestionEntry) {
		if (entry.group === 'owned') {
			return 'Owned by you';
		}

		return `Shared by ${entry.board.ownerName}`;
	}

	function formatNotificationTimestamp(value: string) {
		const timestamp = new Date(value);
		if (Number.isNaN(timestamp.getTime())) {
			return value;
		}

		return timestamp.toLocaleString();
	}

	async function fetchNotifications(options: { silent?: boolean } = {}) {
		const user = getCurrentUserOrRedirect();
		if (!user) {
			return;
		}

		currentUserId = user.id;
		const silent = options.silent ?? false;
		if (!silent) {
			isNotificationsLoading = true;
		}
		notificationsError = '';

		const params = new URLSearchParams({
			userId: currentUserId,
			limit: '20'
		});

		try {
			const response = await fetch(`/api/notifications?${params.toString()}`);
			if (!response.ok) {
				const message = await response.text();
				throw new Error(message || 'Unable to load notifications');
			}

			const payload = (await response.json()) as Partial<NotificationsResponse>;
			notifications = Array.isArray(payload.notifications) ? payload.notifications : [];
		} catch (fetchError) {
			notifications = [];
			notificationsError =
				fetchError instanceof Error
					? fetchError.message
					: 'Unable to load notifications right now.';
		} finally {
			if (!silent) {
				isNotificationsLoading = false;
			}
		}
	}

	async function markAllNotificationsRead() {
		if (isMarkingNotificationsRead) {
			return;
		}

		const user = getCurrentUserOrRedirect();
		if (!user) {
			return;
		}

		currentUserId = user.id;
		isMarkingNotificationsRead = true;
		try {
			await fetch('/api/notifications', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					userId: currentUserId
				})
			});
		} catch (markError) {
			console.error('Unable to mark notifications as read', markError);
		} finally {
			isMarkingNotificationsRead = false;
		}
	}

	async function toggleNotificationsPanel() {
		isNotificationsOpen = !isNotificationsOpen;
		if (!isNotificationsOpen) {
			return;
		}

		await fetchNotifications();
		if (unreadNotificationsCount > 0) {
			await markAllNotificationsRead();
			await fetchNotifications({ silent: true });
		}
	}

	async function fetchSearchSuggestions(rawQuery: string) {
		const user = getCurrentUserOrRedirect();
		if (!user) {
			return;
		}

		currentUserId = user.id;
		const query = rawQuery.trim();
		const fetchToken = ++lastSearchFetchToken;
		isSearchLoading = true;
		searchError = '';

		const params = new URLSearchParams({
			userId: currentUserId,
			q: query,
			limit: String(SEARCH_SUGGESTIONS_LIMIT)
		});

		try {
			const response = await fetch(`/api/boards?${params.toString()}`);
			if (!response.ok) {
				const message = await response.text();
				throw new Error(message || 'Unable to search boards');
			}

			const payload = (await response.json()) as Partial<BoardSearchResponse>;
			if (fetchToken !== lastSearchFetchToken) {
				return;
			}

			const nextOwnedBoards = Array.isArray(payload.ownedBoards) ? payload.ownedBoards : [];
			const nextSharedBoards = Array.isArray(payload.sharedBoards) ? payload.sharedBoards : [];
			searchOwnedBoards = nextOwnedBoards;
			searchSharedBoards = nextSharedBoards;

			const totalSuggestions = nextOwnedBoards.length + nextSharedBoards.length;
			if (totalSuggestions === 0) {
				highlightedSuggestionIndex = -1;
			} else if (highlightedSuggestionIndex >= totalSuggestions) {
				highlightedSuggestionIndex = 0;
			}
		} catch (fetchError) {
			if (fetchToken !== lastSearchFetchToken) {
				return;
			}

			searchOwnedBoards = [];
			searchSharedBoards = [];
			searchError =
				fetchError instanceof Error ? fetchError.message : 'Unable to search boards right now.';
		} finally {
			if (fetchToken === lastSearchFetchToken) {
				isSearchLoading = false;
			}
		}
	}

	function scheduleSearchSuggestionsFetch() {
		clearSearchDebounceTimer();
		searchDebounceTimer = setTimeout(() => {
			void fetchSearchSuggestions(searchQuery);
		}, SEARCH_DEBOUNCE_MS);
	}

	function handleSearchFocus() {
		closeNotificationsPanel();
		isSearchOpen = true;
		void fetchSearchSuggestions(searchQuery);
	}

	function handleSearchInput(event: Event) {
		const target = event.currentTarget as HTMLInputElement;
		searchQuery = target.value;
		closeNotificationsPanel();
		isSearchOpen = true;
		highlightedSuggestionIndex = -1;
		scheduleSearchSuggestionsFetch();
	}

	function handleSearchKeydown(event: KeyboardEvent) {
		const suggestionsCount = searchSuggestionEntries.length;

		if (event.key === 'ArrowDown') {
			event.preventDefault();
			isSearchOpen = true;
			if (suggestionsCount === 0) {
				return;
			}
			highlightedSuggestionIndex =
				highlightedSuggestionIndex < suggestionsCount - 1 ? highlightedSuggestionIndex + 1 : 0;
			return;
		}

		if (event.key === 'ArrowUp') {
			event.preventDefault();
			isSearchOpen = true;
			if (suggestionsCount === 0) {
				return;
			}
			highlightedSuggestionIndex =
				highlightedSuggestionIndex > 0 ? highlightedSuggestionIndex - 1 : suggestionsCount - 1;
			return;
		}

		if (event.key === 'Enter') {
			if (!isSearchOpen || suggestionsCount === 0) {
				return;
			}

			event.preventDefault();
			const suggestionIndex = highlightedSuggestionIndex >= 0 ? highlightedSuggestionIndex : 0;
			void navigateToSearchSuggestion(suggestionIndex);
			return;
		}

		if (event.key === 'Escape' && isSearchOpen) {
			event.preventDefault();
			closeSearchSuggestions();
		}
	}

	async function navigateToSearchSuggestion(index: number) {
		const entry = searchSuggestionEntries[index];
		if (!entry) {
			return;
		}

		searchQuery = entry.board.name;
		closeSearchSuggestions();
		closeNotificationsPanel();
		await goto(resolve(`/b/${entry.board.uuid}`));
	}

	function handleSuggestionMouseEnter(index: number) {
		highlightedSuggestionIndex = index;
	}

	function handleSuggestionMouseDown(event: MouseEvent) {
		event.preventDefault();
	}

	onMount(() => {
		const user = getCurrentUserOrRedirect();
		if (!user) {
			return;
		}
		currentUserId = user.id;

		void fetchSearchSuggestions('');
		void fetchNotifications();
		notificationsRefreshTimer = setInterval(() => {
			void fetchNotifications({ silent: true });
		}, NOTIFICATIONS_REFRESH_INTERVAL_MS);

		const handleDocumentMousedown = (event: MouseEvent) => {
			if (!userSearchBarElement || !(event.target instanceof Node)) {
				return;
			}

			if (userSearchBarElement.contains(event.target)) {
				return;
			}

			closeSearchSuggestions();
			closeNotificationsPanel();
		};

		document.addEventListener('mousedown', handleDocumentMousedown);

		return () => {
			clearSearchDebounceTimer();
			clearNotificationsRefreshTimer();
			document.removeEventListener('mousedown', handleDocumentMousedown);
		};
	});

	async function openCreatePanel() {
		const user = getCurrentUserOrRedirect();
		if (!user) return;

		currentUserId = user.id;
		closeSearchSuggestions();
		closeNotificationsPanel();
		createBoardName = '';
		createBoardError = '';
		isCreatePanelOpen = true;
		await tick();
		createNameInput?.focus();
	}

	function closeCreatePanel() {
		if (isCreatingBoard) return;
		isCreatePanelOpen = false;
		createBoardTemplateId = '';
		createBoardError = '';
	}

	function handleCreatePanelBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) {
			closeCreatePanel();
		}
	}

	function handleCreatePanelBackdropKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			closeCreatePanel();
		}
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			if (isCreatePanelOpen) {
				closeCreatePanel();
				return;
			}

			if (isSearchOpen) {
				closeSearchSuggestions();
			}

			if (isNotificationsOpen) {
				closeNotificationsPanel();
			}
		}
	}

	function applyTemplate(templateId: BoardTemplateId, name: string) {
		createBoardTemplateId = templateId;
		createBoardName = name;
		createBoardError = '';
	}

	async function handleCreateSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (isCreatingBoard) return;

		const user = getCurrentUserOrRedirect();
		if (!user) return;

		currentUserId = user.id;
		const name = createBoardName.trim();

		if (!name) {
			createBoardError = 'Board name is required.';
			return;
		}

		if (name.length > 80) {
			createBoardError = 'Board name must be 80 characters maximum.';
			return;
		}

		isCreatingBoard = true;
		createBoardError = '';

		const res = await fetch('/api/boards', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				ownerId: currentUserId,
				name,
				templateId: createBoardTemplateId || undefined
			})
		});

		if (!res.ok) {
			console.error('Board creation error', await res.text());
			createBoardError = 'Unable to create board right now.';
			isCreatingBoard = false;
			return;
		}

		const body = await res.json();
		console.log('Board created by /api/boards:', body);

		const uuid = body.uuid;
		if (!uuid) {
			createBoardError = 'Invalid server response (missing uuid).';
			isCreatingBoard = false;
			return;
		}

		isCreatingBoard = false;
		isCreatePanelOpen = false;
		createBoardTemplateId = '';
		goto(resolve(`/b/${uuid}`));
	}

	function handleProfileClick() {
		const user = getCurrentUserOrRedirect();
		if (!user?.id) {
			return;
		}

		closeNotificationsPanel();
		goto(resolve(`/u/${user.id}#profile`));
	}
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div
	id="user-search-bar"
	class="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-sky-300/20 bg-slate-900/85 p-4 shadow-lg shadow-slate-950/50 backdrop-blur-sm"
	bind:this={userSearchBarElement}
>
	<a
		href={resolve(currentUserId ? `/u/${currentUserId}` : '/login')}
		class="flex flex-row items-center gap-2 select-none"
		draggable="false"
		><img src={EpitrelloLogo} alt="EpiTrello Logo" class="w-12" draggable="false" />
		<p class="text-xl font-semibold tracking-wide text-slate-100">EpiTrello</p></a
	>
	<div class="relative min-w-0 flex-1">
		<input
			type="text"
			placeholder="Search boards"
			bind:this={searchInputElement}
			bind:value={searchQuery}
			class="w-full rounded-md border border-slate-600/60 bg-slate-800/80 px-4 py-2 text-sm text-slate-100 shadow-sm shadow-slate-950/40 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
			role="combobox"
			aria-autocomplete="list"
			aria-expanded={shouldShowSuggestionDropdown}
			aria-controls="board-search-suggestions"
			autocomplete="off"
			onfocus={handleSearchFocus}
			oninput={handleSearchInput}
			onkeydown={handleSearchKeydown}
		/>

		{#if shouldShowSuggestionDropdown}
			<div
				id="board-search-suggestions"
				class="absolute left-0 right-0 top-[calc(100%+0.45rem)] z-50 max-h-96 overflow-y-auto rounded-lg border border-sky-300/25 bg-slate-900/95 p-2 shadow-xl shadow-slate-950/70 backdrop-blur-sm"
			>
				{#if isSearchLoading}
					<p class="px-2 py-2 text-sm text-slate-300">Searching boards...</p>
				{:else if searchError}
					<p class="px-2 py-2 text-sm text-rose-200">{searchError}</p>
				{:else if searchSuggestionEntries.length === 0}
					<p class="px-2 py-2 text-sm text-slate-300">No board found.</p>
				{:else}
					{#if ownedSuggestionEntries.length}
						<p
							class="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400"
						>
							My boards
						</p>
						<ul class="mb-2">
							{#each ownedSuggestionEntries as entry (entry.board.uuid)}
								<li>
									<button
										type="button"
										class={`flex w-full items-center justify-between gap-3 rounded-md border px-2 py-2 text-left transition-colors ${
											highlightedSuggestionIndex === entry.index
												? 'border-sky-300/35 bg-sky-500/20'
												: 'border-transparent hover:bg-slate-700/80'
										}`}
										onmouseenter={() => handleSuggestionMouseEnter(entry.index)}
										onmousedown={handleSuggestionMouseDown}
										onclick={() => navigateToSearchSuggestion(entry.index)}
									>
										<div class="min-w-0">
											<p class="truncate text-sm font-semibold text-slate-100">
												{entry.board.name}
											</p>
											<p class="truncate text-xs text-slate-400">{boardSubtitle(entry)}</p>
										</div>
										<span
											class="rounded-md border border-slate-500/60 bg-slate-700/90 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-200"
										>
											{boardRoleLabel(entry.board.role)}
										</span>
									</button>
								</li>
							{/each}
						</ul>
					{/if}

					{#if sharedSuggestionEntries.length}
						<p
							class="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400"
						>
							Shared with me
						</p>
						<ul>
							{#each sharedSuggestionEntries as entry (entry.board.uuid)}
								<li>
									<button
										type="button"
										class={`flex w-full items-center justify-between gap-3 rounded-md border px-2 py-2 text-left transition-colors ${
											highlightedSuggestionIndex === entry.index
												? 'border-sky-300/35 bg-sky-500/20'
												: 'border-transparent hover:bg-slate-700/80'
										}`}
										onmouseenter={() => handleSuggestionMouseEnter(entry.index)}
										onmousedown={handleSuggestionMouseDown}
										onclick={() => navigateToSearchSuggestion(entry.index)}
									>
										<div class="min-w-0">
											<p class="truncate text-sm font-semibold text-slate-100">
												{entry.board.name}
											</p>
											<p class="truncate text-xs text-slate-400">{boardSubtitle(entry)}</p>
										</div>
										<span
											class="rounded-md border border-slate-500/60 bg-slate-700/90 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-200"
										>
											{boardRoleLabel(entry.board.role)}
										</span>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				{/if}
			</div>
		{/if}
	</div>
	<button
		type="button"
		class="cursor-pointer rounded-md border border-sky-300/25 bg-sky-600/85 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-sky-900/60 transition-all hover:bg-sky-500 hover:shadow-md hover:shadow-sky-900/70"
		onclick={openCreatePanel}>Create</button
	>
	<div class="relative">
		<button
			type="button"
			class="relative cursor-pointer rounded-md border border-sky-300/25 bg-sky-700/85 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-sky-900/60 transition-all hover:bg-sky-600 hover:shadow-md hover:shadow-sky-900/70"
			onclick={toggleNotificationsPanel}
			aria-expanded={isNotificationsOpen}
			aria-controls="notifications-panel"
		>
			Notifications
			{#if unreadNotificationsCount > 0}
				<span
					class="absolute -right-2 -top-2 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full border border-rose-300/45 bg-rose-500/90 px-1 text-[11px] font-bold text-rose-50"
				>
					{Math.min(unreadNotificationsCount, 99)}
				</span>
			{/if}
		</button>

		{#if isNotificationsOpen}
			<div
				id="notifications-panel"
				class="absolute right-0 top-[calc(100%+0.45rem)] z-50 w-[min(92vw,24rem)] rounded-lg border border-sky-300/25 bg-slate-900/95 p-2 shadow-xl shadow-slate-950/70 backdrop-blur-sm"
			>
				<div class="mb-2 flex items-center justify-between gap-2">
					<p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">
						Notifications
					</p>
					<button
						type="button"
						class="rounded-md border border-slate-500/60 bg-slate-700/80 px-2 py-1 text-[11px] font-semibold text-slate-100 transition-colors hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
						onclick={async () => {
							await markAllNotificationsRead();
							await fetchNotifications({ silent: true });
						}}
						disabled={unreadNotificationsCount === 0 || isMarkingNotificationsRead}
					>
						Mark all read
					</button>
				</div>

				{#if isNotificationsLoading}
					<p class="px-1 py-2 text-sm text-slate-300">Loading notifications...</p>
				{:else if notificationsError}
					<p class="px-1 py-2 text-sm text-rose-200">{notificationsError}</p>
				{:else if notifications.length === 0}
					<p class="px-1 py-2 text-sm text-slate-300">No notifications yet.</p>
				{:else}
					<ul class="max-h-80 space-y-2 overflow-y-auto pr-1">
						{#each notifications as notification (notification.id)}
							<li
								class={`rounded-md border px-2 py-2 ${
									notification.readAt
										? 'border-slate-600/50 bg-slate-800/50'
										: 'border-sky-300/35 bg-sky-500/10'
								}`}
							>
								<p class="truncate text-sm font-semibold text-slate-100">{notification.title}</p>
								<p class="mt-1 text-xs text-slate-300">{notification.message}</p>
								<div class="mt-2 flex items-center justify-between gap-2">
									<span class="text-[11px] text-slate-400">
										{formatNotificationTimestamp(notification.createdAt)}
									</span>
									{#if notification.boardId}
										<a
											href={resolve(`/b/${notification.boardId}`)}
											class="rounded-md border border-slate-500/50 bg-slate-700/80 px-2 py-1 text-[11px] font-semibold text-slate-100 transition-colors hover:bg-slate-600"
										>
											Open
										</a>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
	</div>
	<button
		type="button"
		class="cursor-pointer rounded-md border border-sky-300/25 bg-sky-700/85 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-sky-900/60 transition-all hover:bg-sky-600 hover:shadow-md hover:shadow-sky-900/70"
		onclick={handleProfileClick}>Profile</button
	>
	<LogoutButton />
</div>

{#if isCreatePanelOpen}
	<div
		class="fixed inset-0 z-50 flex bg-slate-950/70"
		role="dialog"
		aria-modal="true"
		aria-labelledby="create-board-title"
		tabindex="0"
		onclick={handleCreatePanelBackdropClick}
		onkeydown={handleCreatePanelBackdropKeydown}
	>
		<aside
			class="ml-auto flex h-full w-full max-w-md flex-col border-l border-sky-300/25 bg-slate-900/95 p-6 text-slate-100 shadow-xl shadow-slate-950/80"
		>
			<div class="mb-6 flex items-start justify-between gap-3">
				<div>
					<p class="select-none text-xs font-semibold uppercase tracking-[0.18em] text-sky-200/80">
						Workspace
					</p>
					<h2 id="create-board-title" class="mt-1 select-none text-2xl font-bold">
						Create a board
					</h2>
					<p class="mt-2 select-none text-sm text-slate-300">
						Give it a clear name, you can rename it later.
					</p>
				</div>
				<button
					type="button"
					class="h-9 w-9 cursor-pointer rounded-md border border-slate-500/70 bg-slate-800/80 text-lg text-slate-300 transition-colors hover:bg-slate-700/90 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
					onclick={closeCreatePanel}
					disabled={isCreatingBoard}
					aria-label="Close board creation panel"
				>
					x
				</button>
			</div>

			<form class="flex flex-1 flex-col" onsubmit={handleCreateSubmit}>
				<label for="board-name" class="mb-2 text-sm font-semibold text-sky-100">Board name</label>
				<input
					id="board-name"
					type="text"
					bind:value={createBoardName}
					bind:this={createNameInput}
					placeholder="e.g. Sprint 12 - Backlog"
					maxlength="80"
					class="rounded-lg border border-slate-600/60 bg-slate-800/90 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
					disabled={isCreatingBoard}
					required
				/>
				<div class="mt-2 flex items-center justify-between text-xs text-slate-400">
					<span class="select-none">Name visible to all board members.</span>
					<span>{createBoardName.trim().length}/80</span>
				</div>

				<div class="mt-6">
					<p
						class="mb-2 select-none text-xs font-semibold uppercase tracking-[0.18em] text-slate-300"
					>
						Quick templates
					</p>
					<div class="flex flex-wrap gap-2">
						<button
							type="button"
							class={`cursor-pointer rounded-md border px-3 py-2 text-xs font-semibold transition-colors ${
								createBoardTemplateId === 'product_roadmap'
									? 'border-sky-200/50 bg-sky-500/25 text-sky-100'
									: 'border-sky-300/25 bg-slate-800/80 text-slate-100 hover:bg-slate-700'
							}`}
							onclick={() => applyTemplate('product_roadmap', 'Product Roadmap')}
							disabled={isCreatingBoard}
						>
							Product Roadmap
						</button>
						<button
							type="button"
							class={`cursor-pointer rounded-md border px-3 py-2 text-xs font-semibold transition-colors ${
								createBoardTemplateId === 'sprint_planning'
									? 'border-sky-200/50 bg-sky-500/25 text-sky-100'
									: 'border-sky-300/25 bg-slate-800/80 text-slate-100 hover:bg-slate-700'
							}`}
							onclick={() => applyTemplate('sprint_planning', 'Sprint Planning')}
							disabled={isCreatingBoard}
						>
							Sprint Planning
						</button>
						<button
							type="button"
							class={`cursor-pointer rounded-md border px-3 py-2 text-xs font-semibold transition-colors ${
								createBoardTemplateId === 'personal_project'
									? 'border-sky-200/50 bg-sky-500/25 text-sky-100'
									: 'border-sky-300/25 bg-slate-800/80 text-slate-100 hover:bg-slate-700'
							}`}
							onclick={() => applyTemplate('personal_project', 'Personal Project')}
							disabled={isCreatingBoard}
						>
							Personal Project
						</button>
					</div>
				</div>

				{#if createBoardError}
					<p
						class="mt-4 rounded-md border border-rose-300/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
					>
						{createBoardError}
					</p>
				{/if}

				<div class="mt-auto flex justify-end gap-3 pt-8">
					<button
						type="button"
						class="cursor-pointer rounded-md border border-slate-500/60 bg-slate-800/80 px-4 py-2 text-sm font-semibold text-slate-100 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
						onclick={closeCreatePanel}
						disabled={isCreatingBoard}
					>
						Cancel
					</button>
					<button
						type="submit"
						class="cursor-pointer rounded-md border border-sky-300/25 bg-sky-600/90 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
						disabled={isCreatingBoard}
					>
						{isCreatingBoard ? 'Creating...' : 'Create board'}
					</button>
				</div>
			</form>
		</aside>
	</div>
{/if}
