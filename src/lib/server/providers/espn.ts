// src/lib/server/providers/espn.ts
import {
	fetchEspnPlayers,
	calculatePositionalADP,
	getPositionName,
	getNFLTeamName,
	calculatePositionRank
} from '$lib/server/draft/utils';
import type { Team, Pick } from '$lib/types/espnTypes';

type Auth = { espn_s2: string; swid: string };

export function normalizeEspnAuth(auth: Partial<Auth> | null | undefined): Auth {
	const cookieValue = (value: unknown, name: string) => {
		const text = String(value ?? '').trim().replace(/^['"]|['"]$/g, '');
		const match = text.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`, 'i'));
		return (match?.[1] ?? text).trim();
	};
	const espn_s2 = cookieValue(auth?.espn_s2, 'espn_s2');
	let swid = cookieValue(auth?.swid, 'SWID');
	if (swid && !swid.startsWith('{')) swid = `{${swid.replace(/[{}]/g, '')}}`;
	if (!espn_s2 || !swid) throw new Error('ESPN S2 and SWID cookies are required');
	return { espn_s2, swid };
}

export const espn = {
	async fetchSeason({ leagueId, season, auth }: { leagueId: string; season: number; auth: Auth }) {
		auth = normalizeEspnAuth(auth);
		const espnUserId = auth.swid.replace(/[{}]/g, '');
		if (!/^\d+$/.test(leagueId)) throw new Error('ESPN league ID must contain only numbers');
		const views = 'view=mDraftDetail&view=mSettings&view=mTeam&view=modular&view=mNav';
		const headers = { Cookie: `espn_s2=${auth.espn_s2}; SWID=${auth.swid};` };
		const currentUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}?${views}`;
		const historyUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/leagueHistory/${leagueId}?${views}&seasonId=${season}`;
		let res = await fetch(currentUrl, { headers });
		let payload: any = res.ok ? await res.json() : null;
		if (!res.ok || !payload?.id) {
			res = await fetch(historyUrl, { headers });
			payload = res.ok ? await res.json() : null;
		}
		if (!res.ok) {
			const hint = [401, 403].includes(res.status) ? ' Check that both cookies are current and copied from fantasy.espn.com.' : '';
			throw new Error(`ESPN returned ${res.status} for ${season}.${hint}`);
		}
		const leagueData = Array.isArray(payload) ? payload[0] : payload;
		if (!leagueData) throw new Error(`No ESPN data for ${season}`);

		const userTeam = leagueData.teams?.find((t: { owners: string[] }) =>
			t.owners?.some((oid: string) => oid.replace(/[{}]/g, '') === espnUserId)
		);
		if (!userTeam) throw new Error(`You were not a member in ${season}`);

		// league row (matches your upserts)
		const league = {
			platform_league_id: String(leagueId),
			espn_league_id: String(leagueId),
			name: leagueData.settings?.name ?? `ESPN League ${leagueId}`,
			scoring_type: leagueData.settings?.scoringSettings?.scoringType ?? 'standard',
			team_count: leagueData.settings?.size ?? 12,
			season_year: leagueData.seasonId,
			draft_type: leagueData.settings?.draftSettings?.type ?? 'SNAKE',
			draft_started: true,
			draft_completed: true,
			espn_s2_cookie: auth.espn_s2,
			swid_cookie: auth.swid,
			settings: {
				espn_data: leagueData.settings,
				last_synced: new Date().toISOString(),
				season_stats: {
					champion: leagueData.status?.playoffTierType ? 'determined' : 'unknown',
					regular_season_length: leagueData.settings?.scheduleSettings?.matchupPeriodCount,
					playoff_week_start: leagueData.settings?.scheduleSettings?.playoffMatchupPeriodLength
				}
			},
			updated_at: new Date().toISOString()
		};

		// teams (exact columns you’ve been inserting)
		const teams = (leagueData.teams ?? []).map((t: Team) => ({
			espn_team_id: t.id,
			team_name: t.name || `${t.nickname}`,
			owner_name: t.primaryOwner || 'Unknown Owner', // you were storing GUID here; keep match
			draft_position: t.draftDayProjectedRank ?? null,
			espn_owner_ids: t.owners || [],
			final_standing: t.playoffSeed ?? t.rankCalculatedFinal ?? null,
			regular_season_wins: t.record?.overall?.wins ?? 0,
			regular_season_losses: t.record?.overall?.losses ?? 0,
			points_for: t.record?.overall?.pointsFor ?? 0,
			points_against: t.record?.overall?.pointsAgainst ?? 0
		}));

		// picks (enhanced like your history route)
		const picksSrc = leagueData.draftDetail?.picks ?? [];
		const playerIds = [...new Set(picksSrc.map((p: Pick) => p.playerId))];
		const playerDataMap = await fetchEspnPlayers(
			playerIds as string[],
			season,
			auth.espn_s2,
			auth.swid
		);
		const positionADP = calculatePositionalADP(picksSrc, playerDataMap);
		const size = leagueData.settings?.size ?? 12;

		const picks = picksSrc.map((pick: Pick, index: number) => {
			const playerInfo = playerDataMap.get(pick.playerId);
			const pickNumber = pick.overallPickNumber ?? index + 1;
			const position = playerInfo?.defaultPositionId ?? playerInfo?.eligibleSlots?.[0];
			const posName = getPositionName(position);
			const avgPickForPos = positionADP[posName] ?? pickNumber;
			const pickContext =
				pickNumber < avgPickForPos - 12
					? 'early'
					: pickNumber > avgPickForPos + 12
						? 'late'
						: 'average';

			return {
				pick_number: pickNumber,
				round_number: pick.roundId ?? Math.ceil(pickNumber / size),
				pick_in_round: pick.roundPickNumber ?? ((pickNumber - 1) % size) + 1,
				team_id: pick.teamId,
				espn_player_id: String(pick.playerId),
				player_name: playerInfo?.fullName ?? 'Unknown Player',
				player_position: posName,
				player_nfl_team: playerInfo?.proTeamId ? getNFLTeamName(playerInfo.proTeamId) : null,
				position_rank: calculatePositionRank(pickNumber, posName, picksSrc, playerDataMap),
				pick_context: pickContext,
				avg_position_pick: avgPickForPos,
				player_data: playerInfo ?? null
			};
		});

		return { league, teams, picks, userTeamId: userTeam.id as number };
	}
};
