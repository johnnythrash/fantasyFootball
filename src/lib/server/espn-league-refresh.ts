import { getLeague, saveLeague } from '$lib/server/db/repositories';
import { espn } from '$lib/server/providers/espn';
import { getDatabase } from '$lib/server/db/database';
import { randomUUID } from 'node:crypto';

export async function refreshImportedEspnLeague(localLeagueId: string) {
	const existing: any = getLeague(localLeagueId);
	if (!existing || existing.platform !== 'ESPN') throw new Error('ESPN league not found');
	if (!existing.auth?.espn_s2 || !existing.auth?.swid) throw new Error('Stored ESPN credentials are unavailable; import the league again');
	const fetched: any = await espn.fetchSeason({ leagueId: String(existing.external_id), season: Number(existing.season_year), auth: existing.auth });
	const teamCount = Number(fetched.league.team_count ?? fetched.teams.length);
	const id = saveLeague({
		id: existing.id, platform: 'ESPN', externalId: String(existing.external_id), seasonYear: Number(existing.season_year),
		name: fetched.league.name, teamCount, draftType: fetched.league.draft_type,
		draftStarted: fetched.league.draft_started, draftCompleted: fetched.league.draft_completed,
		userTeamId: String(fetched.userTeamId), auth: existing.auth, settings: fetched.league.settings
	}, fetched.teams.map((team: any) => ({
		platformTeamId: String(team.espn_team_id), name: team.team_name, ownerName: team.owner_name,
		draftPosition: team.draft_position, isUser: String(team.espn_team_id) === String(fetched.userTeamId), data: team
	})), fetched.picks.map((pick: any, index: number) => ({
		pickNumber: Number(pick.pick_number ?? index + 1), roundNumber: Number(pick.round_number),
		roundPick: Number(pick.pick_in_round ?? ((index % teamCount) + 1)), teamId: String(pick.team_id ?? ''),
		platformPlayerId: String(pick.espn_player_id ?? ''), playerName: pick.player_name,
		position: pick.player_position, nflTeam: pick.player_nfl_team, data: pick.player_data
	})));
	const week = Number(fetched.league.settings?.scoring_period_id ?? 1);
	const projectionPool = await fetchWeeklyProjectionPool(String(existing.external_id), Number(existing.season_year), week, existing.auth);
	persistWeeklyProjections(fetched.teams, projectionPool, Number(existing.season_year), week, id);
	return { id, name: fetched.league.name, teams: fetched.teams.length, picks: fetched.picks.length,
		rosterPlayers: fetched.teams.reduce((sum: number, team: any) => sum + Number(team.roster_entries?.length ?? 0), 0),
		projectionPlayers: projectionPool.size, refreshedAt: new Date().toISOString() };
}

async function fetchWeeklyProjectionPool(leagueId: string, seasonYear: number, week: number, auth: { espn_s2: string; swid: string }) {
	const db = getDatabase();
	const ids = (db.prepare(`SELECT espn_id FROM players WHERE active=1 AND espn_id IS NOT NULL AND espn_id<>''
		AND position IN ('QB','RB','WR','TE','K','DST','DEF')`).all() as { espn_id: string }[]).map((row) => row.espn_id);
	const pool = new Map<number, any>();
	for (let offset = 0; offset < ids.length; offset += 200) {
		const filter = JSON.stringify({ players: { filterIds: { value: ids.slice(offset, offset + 200).map(Number).filter(Number.isFinite) } } });
		const response = await fetch(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${seasonYear}/segments/0/leagues/${leagueId}?scoringPeriodId=${week}&view=kona_player_info`, {
			headers: { Cookie: `espn_s2=${auth.espn_s2}; SWID=${auth.swid};`, 'x-fantasy-filter': filter }
		});
		if (!response.ok) throw new Error(`ESPN weekly player pool returned ${response.status}`);
		const payload: any = await response.json();
		for (const entry of payload?.players ?? []) {
			const player = entry?.player ?? entry;
			if (player?.id != null) pool.set(Number(player.id), player);
		}
	}
	return pool;
}

function persistWeeklyProjections(teams: any[], pool: Map<number, any>, seasonYear: number, week: number, leagueId: string) {
	const db = getDatabase();
	const importedAt = new Date().toISOString();
	const setId = randomUUID();
	const players = new Map<string, { playerId: string; points: number; stats: Record<string, number> }>();
	for (const team of teams) for (const entry of team.roster_entries ?? []) {
		const player = entry?.player;
		const projection = player?.stats?.find((stat: any) => Number(stat.scoringPeriodId) === week && Number(stat.statSourceId) === 1);
		if (!player?.id || !projection || !Number.isFinite(Number(projection.appliedTotal))) continue;
		players.set(String(player.id), { playerId: String(player.id), points: Number(projection.appliedTotal), stats: projection.stats ?? {} });
	}
	for (const player of pool.values()) {
		const projection = player?.stats?.find((stat: any) => Number(stat.scoringPeriodId) === week && Number(stat.statSourceId) === 1);
		if (!player?.id || !projection || !Number.isFinite(Number(projection.appliedTotal))) continue;
		players.set(String(player.id), { playerId: String(player.id), points: Number(projection.appliedTotal), stats: projection.stats ?? {} });
	}
	const findPlayer = db.prepare('SELECT id FROM players WHERE espn_id=?');
	const insert = db.prepare('INSERT INTO player_projections(projection_set_id,player_id,projected_points,stats_json) VALUES(?,?,?,?)');
	db.transaction(() => {
		db.prepare(`INSERT INTO projection_sets(id,source,season_year,scoring_basis,published_at,imported_at,methodology_version,metadata_json)
			VALUES(?,?,?,?,?,?,?,?)`).run(setId, 'espn-weekly-proxy', seasonYear, `ESPN_LEAGUE:${leagueId}`, importedAt, importedAt, 'espn-statline-v2', JSON.stringify({ week, leagueId, playerCount: players.size }));
		for (const projection of players.values()) {
			const row = findPlayer.get(projection.playerId) as { id: string } | undefined;
			if (row) insert.run(setId, row.id, projection.points, JSON.stringify({ espnStats: projection.stats, week, espnPlayerId: projection.playerId }));
		}
	})();
}
