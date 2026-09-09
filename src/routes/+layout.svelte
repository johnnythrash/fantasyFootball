<script lang="ts">
	import { page } from '$app/state';
	import '../app.css';
	let { children } = $props();
	const isActive = (href: string) => page.url.pathname.startsWith(href);
</script>

<div class="flex min-h-screen flex-col bg-[#070b12] text-slate-100">
	<nav class="border-b border-slate-800 bg-[#0b111b] shadow-sm">
		<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
			<div class="flex h-16 items-center justify-between">
				<a href="/" class="text-xl font-bold text-white">DraftSync Local</a>
				<ul class="flex items-center gap-6">
					<li><a href="/leagues" class:text-emerald-400={isActive('/leagues')} class="text-slate-300 hover:text-white">Leagues</a></li>
					<li><a href="/import" class:text-emerald-400={isActive('/import')} class="text-slate-300 hover:text-white">Import</a></li>
					<li><a href="/draft" class:text-emerald-400={page.url.pathname === '/draft'} class="text-slate-300 hover:text-white">Live Draft</a></li>
					<li><a href="/draft/history" class:text-emerald-400={isActive('/draft/history')} class="text-slate-300 hover:text-white">Draft History</a></li>
				</ul>
			</div>
		</div>
	</nav>
	<main class="flex-1"><div class="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{@render children()}</div></main>
</div>
