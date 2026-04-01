<script lang="ts">
	import '../app.css';
	import TopBar from './top_bar.svelte';
	import Monitor from '$lib/assets/illustrations/monitor.png';
</script>

<TopBar login={false} />
<div id="content" class="items-center justify-start z-0">
	<div
		id="welcome-section"
		class="flex h-[calc(100vh-7.5rem)] w-screen flex-row items-center justify-center overflow-hidden bg-transparent text-center text-slate-100"
	>
		<h1 class="z-1 w-[50%] select-none text-center text-5xl font-bold tracking-wide text-slate-100">
			Welcome to EpiTrello !
		</h1>
		<img
			id="welcome-image"
			src={Monitor}
			alt="Welcome Illustration"
			class="z-0 w-[60%] drop-shadow-[0_20px_45px_rgba(2,132,199,0.35)]"
		/>
	</div>
	<div
		id="footer"
		class="sticky bottom-0 z-20 w-full select-none overflow-visible border-t border-sky-300/20 bg-slate-900/85 p-4 text-center text-slate-100 backdrop-blur-sm"
	>
		<p>&copy; 2025 Epitrello. All rights reserved.</p>
	</div>
</div>
