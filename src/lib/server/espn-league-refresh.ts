import { getLeague, saveLeague } from '$lib/server/db/repositories';
import { espn } from '$lib/server/providers/espn';

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
	return { id, name: fetched.league.name, teams: fetched.teams.length, picks: fetched.picks.length,
		rosterPlayers: fetched.teams.reduce((sum: number, team: any) => sum + Number(team.roster_entries?.length ?? 0), 0), refreshedAt: new Date().toISOString() };
}
