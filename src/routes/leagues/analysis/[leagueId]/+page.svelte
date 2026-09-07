<script lang="ts">
	import type { PageData } from './$types';
	import { invalidateAll } from '$app/navigation';
	let { data }: { data: PageData } = $props();
	let refreshing = $state(false);
	let refreshMessage = $state('');
	async function refreshLeague() {
		refreshing = true; refreshMessage = '';
		try {
			const response = await fetch(`/api/espn/leagues/${data.league.id}/refresh`, { method: 'POST' });
			const result = await response.json();
			if (!response.ok) throw new Error(result.message ?? 'ESPN refresh failed');
			refreshMessage = `${result.rosterPlayers} roster players refreshed`;
			await invalidateAll();
		} catch (cause) { refreshMessage = cause instanceof Error ? cause.message : 'ESPN refresh failed'; }
		finally { refreshing = false; }
	}
</script>

<svelte:head><title>{data.league.name} analysis</title></svelte:head>

<main class="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-8">
	<div class="mx-auto max-w-7xl space-y-8">
		<header class="flex flex-wrap items-end justify-between gap-4">
			<div><p class="text-sm font-bold uppercase tracking-widest text-blue-600">{data.league.seasonYear} season hub</p><h1 class="text-4xl font-black">{data.league.name}</h1><p class="mt-2 max-w-3xl text-slate-600">{data.methodology}</p></div>
			<div class="flex items-center gap-3"><button type="button" onclick={refreshLeague} disabled={refreshing} class="rounded-xl bg-blue-600 px-4 py-2 font-bold text-white disabled:opacity-50">{refreshing ? 'Refreshing…' : 'Refresh ESPN'}</button><a href="/leagues" class="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold shadow-sm">Back to leagues</a></div>
		</header>
		{#if refreshMessage}<p class="rounded-xl bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800">{refreshMessage}</p>{/if}

		{#if data.user}
			<section class="grid gap-4 md:grid-cols-3">
				<div class="rounded-2xl bg-slate-950 p-6 text-white"><p class="text-sm uppercase tracking-wider text-slate-300">Your Week {data.scoringPeriod} power rank</p><p class="mt-2 text-5xl font-black">#{data.user.powerRank}</p><p class="mt-2 text-slate-300">of {data.league.teamCount} · {data.user.weeklyTotal} projected points</p></div>
				<div class="rounded-2xl border bg-white p-6 md:col-span-2"><h2 class="text-xl font-black">Position profile</h2><div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{#each data.positionComparison as item}<div class="rounded-xl bg-slate-100 p-4"><p class="font-bold">{item.position}</p><p class="mt-1 text-2xl font-black" class:text-emerald-600={item.delta >= 0} class:text-rose-600={item.delta < 0}>{item.delta >= 0 ? '+' : ''}{item.delta}</p><p class="text-xs text-slate-500">vs league average</p></div>{/each}</div></div>
			</section>
		{/if}

		<section class="rounded-2xl border bg-white p-6 shadow-sm"><h2 class="text-2xl font-black">Week {data.scoringPeriod} power rankings</h2><p class="mt-1 text-sm text-slate-500">Optimized ESPN projected starters, with consensus-ranked bench depth as a secondary signal.</p><div class="mt-5 overflow-x-auto"><table class="w-full text-left"><thead class="border-b text-xs uppercase text-slate-500"><tr><th class="p-3">Rank</th><th class="p-3">Team</th><th class="p-3">Projection</th><th class="p-3">Projected core</th></tr></thead><tbody>{#each data.powerRankings as team}<tr class="border-b last:border-0" class:bg-blue-50={team.is_user}><td class="p-3 text-xl font-black">#{team.powerRank}</td><td class="p-3"><p class="font-bold">{team.team_name}</p>{#if team.is_user}<p class="text-xs font-bold text-blue-600">YOUR TEAM</p>{/if}</td><td class="p-3 font-bold">{team.weeklyTotal} pts</td><td class="p-3 text-sm text-slate-600">{team.starters.slice(0, 5).map((player) => player.name).join(' · ')}</td></tr>{/each}</tbody></table></div></section>

		<div class="grid gap-6 lg:grid-cols-2">
			<section class="rounded-2xl border bg-white p-6 shadow-sm"><h2 class="text-2xl font-black">Week {data.scoringPeriod} start/sit</h2><p class="mt-1 text-sm text-slate-500">Best legal lineup from ESPN’s current weekly projections.</p>{#if data.startSit.start.length || data.startSit.sit.length}<div class="mt-4 grid grid-cols-2 gap-3"><div class="rounded-xl bg-emerald-50 p-4"><p class="font-black text-emerald-800">MOVE IN</p>{#each data.startSit.start as player}<p class="mt-2 font-bold">{player.name} <span class="text-sm font-normal">{player.weeklyProjected ?? '—'} pts</span></p>{/each}</div><div class="rounded-xl bg-rose-50 p-4"><p class="font-black text-rose-800">MOVE OUT</p>{#each data.startSit.sit as player}<p class="mt-2 font-bold">{player.name} <span class="text-sm font-normal">{player.weeklyProjected ?? '—'} pts</span></p>{/each}</div></div>{:else}<p class="mt-4 rounded-xl bg-emerald-50 p-4 font-semibold text-emerald-800">Your current ESPN lineup matches the projection optimizer.</p>{/if}<div class="mt-4 space-y-2">{#each data.user?.starters ?? [] as player}<div class="flex items-center justify-between rounded-xl bg-slate-100 px-4 py-3"><div><span class="mr-3 inline-block w-10 font-black text-blue-600">{player.position}</span><span class="font-bold">{player.name}</span></div><span class="text-sm text-slate-500">{player.weeklyProjected ?? '—'} pts{player.injuryStatus && player.injuryStatus !== 'ACTIVE' ? ` · ${player.injuryStatus}` : ''}</span></div>{/each}</div></section>

			<section class="rounded-2xl border bg-white p-6 shadow-sm"><h2 class="text-2xl font-black">Trade-fit targets</h2><p class="mt-1 text-sm text-slate-500">Potential fits, not proposed fair offers yet. Targets come from your below-average positions and another roster’s depth.</p>{#if data.tradeTargets.length}<div class="mt-4 space-y-3">{#each data.tradeTargets as player}<div class="rounded-xl border p-4"><p class="font-black">{player.name} <span class="text-sm font-semibold text-slate-500">{player.position} · {player.nflTeam}</span></p><p class="text-sm text-slate-600">From {player.fromTeam} · ECR {player.rank ?? '—'}</p><p class="mt-2 text-xs text-slate-500">{player.reason}</p></div>{/each}</div>{:else}<p class="mt-6 rounded-xl bg-slate-100 p-4 text-slate-600">No clear surplus-for-need matches yet.</p>{/if}</section>
		</div>
	</div>
</main>
