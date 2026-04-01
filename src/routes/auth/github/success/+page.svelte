<script lang="ts">
	import { browser } from '$app/environment';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';

	onMount(() => {
		if (!browser) return;

		const search = new URL(window.location.href).searchParams;
		const id = search.get('id');
		const email = search.get('email') ?? '';
		const name = search.get('name') ?? '';

		if (!id) {
			const loginUrl = new URL(resolve('/login'), window.location.origin);
			loginUrl.searchParams.set('error', 'github_user');
			window.location.assign(`${loginUrl.pathname}${loginUrl.search}`);
			return;
		}

		const user = { id, email, name };

		localStorage.setItem('user', JSON.stringify(user));
		localStorage.setItem('authToken', 'github-' + Date.now());

		window.location.assign(`${resolve(`/u/${id}`)}#profile`);
	});
</script>

<p class="p-4 text-slate-200">Connexion GitHub en cours...</p>
