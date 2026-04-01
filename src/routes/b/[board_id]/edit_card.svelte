<div id="card-editor" class="absolute left-0 top-16 h-[calc(100vh-4rem)] w-screen bg-slate-950/70">
	<div
		class="absolute left-1/2 top-1/2 w-1/3 -translate-x-1/2 -translate-y-1/2 select-none rounded-xl border border-sky-300/25 bg-slate-900/95 p-8 text-slate-100 shadow-lg shadow-slate-950/70"
	>
		<button
			class="absolute right-4 top-4 h-8 w-8 cursor-pointer rounded-full border border-slate-500/70 bg-slate-800/90 text-slate-300 shadow-sm shadow-slate-950/60 transition-all hover:border-sky-300/70 hover:bg-sky-500/20 hover:text-slate-100"
			onclick={() => (window.location.hash = '')}>X</button
		>
		<h2 class="mb-4 text-2xl font-bold">Edit Card</h2>
		<form id="edit-card-form" class="flex flex-col gap-4">
			<div class="flex flex-col">
				<label for="card-title" class="mb-2">Title:</label>
				<input
					type="text"
					id="card-title"
					name="card-title"
					class="rounded-md border border-slate-600 bg-slate-800/80 p-2 text-slate-100 shadow-sm shadow-slate-950/40 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
					required
				/>
			</div>
			<div class="flex flex-col">
				<label for="card-description" class="mb-2">Description:</label>
				<textarea
					id="card-description"
					name="card-description"
					class="rounded-md border border-slate-600 bg-slate-800/80 p-2 text-slate-100 shadow-sm shadow-slate-950/40 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
					rows="4"
				></textarea>
			</div>
			<button
				type="submit"
				class="mt-4 cursor-pointer rounded-md bg-sky-600 px-4 py-2 text-white shadow-md shadow-sky-900/50 transition-all hover:bg-sky-500"
				>Save Changes</button
			>
		</form>
	</div>
</div>
