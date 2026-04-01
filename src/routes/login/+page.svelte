<script lang="ts">
	import Epitrellologo from '$lib/assets/logos/epitrello-logo.png';
	import GithubLogo from '$lib/assets/logos/github.svg';
	import MicrosoftLogo from '$lib/assets/logos/microsoft.png';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import TopBar from '../top_bar.svelte';

	let email = '';
	let password = '';
	let error = '';
	let loading = false;

	let checking = true;

	onMount(async () => {
		if (!browser) return;

		const raw = localStorage.getItem('user');
		if (!raw) {
			checking = false;
			return;
		}

		let user: { id?: string } | null = null;

		try {
			user = JSON.parse(raw);
		} catch (e) {
			console.error('user invalide dans localStorage', e);
			localStorage.removeItem('user');
			localStorage.removeItem('authToken');
			checking = false;
			return;
		}

		if (!user?.id) {
			localStorage.removeItem('user');
			localStorage.removeItem('authToken');
			checking = false;
			return;
		}

		try {
			const res = await fetch(`/u/${user.id}`);
			if (!res.ok) {
				console.warn('Profil utilisateur invalide, on nettoie localStorage');
				localStorage.removeItem('user');
				localStorage.removeItem('authToken');
				checking = false;
				return;
			}
		} catch (e) {
			console.warn('Erreur lors de la vérification du profil', e);
			localStorage.removeItem('user');
			localStorage.removeItem('authToken');
			checking = false;
			return;
		}

		await goto(resolve(`/u/${user.id}#profile`));
	});

	async function handleSubmit() {
		error = '';
		loading = true;

		try {
			if (!email || !password) {
				throw new Error('Email et mot de passe requis.');
			}

			const res = await fetch('/api/login', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ email })
			});

			if (!res.ok) {
				const errData = await res.json().catch(() => ({}));
				throw new Error(errData.error ?? 'Erreur de connexion');
			}

			const user = await res.json();

			if (browser) {
				localStorage.setItem('authToken', 'dummy-token-' + Date.now());
				localStorage.setItem('user', JSON.stringify(user));
			}

			await goto(resolve(`/u/${user.id}#profile`));
		} catch (err: unknown) {
			error = err instanceof Error ? err.message : 'Erreur de connexion.';
		} finally {
			loading = false;
		}
	}
</script>

<TopBar login={true} />

{#if checking}
	<div class="flex h-[calc(100vh-4rem)] select-none items-center justify-center bg-transparent p-8">
		<p class="text-slate-300">Vérification de la session...</p>
	</div>
{:else}
	<div
		id="login-content"
		class="flex h-[calc(100vh-4rem)] select-none items-center justify-center bg-transparent p-8"
	>
		<div
			id="login-form-container"
			class="flex max-h-[calc(100vh-6rem)] w-full max-w-md flex-col items-center gap-2 rounded-xl border border-sky-300/25 bg-slate-900/80 p-8 text-slate-100 shadow-lg shadow-slate-950/60 backdrop-blur-sm"
		>
			<img
				id="epitrello-logo"
				src={Epitrellologo}
				alt="Epitrello Logo"
				class="w-12 m-4 scale-120"
			/>
			<h2 class="m-2 text-center text-2xl font-bold tracking-wide text-slate-100">
				Login to EpiTrello
			</h2>

			{#if error}
				<div
					class="mb-4 rounded-md border border-rose-300/40 bg-rose-500/20 px-3 py-2 text-sm text-rose-100"
				>
					{error}
				</div>
			{/if}

			<form class="flex flex-col gap-6 w-[80%] m-4" on:submit|preventDefault={handleSubmit}>
				<div class="flex flex-col">
					<input
						type="email"
						id="email"
						name="email"
						class="rounded-md border border-slate-600 bg-slate-800/80 p-2 text-slate-100 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
						placeholder="Email"
						required
						bind:value={email}
					/>
				</div>

				<div class="flex flex-col">
					<input
						type="password"
						id="password"
						name="password"
						class="rounded-md border border-slate-600 bg-slate-800/80 p-2 text-slate-100 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
						placeholder="Password"
						required
						bind:value={password}
					/>
				</div>

				<button
					type="submit"
					class="cursor-pointer rounded-md bg-sky-600 px-4 py-2 text-white shadow-md shadow-sky-900/50 transition-all hover:bg-sky-500 disabled:opacity-60"
					disabled={loading}
				>
					{#if loading}
						Connecting...
					{:else}
						Login
					{/if}
				</button>
			</form>
			<div class="w-[80%] border-t border-slate-600/60 pt-4 text-center">
				<p class="mb-2 text-sm text-slate-300">Or continue with</p>
				<a
					href={resolve('/auth/github')}
					data-sveltekit-preload-data="off"
					class="mb-2 inline-flex w-64 items-center justify-center gap-4 rounded-md border border-slate-500/60 bg-slate-800 px-4 py-2 font-medium text-slate-100 shadow-sm shadow-slate-950/60 transition-all hover:bg-slate-700"
				>
					<img src={GithubLogo} alt="GitHub Logo" class="w-6 invert" />
					<p>Login with GitHub</p>
				</a>
				<a
					href={resolve('/auth/microsoft')}
					data-sveltekit-preload-data="off"
					class="inline-flex w-64 items-center justify-center gap-4 rounded-md border border-sky-300/25 bg-sky-900/35 px-4 py-2 font-medium text-slate-100 shadow-sm shadow-sky-950/60 transition-all hover:bg-sky-800/50"
				>
					<img src={MicrosoftLogo} alt="Microsoft Logo" class="w-6" />
					<p>Login with Microsoft</p>
				</a>
			</div>
		</div>
	</div>
{/if}
