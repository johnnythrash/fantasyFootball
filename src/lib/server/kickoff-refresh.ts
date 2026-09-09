import { getDatabase } from '$lib/server/db/database';
import { listLeagues } from '$lib/server/db/repositories';
import { refreshImportedEspnLeague } from '$lib/server/espn-league-refresh';
import { refreshImportedSleeperLeague } from '$lib/server/sleeper-league-refresh';

const windows = [1440, 180, 90, 30, 10];
let running: Promise<unknown> | null = null;

export function kickoffScheduleStatus() {
	const row = getDatabase().prepare("SELECT value_json,updated_at FROM provider_cache WHERE key='kickoff-refresh:schedule'").get() as any;
	const lastRun = getDatabase().prepare("SELECT value_json,updated_at FROM provider_cache WHERE key LIKE 'kickoff-refresh:run:%' ORDER BY updated_at DESC LIMIT 1").get() as any;
	return row ? { ...JSON.parse(row.value_json), updatedAt: row.updated_at,
		lastRefresh: lastRun ? { ...JSON.parse(lastRun.value_json), updatedAt: lastRun.updated_at } : null } : null;
}

export function runKickoffRefreshCheck(refreshSharedData: () => Promise<unknown>) {
	if (running) return running;
	running = check(refreshSharedData).finally(() => { running = null; });
	return running;
}

async function check(refreshSharedData: () => Promise<unknown>) {
	const stateResponse = await fetch('https://api.sleeper.app/v1/state/nfl', { cache: 'no-store' });
	if (!stateResponse.ok) throw new Error(`NFL state returned ${stateResponse.status}`);
	const state: any = await stateResponse.json();
	const season = Number(state.season) || new Date().getFullYear();
	const week = Number(state.week ?? state.display_week) || 1;
	const scheduleResponse = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${season}&seasontype=2&week=${week}`, { cache: 'no-store' });
	if (!scheduleResponse.ok) throw new Error(`NFL schedule returned ${scheduleResponse.status}`);
	const schedule: any = await scheduleResponse.json();
	const games = (schedule.events ?? []).map((event: any) => ({
		id: String(event.id), kickoffAt: event.date, status: event.status?.type?.state ?? 'pre',
		teams: (event.competitions?.[0]?.competitors ?? []).map((team: any) => team.team?.abbreviation).filter(Boolean)
	})).filter((game: any) => game.kickoffAt);
	const now = Date.now();
	const nextGame = games.filter((game: any) => new Date(game.kickoffAt).getTime() > now).sort((a: any, b: any) => String(a.kickoffAt).localeCompare(String(b.kickoffAt)))[0] ?? null;
	writeCache('kickoff-refresh:schedule', { season, week, games, nextGame, checkedAt: new Date().toISOString() });
	const due: Array<{ game: any; window: number | 'startup' }> = [];
	for (const game of games) for (const window of windows) {
		const target = new Date(game.kickoffAt).getTime() - window * 60_000;
		if (now >= target && now < new Date(game.kickoffAt).getTime() && !readCache(`kickoff-refresh:run:${game.id}:${window}`)) due.push({ game, window });
	}
	if (nextGame && new Date(nextGame.kickoffAt).getTime() - now <= 180 * 60_000) {
		const hourBucket = new Date(now).toISOString().slice(0, 13);
		if (!readCache(`kickoff-refresh:run:${nextGame.id}:startup:${hourBucket}`)) due.push({ game: nextGame, window: 'startup' });
	}
	if (!due.length) return { refreshed: false, season, week, nextGame };
	const shared = await refreshSharedData();
	const leagueResults = [];
	for (const league of listLeagues().filter((item) => item.season_year === season)) {
		try {
			const result = league.platform === 'ESPN' ? await refreshImportedEspnLeague(league.id) : await refreshImportedSleeperLeague(league.id);
			leagueResults.push({ id: league.id, platform: league.platform, ok: true, result });
		} catch (cause) {
			leagueResults.push({ id: league.id, platform: league.platform, ok: false, error: cause instanceof Error ? cause.message : String(cause) });
		}
	}
	for (const item of due) {
		const suffix = item.window === 'startup' ? `startup:${new Date(now).toISOString().slice(0, 13)}` : item.window;
		writeCache(`kickoff-refresh:run:${item.game.id}:${suffix}`, { game: item.game, windowMinutes: item.window, completedAt: new Date().toISOString(), leagueResults });
	}
	return { refreshed: true, season, week, due, shared, leagueResults };
}

function readCache(key: string) { return getDatabase().prepare('SELECT value_json FROM provider_cache WHERE key=?').get(key); }
function writeCache(key: string, value: unknown) {
	const now = new Date().toISOString();
	getDatabase().prepare(`INSERT INTO provider_cache(key,value_json,updated_at) VALUES(?,?,?)
		ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`).run(key, JSON.stringify(value), now);
}
