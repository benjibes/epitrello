<script lang="ts">
	import UserSearchBar from '../../../user_search_bar.svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';

	const { data } = $props<{
		data: {
			user_id: string;
			email: string;
			name: string;
			role: 'student' | 'ape' | 'admin';
		};
	}>();

	const DISPLAY_NAME_MAX_LENGTH = 80;
	type UserRole = 'student' | 'ape' | 'admin';
	type ManagedUser = {
		uuid: string;
		email: string;
		username: string;
		role: UserRole;
	};

	let ready = $state(false);
	let currentUserId = $state('');
	let displayName = $state('');
	let saving = $state(false);
	let deleting = $state(false);
	let errorMessage = $state('');
	let successMessage = $state('');
	let managedUsers = $state<ManagedUser[]>([]);
	let loadingManagedUsers = $state(false);
	let creatingManagedUser = $state(false);
	let updatingManagedUserId = $state('');
	let adminErrorMessage = $state('');
	let adminSuccessMessage = $state('');
	let newManagedUserEmail = $state('');
	let newManagedUserName = $state('');
	let newManagedUserRole = $state<UserRole>('student');
	const isAdmin = $derived(data.role === 'admin');

	function normalizeRole(value: unknown): UserRole {
		return value === 'ape' || value === 'admin' ? value : 'student';
	}

	function sortManagedUsers(users: ManagedUser[]) {
		return [...users].sort((left, right) => {
			if (left.uuid === data.user_id) return -1;
			if (right.uuid === data.user_id) return 1;
			return left.username.localeCompare(right.username, undefined, { sensitivity: 'base' });
		});
	}

	onMount(() => {
		if (!browser) return;

		const rawUser = localStorage.getItem('user');
		if (!rawUser) {
			goto(resolve('/login'));
			return;
		}

		let currentUser: { id?: string; name?: string; role?: string } | null = null;
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
		if (currentUserId !== data.user_id) {
			goto(resolve(`/u/${currentUserId}/settings`));
			return;
		}

		const initialDisplayName =
			data.name?.trim() || currentUser.name?.trim() || data.email.split('@')[0];
		displayName = initialDisplayName;

		ready = true;
		if (isAdmin) {
			void loadManagedUsers();
		}
	});

	function updateLocalUser(patch: { name?: string; role?: UserRole }) {
		if (!browser) return;

		const rawUser = localStorage.getItem('user');
		if (!rawUser) return;

		try {
			const currentUser = JSON.parse(rawUser) as { id?: string; name?: string; role?: string };
			if (currentUser.id !== data.user_id) return;

			if (typeof patch.name === 'string') {
				currentUser.name = patch.name;
			}
			if (typeof patch.role === 'string') {
				currentUser.role = patch.role;
			}
			localStorage.setItem('user', JSON.stringify(currentUser));
		} catch {
			// no-op: malformed localStorage user should not break settings save flow
		}
	}

	async function loadManagedUsers() {
		if (!isAdmin || !currentUserId) return;
		loadingManagedUsers = true;
		adminErrorMessage = '';

		try {
			const response = await fetch(`/api/users?requesterId=${encodeURIComponent(currentUserId)}`);
			const payload = (await response.json().catch(() => null)) as {
				users?: Array<Partial<ManagedUser>>;
				error?: string;
			} | null;

			if (!response.ok) {
				adminErrorMessage = payload?.error ?? 'Unable to load users.';
				return;
			}

			const normalizedUsers = Array.isArray(payload?.users)
				? payload.users
						.filter(
							(user): user is Partial<ManagedUser> & { uuid: string; email: string } =>
								typeof user?.uuid === 'string' && typeof user?.email === 'string'
						)
						.map((user) => ({
							uuid: user.uuid.trim(),
							email: user.email.trim(),
							username: String(user.username ?? user.email).trim(),
							role: normalizeRole(user.role)
						}))
				: [];

			managedUsers = sortManagedUsers(normalizedUsers);
		} catch (error) {
			console.error('Erreur load users', error);
			adminErrorMessage = 'Network error while loading users.';
		} finally {
			loadingManagedUsers = false;
		}
	}

	async function handleCreateManagedUser(event: SubmitEvent) {
		event.preventDefault();
		if (!isAdmin || !currentUserId || creatingManagedUser) return;

		const email = newManagedUserEmail.trim().toLowerCase();
		const username = newManagedUserName.trim();
		adminErrorMessage = '';
		adminSuccessMessage = '';

		if (!email) {
			adminErrorMessage = 'Email is required.';
			return;
		}

		creatingManagedUser = true;
		try {
			const response = await fetch('/api/users', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					requesterId: currentUserId,
					email,
					name: username,
					role: newManagedUserRole
				})
			});

			const payload = (await response.json().catch(() => null)) as {
				user?: ManagedUser;
				error?: string;
			} | null;

			if (!response.ok) {
				adminErrorMessage = payload?.error ?? 'Unable to create user.';
				return;
			}

			newManagedUserEmail = '';
			newManagedUserName = '';
			newManagedUserRole = 'student';
			adminSuccessMessage = `User "${payload?.user?.email ?? email}" created.`;
			await loadManagedUsers();
		} catch (error) {
			console.error('Erreur create user', error);
			adminErrorMessage = 'Network error while creating user.';
		} finally {
			creatingManagedUser = false;
		}
	}

	async function handleManagedUserRoleChange(targetUser: ManagedUser, role: UserRole) {
		if (!isAdmin || !currentUserId || updatingManagedUserId) return;
		if (targetUser.role === role) return;

		updatingManagedUserId = targetUser.uuid;
		adminErrorMessage = '';
		adminSuccessMessage = '';

		try {
			const response = await fetch('/api/users', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					userId: targetUser.uuid,
					requesterId: currentUserId,
					role
				})
			});
			const payload = (await response.json().catch(() => null)) as {
				role?: UserRole;
				error?: string;
			} | null;

			if (!response.ok) {
				adminErrorMessage = payload?.error ?? 'Unable to update user role.';
				return;
			}

			managedUsers = sortManagedUsers(
				managedUsers.map((user) => (user.uuid === targetUser.uuid ? { ...user, role } : user))
			);
			if (targetUser.uuid === data.user_id) {
				updateLocalUser({ role: payload?.role ?? role });
			}
			adminSuccessMessage = `Updated role for "${targetUser.username}" to ${role}.`;
		} catch (error) {
			console.error('Erreur update role', error);
			adminErrorMessage = 'Network error while updating role.';
		} finally {
			updatingManagedUserId = '';
		}
	}

	async function handleDeleteManagedUser(targetUser: ManagedUser) {
		if (!isAdmin || !currentUserId || updatingManagedUserId) return;
		const confirmed = confirm(`Delete account "${targetUser.email}"?`);
		if (!confirmed) return;

		updatingManagedUserId = targetUser.uuid;
		adminErrorMessage = '';
		adminSuccessMessage = '';

		try {
			const response = await fetch(
				`/api/users?id=${encodeURIComponent(targetUser.uuid)}&requesterId=${encodeURIComponent(currentUserId)}`,
				{ method: 'DELETE' }
			);
			const payload = (await response.json().catch(() => null)) as { error?: string } | null;

			if (!response.ok) {
				adminErrorMessage = payload?.error ?? 'Unable to delete user.';
				return;
			}

			if (targetUser.uuid === data.user_id) {
				localStorage.removeItem('authToken');
				localStorage.removeItem('user');
				goto(resolve('/login'));
				return;
			}

			managedUsers = managedUsers.filter((user) => user.uuid !== targetUser.uuid);
			adminSuccessMessage = `Deleted account "${targetUser.email}".`;
		} catch (error) {
			console.error('Erreur delete managed user', error);
			adminErrorMessage = 'Network error while deleting user.';
		} finally {
			updatingManagedUserId = '';
		}
	}

	async function handleSave(event: SubmitEvent) {
		event.preventDefault();
		if (saving) return;

		const trimmedName = displayName.trim();
		errorMessage = '';
		successMessage = '';

		if (!trimmedName) {
			errorMessage = 'Display name cannot be empty.';
			return;
		}

		saving = true;
		try {
			const response = await fetch('/api/users', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					userId: data.user_id,
					requesterId: currentUserId,
					displayName: trimmedName
				})
			});

			const payload = (await response.json().catch(() => null)) as {
				ok?: boolean;
				name?: string;
				error?: string;
			} | null;
			if (!response.ok) {
				errorMessage = payload?.error ?? 'Unable to update profile settings.';
				return;
			}

			displayName = String(payload?.name ?? trimmedName);
			updateLocalUser({ name: displayName });
			successMessage = 'Profile updated.';
		} catch (err) {
			console.error('Erreur update profile', err);
			errorMessage = 'Network error, please try again.';
		} finally {
			saving = false;
		}
	}

	async function handleDeleteAccount() {
		if (!currentUserId || deleting) return;

		const confirmed = confirm(
			`Permanently delete account "${data.email}"? All owned boards will also be deleted.`
		);
		if (!confirmed) return;

		const validation = prompt('Type DELETE to confirm account removal.');
		if (validation?.trim().toUpperCase() !== 'DELETE') {
			errorMessage = 'Deletion canceled.';
			return;
		}

		deleting = true;
		errorMessage = '';
		successMessage = '';

		try {
			const response = await fetch(
				`/api/users?id=${encodeURIComponent(data.user_id)}&requesterId=${encodeURIComponent(currentUserId)}`,
				{ method: 'DELETE' }
			);
			const payload = (await response.json().catch(() => null)) as { error?: string } | null;

			if (!response.ok) {
				errorMessage = payload?.error ?? 'Account deletion failed.';
				return;
			}

			localStorage.removeItem('authToken');
			localStorage.removeItem('user');
			goto(resolve('/login'));
		} catch (err) {
			console.error('Erreur delete account', err);
			errorMessage = 'Network error while deleting account.';
		} finally {
			deleting = false;
		}
	}
</script>

{#if ready}
	<UserSearchBar />

	<main
		class="mx-auto min-h-[calc(100vh-4rem)] w-full max-w-5xl px-4 py-6 text-slate-100 sm:px-8 lg:px-12"
	>
		<section
			class="rounded-xl border border-sky-300/25 bg-slate-900/75 p-5 shadow-lg shadow-slate-950/60 backdrop-blur-sm"
		>
			<div class="mb-5 flex flex-wrap items-start justify-between gap-3">
				<div>
					<p class="text-xs font-semibold uppercase tracking-[0.2em] text-sky-200/90">
						User Settings
					</p>
					<h1 class="mt-1 text-2xl font-bold">User Settings</h1>
					<p class="mt-1 text-sm text-slate-300">Manage your profile and account preferences.</p>
				</div>
				<a
					href={resolve(`/u/${data.user_id}#profile`)}
					class="rounded-md border border-sky-300/25 bg-slate-800/80 px-4 py-2 text-sm font-semibold text-slate-100 transition-colors hover:bg-slate-700/90"
				>
					Back to profile
				</a>
			</div>

			<form onsubmit={handleSave} class="grid gap-4">
				<div class="grid gap-1.5">
					<label for="display-name" class="text-sm font-semibold text-slate-200">Display name</label
					>
					<input
						id="display-name"
						type="text"
						maxlength={DISPLAY_NAME_MAX_LENGTH}
						bind:value={displayName}
						class="rounded-md border border-slate-600/70 bg-slate-800/80 px-3 py-2 text-slate-100 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
						placeholder="Your display name..."
					/>
				</div>

				<div class="grid gap-1.5">
					<label for="email" class="text-sm font-semibold text-slate-200">Email</label>
					<input
						id="email"
						type="text"
						value={data.email}
						readonly
						class="rounded-md border border-slate-700/70 bg-slate-900/85 px-3 py-2 text-slate-300"
					/>
				</div>

				<button
					type="submit"
					disabled={saving}
					class="w-fit cursor-pointer rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-sky-900/50 transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
				>
					{saving ? 'Saving...' : 'Save'}
				</button>
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

		{#if isAdmin}
			<section
				class="mt-5 rounded-xl border border-amber-300/25 bg-slate-900/75 p-5 shadow-lg shadow-slate-950/60 backdrop-blur-sm"
			>
				<div class="mb-4">
					<h2 class="text-lg font-semibold text-amber-200">Admin - Account Management</h2>
					<p class="mt-1 text-sm text-slate-300">
						Create users, assign roles (`student`, `ape`, `admin`) and remove accounts.
					</p>
				</div>

				<form onsubmit={handleCreateManagedUser} class="grid gap-3 md:grid-cols-4">
					<input
						type="email"
						class="rounded-md border border-slate-600/70 bg-slate-800/80 px-3 py-2 text-slate-100 placeholder:text-slate-400 focus:border-amber-400 focus:outline-none"
						placeholder="Email"
						bind:value={newManagedUserEmail}
						disabled={creatingManagedUser}
						required
					/>
					<input
						type="text"
						class="rounded-md border border-slate-600/70 bg-slate-800/80 px-3 py-2 text-slate-100 placeholder:text-slate-400 focus:border-amber-400 focus:outline-none"
						placeholder="Display name (optional)"
						bind:value={newManagedUserName}
						disabled={creatingManagedUser}
					/>
					<select
						class="rounded-md border border-slate-600/70 bg-slate-800/80 px-3 py-2 text-slate-100 focus:border-amber-400 focus:outline-none"
						bind:value={newManagedUserRole}
						disabled={creatingManagedUser}
					>
						<option value="student">Student</option>
						<option value="ape">APE</option>
						<option value="admin">Admin</option>
					</select>
					<button
						type="submit"
						class="cursor-pointer rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-amber-900/50 transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
						disabled={creatingManagedUser}
					>
						{creatingManagedUser ? 'Creating...' : 'Create account'}
					</button>
				</form>

				{#if adminSuccessMessage}
					<p
						class="mt-3 rounded-md border border-emerald-300/30 bg-emerald-500/15 px-3 py-2 text-sm text-emerald-100"
					>
						{adminSuccessMessage}
					</p>
				{/if}

				{#if adminErrorMessage}
					<p
						class="mt-3 rounded-md border border-rose-300/30 bg-rose-500/15 px-3 py-2 text-sm text-rose-100"
					>
						{adminErrorMessage}
					</p>
				{/if}

				<div class="mt-5 overflow-x-auto">
					<table class="min-w-full divide-y divide-slate-700 text-sm">
						<thead>
							<tr class="text-left text-slate-300">
								<th class="px-2 py-2 font-semibold">User</th>
								<th class="px-2 py-2 font-semibold">Email</th>
								<th class="px-2 py-2 font-semibold">Role</th>
								<th class="px-2 py-2 font-semibold">Actions</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-slate-800/80">
							{#if loadingManagedUsers}
								<tr>
									<td class="px-2 py-3 text-slate-300" colspan="4">Loading users...</td>
								</tr>
							{:else if managedUsers.length === 0}
								<tr>
									<td class="px-2 py-3 text-slate-300" colspan="4">No users found.</td>
								</tr>
							{:else}
								{#each managedUsers as user (user.uuid)}
									<tr>
										<td class="px-2 py-3 text-slate-100">
											{user.username}
											{#if user.uuid === data.user_id}
												<span
													class="ml-2 rounded-md bg-slate-700/90 px-2 py-0.5 text-xs text-slate-300"
													>You</span
												>
											{/if}
										</td>
										<td class="px-2 py-3 text-slate-300">{user.email}</td>
										<td class="px-2 py-3">
											<select
												class="rounded-md border border-slate-600/70 bg-slate-800/80 px-2 py-1 text-slate-100 focus:border-amber-400 focus:outline-none"
												value={user.role}
												disabled={updatingManagedUserId === user.uuid}
												onchange={(event) =>
													handleManagedUserRoleChange(
														user,
														(event.currentTarget as HTMLSelectElement).value as UserRole
													)}
											>
												<option value="student">student</option>
												<option value="ape">ape</option>
												<option value="admin">admin</option>
											</select>
										</td>
										<td class="px-2 py-3">
											<button
												type="button"
												class="cursor-pointer rounded-md border border-rose-300/40 bg-rose-500/20 px-3 py-1.5 font-semibold text-rose-100 transition-colors hover:bg-rose-500/35 disabled:cursor-not-allowed disabled:opacity-60"
												disabled={updatingManagedUserId === user.uuid}
												onclick={() => handleDeleteManagedUser(user)}
											>
												{updatingManagedUserId === user.uuid ? 'Working...' : 'Delete'}
											</button>
										</td>
									</tr>
								{/each}
							{/if}
						</tbody>
					</table>
				</div>
			</section>
		{/if}

		<section
			class="mt-5 rounded-xl border border-rose-300/25 bg-slate-900/75 p-5 shadow-lg shadow-slate-950/60 backdrop-blur-sm"
		>
			<h2 class="text-lg font-semibold text-rose-200">Danger zone</h2>
			<p class="mt-1 text-sm text-slate-300">
				Delete your account and all boards you own. This action is irreversible.
			</p>
			<button
				type="button"
				class="mt-4 cursor-pointer rounded-md border border-rose-300/40 bg-rose-500/20 px-4 py-2 text-sm font-semibold text-rose-100 transition-colors hover:bg-rose-500/35 disabled:cursor-not-allowed disabled:opacity-60"
				disabled={deleting}
				onclick={handleDeleteAccount}
			>
				{deleting ? 'Deleting...' : 'Delete account'}
			</button>
		</section>
	</main>
{:else}
	<p class="p-4 text-slate-300">Loading...</p>
{/if}
