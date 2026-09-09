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
	persistWeeklyProjections(fetched.teams, Number(existing.season_year), Number(fetched.league.settings?.scoring_period_id ?? 1), id);
	return { id, name: fetched.league.name, teams: fetched.teams.length, picks: fetched.picks.length,
		rosterPlayers: fetched.teams.reduce((sum: number, team: any) => sum + Number(team.roster_entries?.length ?? 0), 0), refreshedAt: new Date().toISOString() };
}

function persistWeeklyProjections(teams: any[], seasonYear: number, week: number, leagueId: string) {
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
	const findPlayer = db.prepare('SELECT id FROM players WHERE espn_id=?');
	const insert = db.prepare('INSERT INTO player_projections(projection_set_id,player_id,projected_points,stats_json) VALUES(?,?,?,?)');
	db.transaction(() => {
		db.prepare(`INSERT INTO projection_sets(id,source,season_year,scoring_basis,published_at,imported_at,methodology_version,metadata_json)
			VALUES(?,?,?,?,?,?,?,?)`).run(setId, 'espn-weekly-proxy', seasonYear, `ESPN_LEAGUE:${leagueId}`, importedAt, importedAt, 'espn-statline-v1', JSON.stringify({ week, leagueId }));
		for (const projection of players.values()) {
			const row = findPlayer.get(projection.playerId) as { id: string } | undefined;
			if (row) insert.run(setId, row.id, projection.points, JSON.stringify({ espnStats: projection.stats, week, espnPlayerId: projection.playerId }));
		}
	})();
}
