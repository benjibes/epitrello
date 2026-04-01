<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	let isLoggedIn = false;
	if (browser) {
		isLoggedIn = !!localStorage.getItem('authToken');
	}

	function handleLogout() {
		if (!browser) return;
		localStorage.removeItem('authToken');
		localStorage.removeItem('user');
		isLoggedIn = false;
		goto(resolve('/login'));
	}
</script>

{#if isLoggedIn}
	<button
		type="button"
		class="cursor-pointer rounded-md border border-sky-300/25 bg-sky-700/85 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-sky-950/60 transition-all hover:bg-sky-600 hover:shadow-md hover:shadow-sky-900/70"
		on:click={handleLogout}
	>
		Logout
	</button>
{/if}
