// Fred checks the sites on demand, for the user's search, instead of crawling all of NYC on a
// timer. He picks which sites and in what order; a site that already checked this search in the
// last few hours is skipped. Rows land through the Apify webhook (index.ts) within a few minutes.
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { crawl, critKey, RECHECK_HOURS, SOURCES, type Criteria, type Env } from '../ingest';
import { load, view } from '../mock';

const BASE = 'https://fredandginger.jamesjuliusdarby.com';
const SITES = Object.keys(SOURCES) as [string, ...string[]];
const NAMES: Record<string, string> = {
  streeteasy: 'StreetEasy', zillow: 'Zillow', renthop: 'RentHop', zumper: 'Zumper', compass: 'Compass',
  nooklyn: 'Nooklyn', landlords: 'landlord sites', craigslist: 'Craigslist',
};

type Ctx = { requestContext?: { get(k: string): unknown }; writer?: { custom(part: { type: string; data: unknown }): Promise<void> } };
const envOf = (c: Ctx) => {
  const env = c.requestContext?.get('env') as (Env & { ME: string }) | undefined;
  if (!env) throw new Error('No request context: tools must run inside a signed-in request');
  return env;
};

/** the saved search as crawler criteria */
async function criteria(env: Env & { ME: string }): Promise<Criteria> {
  const d = view(await load(env.DB, env.ME)).search.dealbreakers;
  return { areas: d.areas ?? [], maxRent: d.maxTotalMonthly ?? undefined, minBeds: d.minBeds ?? undefined };
}

export const checkSites = createTool({
  id: 'checkSites',
  description: `Check rental sites now for new listings matching the saved search (areas, budget, beds). Takes 1-5 minutes; results land in the listings searchListings reads. Name the sites in the order you want them: quick ones are streeteasy, renthop, zumper, nooklyn, craigslist; zillow and compass drive a browser and take longer; landlords reads big landlords' own sites. A site that checked this search in the last ${RECHECK_HOURS} hours is skipped.`,
  inputSchema: z.object({ sites: z.array(z.enum(SITES)).min(1).describe('e.g. ["streeteasy", "zillow", "craigslist"]') }),
  execute: async (input, c) => {
    const env = envOf(c as Ctx), crit = await criteria(env);
    if (!crit.areas?.length && !crit.maxRent) return { error: 'The search has no area or budget yet: ask the user, then updateSearch first.' };
    const res = await crawl(env, BASE, crit, input.sites);
    const started = res.filter((r) => r.started).map((r) => NAMES[r.source] ?? r.source);
    await (c as Ctx).writer?.custom({ type: 'data-scan', data: { checked: 0, matched: 0, hidden: 0,
      steps: [{ label: started.length ? `Checking ${started.join(', ')}` : 'Sites checked recently', toolCallId: null }] } });
    return { sites: res, note: started.length ? 'New listings arrive over the next few minutes. Call crawlStatus or searchListings later to see them.' : undefined };
  },
});

export const crawlStatus = createTool({
  id: 'crawlStatus',
  description: 'Where the site checks for the saved search are: running, reading results, or done, and how many new listings each found.',
  inputSchema: z.object({}),
  execute: async (_in, c) => {
    const env = envOf(c as Ctx), key = critKey(await criteria(env));
    const rows = await env.DB.prepare(`SELECT source, status, started, items, added FROM runs WHERE criteria=? AND started > ? ORDER BY started DESC`)
      .bind(key, Math.floor(Date.now() / 1000) - 24 * 3600).all<any>();
    const latest = new Map<string, any>();
    for (const r of rows.results) if (!latest.has(r.source)) latest.set(r.source, r);
    const state = (s: string) => (s === 'RUNNING' ? 'checking' : s === 'INGESTING' ? 'reading results' : s === 'SUCCEEDED' ? 'done' : 'failed');
    return {
      sites: [...latest.values()].map((r) => ({ site: NAMES[r.source] ?? r.source, state: state(r.status), minsAgo: Math.round((Date.now() / 1000 - r.started) / 60),
                                                newListings: r.added ?? 0, read: r.items ?? 0 })),
      neverChecked: SITES.filter((s) => !latest.has(s)),
    };
  },
});
