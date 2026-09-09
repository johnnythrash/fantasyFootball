import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getDatabase } from '$lib/server/db/database';
import { getLeague, getLeaguePicks, getLeagueTeams } from '$lib/server/db/repositories';
import { getNFLTeamName, getPositionName } from '$lib/server/draft/utils';

const starterNeeds: Record<string, number> = { QB: 1, RB: 2, WR: 2, TE: 1, DST: 1, K: 1 };
const tradeDepth: Record<string, number> = { QB: 1, RB: 3, WR: 3, TE: 1 };

export const load = (async ({ params }) => {
	const league = getLeague(params.leagueId);
	if (!league) throw error(404, 'League not found');
	const teams = getLeagueTeams(params.leagueId);
	const picks = getLeaguePicks(params.leagueId);
	const scoringPeriod = Number(league.settings?.scoring_period_id ?? league.settings?.espn_status?.currentMatchupPeriod) || 1;
	const db = getDatabase();
	const value = db.prepare(`SELECT p.id,p.espn_id,p.full_name,p.position,p.nfl_team,p.bye_week,
		v.overall_rank,v.position_rank,s.injury_status FROM players p
		LEFT JOIN player_values v ON v.player_id=p.id AND v.season_year=? AND v.scoring_format='PPR' AND v.source='fantasypros-ecr-via-dynastyprocess'
		LEFT JOIN player_status s ON s.player_id=p.id WHERE p.espn_id=?`);
	const sleeperValue = db.prepare(`SELECT p.id,p.sleeper_id,p.full_name,p.position,p.nfl_team,p.bye_week,
		v.overall_rank,v.position_rank,s.injury_status FROM players p
		LEFT JOIN player_values v ON v.player_id=p.id AND v.season_year=? AND v.scoring_format='PPR' AND v.source='fantasypros-ecr-via-dynastyprocess'
		LEFT JOIN player_status s ON s.player_id=p.id WHERE p.sleeper_id=?`);
	const rosters = teams.map((team) => {
		const liveEntries = Array.isArray(team.data?.roster_entries) ? team.data.roster_entries : [];
		const draftedPlayers = picks.filter((pick) => String(pick.team_id) === String(team.espn_team_id)).map((pick) => {
			const row = value.get(league.season_year, String(pick.espn_player_id ?? '')) as any;
			return { id: row?.id ?? null, espnId: pick.espn_player_id, name: row?.full_name ?? pick.player_name,
				position: row?.position ?? pick.player_position, nflTeam: row?.nfl_team ?? pick.player_nfl_team,
				byeWeek: row?.bye_week ?? null, rank: Number(row?.overall_rank) || null,
				positionRank: Number(row?.position_rank) || null, injuryStatus: row?.injury_status ?? null,
				pickNumber: pick.pick_number, round: pick.round_number, lineupSlotId: null, weeklyProjected: null, seasonProjected: null };
		});
		const livePlayers = liveEntries.map((entry: any) => {
			if (league.platform === 'SLEEPER') {
				const playerId = String(entry.playerId ?? '');
				const row = sleeperValue.get(league.season_year, playerId) as any;
				if (!row?.full_name) return null;
				return { id: row.id, sleeperId: playerId, espnId: `sleeper:${playerId}`, name: row.full_name,
					position: row.position, nflTeam: row.nfl_team, byeWeek: row.bye_week ?? null,
					rank: Number(row.overall_rank) || null, positionRank: Number(row.position_rank) || null,
					injuryStatus: row.injury_status ?? null, pickNumber: null, round: null,
					lineupSlotId: entry.isStarter ? 0 : entry.isReserve ? 21 : 20,
					weeklyProjected: null, seasonProjected: null };
			}
			const espnPlayer = entry?.player;
			if (!espnPlayer?.id || !espnPlayer.fullName) return null;
			const row = value.get(league.season_year, String(espnPlayer.id)) as any;
			const stats = Array.isArray(espnPlayer.stats) ? espnPlayer.stats : [];
			const weekly = stats.find((stat: any) => Number(stat.scoringPeriodId) === scoringPeriod && Number(stat.statSourceId) === 1);
			const season = stats.find((stat: any) => Number(stat.scoringPeriodId) === 0 && Number(stat.statSourceId) === 1 && Number(stat.externalId) === Number(league.season_year));
			return { id: row?.id ?? null, espnId: String(espnPlayer.id), name: espnPlayer.fullName,
				position: getPositionName(Number(espnPlayer.defaultPositionId)), nflTeam: getNFLTeamName(Number(espnPlayer.proTeamId)),
				byeWeek: row?.bye_week ?? null, rank: Number(row?.overall_rank) || null, positionRank: Number(row?.position_rank) || null,
				injuryStatus: espnPlayer.injuryStatus ?? row?.injury_status ?? null, pickNumber: null, round: null,
				lineupSlotId: Number(entry.lineupSlotId), weeklyProjected: finite(weekly?.appliedTotal), seasonProjected: finite(season?.appliedTotal) };
		}).filter(Boolean);
		const players = (livePlayers.length ? livePlayers : draftedPlayers).filter((player: any) => player.name && player.name !== 'Unknown Player');
		const { starters, bench } = chooseStarters(players);
		const weeklyTotal = starters.reduce((sum, player) => sum + Number(player.weeklyProjected ?? 0), 0);
		const starterValue = starters.reduce((sum, player) => sum + playerValue(player) * 1.25, 0);
		const depthValue = bench.slice().sort(byRank).slice(0, 5).reduce((sum, player) => sum + playerValue(player) * 0.35, 0);
		return { ...team, players, starters, bench, counts: countPositions(players), weeklyTotal: round(weeklyTotal),
			currentStarters: players.filter((player: any) => ![20, 21].includes(Number(player.lineupSlotId))), rawScore: weeklyTotal > 0 ? weeklyTotal * 10 + depthValue : starterValue + depthValue };
	});
	const maxScore = Math.max(1, ...rosters.map((team) => team.rawScore));
	const minScore = Math.min(...rosters.map((team) => team.rawScore));
	const powerRankings = rosters.map((team) => ({ ...team, score: round(70 + 30 * (team.rawScore - minScore) / Math.max(1, maxScore - minScore)) }))
		.sort((a, b) => b.rawScore - a.rawScore).map((team, index) => ({ ...team, powerRank: index + 1 }));
	const user = powerRankings.find((team) => team.is_user) ?? null;
	const positionComparison = ['QB', 'RB', 'WR', 'TE'].map((position) => {
		const leagueAverage = average(powerRankings.map((team) => positionStrength(team.players, position)));
		const userStrength = positionStrength(user?.players ?? [], position);
		return { position, userStrength: round(userStrength), leagueAverage: round(leagueAverage), delta: round(userStrength - leagueAverage) };
	});
	const needs = positionComparison.filter((item) => item.delta < 0).sort((a, b) => a.delta - b.delta).map((item) => item.position);
	const tradeTargets = powerRankings.filter((team) => !team.is_user).flatMap((team) => team.players
		.filter((player: any) => needs.includes(player.position) && Number(team.counts[player.position] ?? 0) > Number(tradeDepth[player.position] ?? 99))
		.map((player: any) => ({ ...player, fromTeam: team.team_name, ownerName: team.owner_name,
			reason: `${team.team_name} has ${team.counts[player.position]} ${player.position}s; ${player.position} grades below your league average` })))
		.sort(byRank).slice(0, 12);
	const recommendedIds = new Set((user?.starters ?? []).map((player: any) => player.espnId));
	const currentIds = new Set((user?.currentStarters ?? []).map((player: any) => player.espnId));
	const startSit = {
		start: (user?.starters ?? []).filter((player: any) => !currentIds.has(player.espnId)),
		sit: (user?.currentStarters ?? []).filter((player: any) => !recommendedIds.has(player.espnId))
	};
	return { league: { id: league.id, name: league.name, platform: league.platform, seasonYear: league.season_year, teamCount: league.team_count },
		powerRankings: powerRankings.map(({ rawScore: _raw, ...team }) => team), user, positionComparison, tradeTargets, startSit, scoringPeriod,
		methodology: user?.players.some((player: any) => player.weeklyProjected != null)
			? `Live ESPN rosters and Week ${scoringPeriod} projections under your league scoring, with current injuries and consensus depth.`
			: `${league.platform === 'SLEEPER' ? 'Live Sleeper rosters' : 'Draft-value baseline'} using current consensus rank, current injuries, likely starters, and shallow bench depth; weekly point projections are not yet available for this league.` };
}) satisfies PageServerLoad;

function chooseStarters(players: any[]) {
	const remaining = players.slice().sort(byWeeklyThenRank);
	const starters: any[] = [];
	for (const [position, needed] of Object.entries(starterNeeds)) for (let count = 0; count < needed; count++) {
		const index = remaining.findIndex((player) => player.position === position);
		if (index >= 0) starters.push(remaining.splice(index, 1)[0]);
	}
	const flex = remaining.findIndex((player) => ['RB', 'WR', 'TE'].includes(player.position));
	if (flex >= 0) starters.push(remaining.splice(flex, 1)[0]);
	return { starters: starters.sort((a, b) => String(a.position).localeCompare(String(b.position)) || byRank(a, b)), bench: remaining };
}
function countPositions(players: any[]) { return players.reduce((counts, player) => ({ ...counts, [player.position]: (counts[player.position] ?? 0) + 1 }), {} as Record<string, number>); }
function playerValue(player: any) { return Math.max(0, 220 - Number(player.rank ?? player.pickNumber ?? 220)) - (player.injuryStatus && !['NA', 'ACTIVE'].includes(String(player.injuryStatus).toUpperCase()) ? 8 : 0); }
function positionStrength(players: any[], position: string) { return players.filter((player) => player.position === position).sort(byRank).slice(0, tradeDepth[position] ?? 1).reduce((sum, player) => sum + playerValue(player), 0); }
function byRank(a: any, b: any) { return Number(a.rank ?? a.pickNumber ?? 999) - Number(b.rank ?? b.pickNumber ?? 999); }
function byWeeklyThenRank(a: any, b: any) {
	const aPoints = finite(a.weeklyProjected); const bPoints = finite(b.weeklyProjected);
	if (aPoints != null || bPoints != null) return Number(bPoints ?? -1) - Number(aPoints ?? -1);
	return byRank(a, b);
}
function finite(value: unknown) { return value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value); }
function average(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function round(value: number) { return Math.round(value * 10) / 10; }
