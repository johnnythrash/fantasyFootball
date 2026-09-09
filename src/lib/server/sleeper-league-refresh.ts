import { getLeague, saveLeague } from '$lib/server/db/repositories';
import { sleeper } from '$lib/server/providers/sleeper';

export async function refreshImportedSleeperLeague(localLeagueId: string) {
	const existing: any = getLeague(localLeagueId);
	if (!existing || existing.platform !== 'SLEEPER') throw new Error('Sleeper league not found');
	if (!existing.auth?.username) throw new Error('Stored Sleeper username is unavailable; import the league again');
	const fetched: any = await sleeper.fetchSeason({ username: existing.auth.username, season: Number(existing.season_year), leagueId: String(existing.external_id) });
	const teamCount = Number(fetched.league.team_count ?? fetched.teams.length);
	const id = saveLeague({
		id: existing.id, platform: 'SLEEPER', externalId: String(existing.external_id), seasonYear: Number(existing.season_year),
		name: fetched.league.name, teamCount, draftType: fetched.league.draft_type,
		draftStarted: fetched.league.draft_started, draftCompleted: fetched.league.draft_completed,
		userTeamId: String(fetched.userTeamId), auth: existing.auth, settings: fetched.league.settings
	}, fetched.teams.map((team: any) => ({
		platformTeamId: String(team.sleeper_roster_id), name: team.team_name, ownerName: team.owner_name,
		draftPosition: team.draft_position, isUser: String(team.sleeper_roster_id) === String(fetched.userTeamId), data: team
	})), fetched.picks.map((pick: any, index: number) => ({
		pickNumber: Number(pick.pick_number ?? index + 1), roundNumber: Number(pick.round_number),
		roundPick: Number(pick.pick_in_round ?? ((index % teamCount) + 1)), teamId: String(pick.team_id ?? ''),
		platformPlayerId: String(pick.sleeper_player_id ?? ''), playerName: pick.player_name,
		position: pick.player_position, nflTeam: pick.player_nfl_team, data: pick.player_data
	})));
	return { id, name: fetched.league.name, teams: fetched.teams.length, picks: fetched.picks.length, refreshedAt: new Date().toISOString() };
}
