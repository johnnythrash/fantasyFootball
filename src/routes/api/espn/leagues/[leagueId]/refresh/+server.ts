import { json } from '@sveltejs/kit';
import { refreshImportedEspnLeague } from '$lib/server/espn-league-refresh';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params }) => {
	try { return json(await refreshImportedEspnLeague(params.leagueId)); }
	catch (cause) { return json({ message: cause instanceof Error ? cause.message : 'ESPN refresh failed' }, { status: 400 }); }
};
