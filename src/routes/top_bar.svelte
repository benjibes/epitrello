<script lang="ts">
	import epitrello_logo from '$lib/assets/logos/epitrello-logo.png';
	import { resolve } from '$app/paths';
	export let login: boolean;
</script>

<div
	id="top-bar"
	class="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-sky-300/20 bg-slate-900/85 p-4 text-slate-100 shadow-lg shadow-slate-950/50 backdrop-blur-sm"
>
	<a href={resolve('/')} class="flex flex-row items-center hover:cursor-pointer">
		<img id="epitrello-logo" src={epitrello_logo} alt="Epitrello Logo" class="w-12" />
		<h1 id="title" class="ml-2 select-none text-xl font-semibold tracking-wide">EpiTrello</h1>
	</a>
	{#if login === false}
		<a
			id="login"
			href={resolve('/login')}
			class="ml-auto select-none rounded-md border border-sky-300/25 bg-sky-600/85 px-4 py-2 text-sm font-semibold text-slate-50 shadow-sm shadow-sky-900/60 transition-all hover:bg-sky-500 hover:shadow-md hover:shadow-sky-900/70"
			>Login</a
		>
	{/if}
</div>
