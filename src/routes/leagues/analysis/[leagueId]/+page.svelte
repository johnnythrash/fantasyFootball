<script lang="ts">
	import type { PageData } from './$types';
	import { invalidateAll } from '$app/navigation';
	let { data }: { data: PageData } = $props();
	let refreshing = $state(false);
	let refreshMessage = $state('');
	const isSleeper = $derived(data.league.platform === 'SLEEPER');
	async function refreshLeague() {
		if (isSleeper) return;
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

<main class="min-h-screen bg-[#f6f7f9] px-4 py-8 text-slate-950 sm:px-8">
	<div class="mx-auto max-w-7xl">
		<header class="border-b border-slate-300 pb-7">
			<div class="flex flex-wrap items-start justify-between gap-5">
				<div>
					<div class="mb-3 flex items-center gap-3"><span class="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-black uppercase tracking-wider text-white" class:bg-[#14a76c]={isSleeper} class:bg-[#1d4ed8]={!isSleeper}><span class="h-2 w-2 rounded-full bg-white"></span>{isSleeper ? 'Sleeper' : 'ESPN'}</span><span class="text-sm font-semibold text-slate-500">Week {data.scoringPeriod} · {data.league.seasonYear}</span></div>
					<h1 class="text-4xl font-black tracking-tight">{data.league.name}</h1><p class="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{data.methodology}</p>
				</div>
				<div class="flex items-center gap-3">{#if !isSleeper}<button type="button" onclick={refreshLeague} disabled={refreshing} class="rounded-lg bg-blue-700 px-4 py-2.5 font-bold text-white hover:bg-blue-800 disabled:opacity-50">{refreshing ? 'Refreshing…' : 'Refresh ESPN data'}</button>{/if}<a href="/leagues" class="font-bold text-slate-600 underline decoration-slate-300 underline-offset-4 hover:text-slate-950">All leagues</a></div>
			</div>
			{#if refreshMessage}<p class="mt-4 border-l-4 border-blue-600 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-900">{refreshMessage}</p>{/if}
		</header>

		{#if isSleeper}<div class="mt-6 border-l-4 border-amber-500 bg-amber-50 px-5 py-4 text-sm leading-6 text-amber-950"><strong>Sleeper lineup data is live.</strong> Submitted starters, roster slots, and injuries are current. Close calls currently use consensus value while weekly projections and matchup adjustments are being connected.</div>{/if}

		{#if data.user}<section class="grid gap-8 border-b border-slate-300 py-8 lg:grid-cols-[230px_1fr]">
			<div><p class="text-xs font-black uppercase tracking-widest text-slate-500">Your power rank</p><p class="mt-1 text-6xl font-black">#{data.user.powerRank}<span class="ml-2 text-lg font-semibold text-slate-400">/ {data.league.teamCount}</span></p>{#if data.user.weeklyTotal > 0}<p class="mt-2 font-semibold text-slate-600">{data.user.weeklyTotal} projected points</p>{/if}</div>
			<div><h2 class="text-sm font-black uppercase tracking-widest text-slate-500">Position profile</h2><div class="mt-4 grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-4">{#each data.positionComparison as item}<div><div class="flex items-baseline justify-between border-b border-slate-300 pb-2"><span class="font-black">{item.position}</span><span class="text-2xl font-black" class:text-emerald-700={item.delta >= 0} class:text-rose-700={item.delta < 0}>{item.delta >= 0 ? '+' : ''}{item.delta}</span></div><p class="mt-1 text-xs text-slate-500">versus league average</p></div>{/each}</div></div>
		</section>{/if}

		<section class="border-b border-slate-300 py-8">
			<div class="mb-5 flex flex-wrap items-end justify-between gap-2"><div><p class="text-xs font-black uppercase tracking-widest text-slate-500">Lineup check</p><h2 class="mt-1 text-3xl font-black">Week {data.scoringPeriod} start/sit</h2></div><p class="max-w-xl text-right text-sm text-slate-500">{isSleeper ? 'Your exact Sleeper slots: submitted lineup versus the best eligible roster combination.' : 'ESPN weekly projections under your league scoring.'}</p></div>
			{#if data.startSit.start.length || data.startSit.sit.length}<div class="grid overflow-hidden rounded-xl border border-slate-300 bg-white md:grid-cols-2"><div class="border-b border-slate-200 p-6 md:border-r md:border-b-0"><p class="text-xs font-black uppercase tracking-widest text-emerald-700">Start these players</p>{#each data.startSit.start as player}<div class="mt-4"><p class="text-xl font-black">{player.name}</p><p class="text-sm text-slate-500">{player.position}{player.weeklyProjected != null ? ` · ${player.weeklyProjected} projected points` : ''}</p></div>{/each}</div><div class="p-6"><p class="text-xs font-black uppercase tracking-widest text-rose-700">Move to bench</p>{#each data.startSit.sit as player}<div class="mt-4"><p class="text-xl font-black">{player.name}</p><p class="text-sm text-slate-500">{player.position}{player.weeklyProjected != null ? ` · ${player.weeklyProjected} projected points` : ''}</p></div>{/each}</div></div>{:else}<div class="border-l-4 border-emerald-600 bg-emerald-50 px-5 py-4"><p class="text-lg font-black text-emerald-950">Your submitted {isSleeper ? 'Sleeper' : 'ESPN'} lineup matches the optimizer.</p><p class="mt-1 text-sm text-emerald-900">No lineup changes are recommended right now.</p></div>{/if}
			<div class="mt-6 overflow-x-auto"><table class="w-full text-left"><thead class="border-b-2 border-slate-900 text-xs uppercase tracking-wider text-slate-500"><tr><th class="py-3">Position</th><th class="py-3">Player</th><th class="py-3">Team</th><th class="py-3">Projection</th><th class="py-3">Status</th></tr></thead><tbody>{#each data.user?.starters ?? [] as player}<tr class="border-b border-slate-200"><td class="py-3 font-black">{player.position}</td><td class="py-3 font-bold">{player.name}</td><td class="py-3 text-slate-500">{player.nflTeam ?? '—'}</td><td class="py-3 text-slate-500">{player.weeklyProjected != null ? `${player.weeklyProjected} pts` : '—'}</td><td class="py-3"><span class:font-bold={player.injuryStatus && !['NA', 'ACTIVE'].includes(String(player.injuryStatus).toUpperCase())} class:text-amber-700={player.injuryStatus && !['NA', 'ACTIVE'].includes(String(player.injuryStatus).toUpperCase())}>{player.injuryStatus && player.injuryStatus !== 'ACTIVE' ? player.injuryStatus : 'Available'}</span></td></tr>{/each}</tbody></table></div>
		</section>

		<section class="border-b border-slate-300 py-8"><p class="text-xs font-black uppercase tracking-widest text-slate-500">League comparison</p><h2 class="mt-1 text-3xl font-black">Power rankings</h2><div class="mt-5 overflow-x-auto"><table class="w-full text-left"><thead class="border-b-2 border-slate-900 text-xs uppercase tracking-wider text-slate-500"><tr><th class="py-3">Rank</th><th class="py-3">Team</th><th class="py-3">Model</th><th class="py-3">Projected core</th></tr></thead><tbody>{#each data.powerRankings as team}<tr class="border-b border-slate-200" class:bg-emerald-50={team.is_user && isSleeper} class:bg-blue-50={team.is_user && !isSleeper}><td class="py-3 text-xl font-black">#{team.powerRank}</td><td class="py-3"><span class="font-bold">{team.team_name}</span>{#if team.is_user}<span class="ml-2 text-xs font-black uppercase text-slate-500">You</span>{/if}</td><td class="py-3 font-semibold">{team.weeklyTotal > 0 ? `${team.weeklyTotal} pts` : 'Rank model'}</td><td class="py-3 text-sm text-slate-600">{team.starters.slice(0, 5).map((player) => player.name).join(' · ')}</td></tr>{/each}</tbody></table></div></section>

		<section class="py-8"><p class="text-xs font-black uppercase tracking-widest text-slate-500">Roster market</p><h2 class="mt-1 text-3xl font-black">Trade-fit watchlist</h2><p class="mt-2 text-sm text-slate-500">Potential roster fits only—not clickable offers and not a fairness recommendation.</p>{#if data.tradeTargets.length}<div class="mt-5 grid gap-x-10 gap-y-5 md:grid-cols-2">{#each data.tradeTargets as player}<article class="border-t border-slate-300 pt-4"><div class="flex items-baseline justify-between gap-3"><h3 class="text-lg font-black">{player.name}</h3><span class="text-sm font-bold text-slate-500">{player.position} · {player.nflTeam}</span></div><p class="mt-1 text-sm text-slate-600">{player.fromTeam} · ECR {player.rank ?? '—'}</p><p class="mt-2 text-xs leading-5 text-slate-500">{player.reason}</p></article>{/each}</div>{:else}<p class="mt-5 text-slate-600">No clear surplus-for-need matches yet.</p>{/if}</section>
	</div>
</main>
