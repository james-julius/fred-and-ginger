// Crawler rows (actor/SCHEMA.md) -> listings + sightings, and the Apify side:
// starting runs with a webhook back to us, and reading their datasets.
import { locate, report } from './building';

export interface Env {
  DB: D1Database; ASSETS: Fetcher;
  APIFY_TOKEN: string; SESSION_KEY: string; HOOK_SECRET: string;
  PASSWORD_JAMES?: string; PASSWORD_ERIN?: string;
  FRED_MODEL?: string;                    // provider/model for the agent; its API key is a secret too
  FRED_EFFORT?: 'low' | 'medium' | 'high'; // Anthropic effort for chat; default low, for speed
  NIMBLE_API_KEY?: string;                // web search and page reads for Fred's research tools
  EMAIL?: SendEmail;                      // Cloudflare Email Sending, from fred@jamesjuliusdarby.com
  FRED_DEV?: string;                      // '1' only in cloud/.dev.vars: enables eval-only overrides and routes
  ANTHROPIC_API_KEY?: string; OPENAI_API_KEY?: string; GOOGLE_GENERATIVE_AI_API_KEY?: string;
}

const now = () => Math.floor(Date.now() / 1000);

// "North 10th Street" and "N 10 St" are the same street
const WORDS: Record<string, string> = {
  north: 'n', south: 's', east: 'e', west: 'w', street: 'st', avenue: 'ave', av: 'ave', place: 'pl', road: 'rd',
  boulevard: 'blvd', drive: 'dr', lane: 'ln', court: 'ct', parkway: 'pkwy', terrace: 'ter', square: 'sq', saint: 'st',
};
export function normStreet(s: string) {
  return s.toLowerCase().replace(/[.,#']/g, ' ').replace(/(\d+)(st|nd|rd|th)\b/g, '$1')
    .split(/\s+/).filter(Boolean).map((w) => WORDS[w] || w).join(' ');
}
export const normUnit = (u?: string | null) => (u || '').toUpperCase().replace(/^(APT|UNIT|#)\s*/, '').replace(/[^A-Z0-9]/g, '').replace(/^0+(?=\w)/, '');

// Sites get specs wrong (a Zillow 1 bed once said 1 full + 3 half baths). Drop what can't be true:
// unknown shows as unknown, and the next sighting fills it in.
export function specs(r: any) {
  const n = (v: any) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  let beds = n(r.beds), baths = n(r.baths), sqft = n(r.sqft);
  if (beds != null && (beds < 0 || beds > 10)) beds = null;
  if (baths != null && (baths <= 0 || baths > 10 || baths * 2 !== Math.round(baths * 2))) baths = null;
  if (baths != null && beds != null && baths > Math.max(beds, 1) + 1) baths = null;
  if (sqft != null && (sqft < 100 || sqft > 20000)) sqft = null;
  return { beds, baths, sqft };
}

// A street with no unit could be any apartment in the building, so it only matches itself.
export function keyOf(r: any) {
  const unit = normUnit(r.unit);
  return r.street && unit ? `${normStreet(r.street)}#${unit}` : `${r.source}:${r.sourceId}`;
}

export async function upsert(env: Env, r: any): Promise<'new' | 'seen' | 'skip'> {
  if (!r?.source || !r.sourceId || !r.price) return 'skip';
  const t = now(), db = env.DB;
  const { beds, baths, sqft } = specs(r);
  const photos = JSON.stringify((r.photos || []).slice(0, 8));
  const s = await db.prepare('SELECT listing_id, price FROM sightings WHERE source=? AND source_id=?').bind(r.source, String(r.sourceId)).first<any>();
  let id: number | undefined = s?.listing_id;
  if (!id) {
    const key = keyOf(r);
    const hit = await db.prepare('SELECT id FROM listings WHERE key=?').bind(key).first<any>();
    if (hit) id = hit.id;
    else {
      const res = await db.prepare(
        `INSERT INTO listings (key, street, unit, neighbourhood, borough, zip, lat, lon, price, net_effective, beds, baths, sqft,
           no_fee, available, photos, agency, open_house, first_seen, last_seen, price_history, geo_state)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        key, r.street ?? null, normUnit(r.unit) || null, r.neighbourhood ?? null, r.borough ?? null, r.zip ?? null,
        r.lat ?? null, r.lon ?? null, r.price, r.netEffective ?? null, beds, baths, sqft,
        r.noFee == null ? null : r.noFee ? 1 : 0, r.available ?? null, photos, r.agency ?? null,
        JSON.stringify(r.raw?.upcomingOpenHouse ?? null), t, t, JSON.stringify([[t, r.price]]), r.street ? 'pending' : 'none').run();
      id = res.meta.last_row_id as number;
      await db.prepare('INSERT INTO sightings VALUES (?,?,?,?,?,?,?,?)')
        .bind(r.source, String(r.sourceId), id, r.url ?? null, r.price, t, t, JSON.stringify(r.raw ?? {})).run();
      return 'new';
    }
  }
  // seen before (here or on another site): refresh, note price moves, and clear facts so the cron
  // re-reads them from every sighting (facts.ts). Specs follow the latest site that states them, so a
  // listing the site corrects gets corrected here too.
  const l = await db.prepare('SELECT price, price_history, photos FROM listings WHERE id=?').bind(id).first<any>();
  const hist: [number, number][] = JSON.parse(l?.price_history || '[]');
  if (l && r.price !== l.price && (!hist.length || hist[hist.length - 1][1] !== r.price)) hist.push([t, r.price]);
  await db.batch([
    db.prepare(`UPDATE listings SET price=?, last_seen=?, status='active', price_history=?,
                photos=CASE WHEN photos IS NULL OR photos='[]' THEN ? ELSE photos END,
                no_fee=COALESCE(?, no_fee), available=COALESCE(?, available),
                beds=COALESCE(?, beds), baths=COALESCE(?, baths), sqft=COALESCE(?, sqft),
                lat=COALESCE(lat, ?), lon=COALESCE(lon, ?), open_house=COALESCE(?, open_house),
                facts=NULL WHERE id=?`)
      .bind(r.price, t, JSON.stringify(hist.slice(-20)), photos, r.noFee == null ? null : r.noFee ? 1 : 0, r.available ?? null,
            beds, baths, sqft, r.lat ?? null, r.lon ?? null, r.raw?.upcomingOpenHouse ? JSON.stringify(r.raw.upcomingOpenHouse) : null, id),
    db.prepare(`INSERT INTO sightings VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (source, source_id)
                DO UPDATE SET price=excluded.price, url=excluded.url, last_seen=excluded.last_seen, raw=excluded.raw`)
      .bind(r.source, String(r.sourceId), id, r.url ?? null, r.price, t, t, JSON.stringify(r.raw ?? {})),
  ]);
  return 'seen';
}

// ── Apify ──────────────────────────────────────────────────────────────
const APIFY = 'https://api.apify.com/v2';
const apify = (env: Env, path: string, init?: RequestInit) =>
  fetch(APIFY + path, { ...init, headers: { Authorization: `Bearer ${env.APIFY_TOKEN}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });

export interface Criteria { maxRent?: number; minBeds?: number; areas?: string[] }

const slug = (a: string) => a.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const MANHATTAN = /^(manhattan|.*village|soho|noho|tribeca|chelsea|.*harlem|.*side|midtown.*|murray-hill|gramercy.*|kips-bay|flatiron|nolita|chinatown|little-italy|financial-district|battery-park.*|hells-kitchen|inwood|washington-heights|hudson-yards|two-bridges|morningside-heights|hamilton-heights|yorkville|roosevelt-island)$/;
const QUEENS = /^(queens|astoria|long-island-city|sunnyside|woodside|jackson-heights|elmhurst|forest-hills|rego-park|ridgewood|flushing|kew-gardens|corona|bayside|maspeth|ditmars.*)$/;
function clSubarea(a: string) {
  const s = slug(a);
  return MANHATTAN.test(s) ? 'mnh' : QUEENS.test(s) ? 'que' : s === 'bronx' ? 'brx' : 'brk';
}

// The same search on a site isn't re-run within this window: listings don't move that fast, and runs cost money.
export const RECHECK_HOURS = 4;
export const critKey = (c: Criteria) => JSON.stringify({ areas: [...(c.areas ?? [])].map(slug).sort(), maxRent: c.maxRent ?? null, minBeds: c.minBeds ?? null });

// Fred's crawl: only the sites he names, for this search, skipping any that checked it recently
export async function crawl(env: Env, base: string, c: Criteria, sources: string[]) {
  const key = critKey(c), out: { source: string; started?: boolean; checkedMinsAgo?: number; error?: string }[] = [];
  for (const name of sources) {
    if (!SOURCES[name]) { out.push({ source: name, error: 'unknown site' }); continue; }
    const last = await env.DB.prepare(`SELECT started, status FROM runs WHERE source=? AND criteria=? AND status NOT IN ('FAILED','ABORTED','TIMED-OUT')
                                       ORDER BY started DESC LIMIT 1`).bind(name, key).first<any>();
    if (last && now() - last.started < RECHECK_HOURS * 3600) { out.push({ source: name, checkedMinsAgo: Math.round((now() - last.started) / 60) }); continue; }
    const [r] = await startRuns(env, base, [name], c);
    out.push(r.id ? { source: name, started: true } : { source: name, error: r.error });
  }
  return out;
}

// one entry per crawler; input() turns the shared search criteria into that actor's input
export const SOURCES: Record<string, { actor: string; input: (c: Criteria) => any; everyHours?: number }> = {
  streeteasy: {
    actor: 'jamesjulius~nest-streeteasy',
    input: (c) => ({
      searches: (c.areas?.length ? c.areas : ['nyc']).map((a) =>
        `https://streeteasy.com/for-rent/${a}/` + [c.maxRent ? `price:-${c.maxRent}` : '', c.minBeds != null ? `beds>=${c.minBeds}` : '']
          .filter(Boolean).join('%7C')),
      maxPages: 8,
    }),
  },
  zillow: {
    actor: 'jamesjulius~nest-zillow',
    input: (c) => {
      const fs: any = { fr: { value: true }, fsba: { value: false }, fsbo: { value: false }, nc: { value: false }, cmsn: { value: false },
                        auc: { value: false }, fore: { value: false } };
      if (c.maxRent) fs.mp = { max: c.maxRent };
      if (c.minBeds) fs.beds = { min: c.minBeds };
      const q = encodeURIComponent(JSON.stringify({ filterState: fs, isListVisible: true }));
      // a neighbourhood search is small enough to read in full (Williamsburg: 72, two pages)
      if (c.areas?.length) return { searches: c.areas.map((a) => `https://www.zillow.com/${slug(a)}-new-york-ny/rentals/?searchQueryState=${q}`),
                                    maxItems: 300 * c.areas.length, maxPages: 8 };
      return { searches: ['manhattan', 'brooklyn', 'queens'].map((b) => `https://www.zillow.com/${b}-new-york-ny/rentals/?searchQueryState=${q}`),
               maxItems: 400, maxPages: 4 };
    },
  },
  renthop: {
    actor: 'jamesjulius~nest-renthop',
    input: (c) => ({ neighbourhoods: c.areas?.length ? c.areas : undefined, borough: c.areas?.length ? undefined : 'brooklyn',
                     maxPrice: c.maxRent, minBeds: c.minBeds, maxItems: 150 }),
  },
  zumper: {
    actor: 'jamesjulius~nest-zumper',
    input: (c) => ({ neighbourhoods: c.areas?.length ? c.areas : undefined, borough: c.areas?.length ? undefined : 'brooklyn',
                     maxPrice: c.maxRent, minBeds: c.minBeds, maxItems: 200 }),
  },
  compass: {
    actor: 'jamesjulius~nest-compass',
    everyHours: 12,                   // a browser per run: twice a day is plenty
    input: (c) => ({ neighbourhoods: c.areas?.length ? c.areas : undefined, borough: c.areas?.length ? undefined : 'brooklyn',
                     maxPrice: c.maxRent, minBeds: c.minBeds, maxItems: 80, details: 'exclusives' }),
  },
  nooklyn: {
    actor: 'jamesjulius~nest-nooklyn',
    input: (c) => ({ neighbourhoods: c.areas?.length ? c.areas : ['brooklyn'], maxPrice: c.maxRent, minBeds: c.minBeds, maxItems: 200 }),
  },
  landlords: {
    actor: 'jamesjulius~nest-landlords',
    input: () => ({ maxPerCompany: 400 }),
  },
  craigslist: {
    actor: 'jamesjulius~nest-craigslist',
    // Craigslist has no neighbourhood filter: search the areas' boroughs for posts that name them
    input: (c) => c.areas?.length
      ? { subareas: [...new Set(c.areas.map(clSubarea))], query: c.areas.map((a) => slug(a).replace(/-/g, ' ')).join(' | '),
          maxPrice: c.maxRent, minBedrooms: c.minBeds || undefined, maxItems: 200 }
      : { subareas: ['mnh', 'brk', 'que'], maxPrice: c.maxRent, minBedrooms: c.minBeds || undefined, maxItems: 360 },
  },
};

export async function startRuns(env: Env, base: string, only?: string[], given?: Criteria) {
  let c = given;
  if (!c) {
    const rows = await env.DB.prepare('SELECT criteria FROM searches WHERE enabled=1').all<any>();
    const crits: Criteria[] = rows.results.map((x) => JSON.parse(x.criteria));
    if (!crits.length) return [];
    // merge searches: union of areas, loosest price/beds
    c = {
      maxRent: Math.max(...crits.map((x) => x.maxRent || 0)) || undefined,
      minBeds: Math.min(...crits.map((x) => x.minBeds ?? 0)),
      areas: [...new Set(crits.flatMap((x) => x.areas || []))],
    };
  }
  const hook = btoa(JSON.stringify([{ eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED', 'ACTOR.RUN.TIMED_OUT', 'ACTOR.RUN.ABORTED'],
                                      requestUrl: `${base}/hooks/apify?key=${env.HOOK_SECRET}` }]));
  const out = [];
  for (const [name, s] of Object.entries(SOURCES)) {
    if (only && !only.includes(name)) continue;
    if (!only && s.everyHours) {
      const last = await env.DB.prepare('SELECT max(started) AS t FROM runs WHERE source=?').bind(name).first<any>();
      if (last?.t && now() - last.t < s.everyHours * 3600 - 600) continue;
    }
    const r = await apify(env, `/acts/${s.actor}/runs?webhooks=${encodeURIComponent(hook)}`, { method: 'POST', body: JSON.stringify(s.input(c)) });
    const d: any = await r.json().catch(() => ({}));
    const id = d?.data?.id;
    if (id) await env.DB.prepare('INSERT OR REPLACE INTO runs (id, source, status, started, criteria) VALUES (?,?,?,?,?)').bind(id, name, 'RUNNING', now(), critKey(c)).run();
    out.push({ source: name, id, error: id ? undefined : d?.error?.message || `HTTP ${r.status}` });
  }
  return out;
}

// webhook: just note that the run ended; the cron reads its rows in batches
export async function finishRun(env: Env, runId: string) {
  const r: any = await (await apify(env, `/actor-runs/${runId}`)).json();
  const run = r?.data;
  if (!run) return { error: 'no such run' };
  const ok = run.status === 'SUCCEEDED';
  await env.DB.prepare(`INSERT INTO runs (id, source, status, started, finished, cost, error, dataset, ingested, items, added)
                        VALUES (?, COALESCE((SELECT source FROM runs WHERE id=?), 'unknown'), ?, ?, ?, ?, ?, ?, 0, 0, 0)
                        ON CONFLICT (id) DO UPDATE SET status=excluded.status, finished=excluded.finished, cost=excluded.cost,
                        error=excluded.error, dataset=excluded.dataset`)
    .bind(runId, runId, ok ? 'INGESTING' : run.status, Math.floor(new Date(run.startedAt).getTime() / 1000), now(),
          run.usageTotalUsd ?? null, ok ? null : run.statusMessage ?? run.status, ok ? run.defaultDatasetId : null).run();
  return { status: run.status };
}

// one batch of one finished run's rows
export async function ingestBatch(env: Env, size = 60) {
  const run = await env.DB.prepare(`SELECT id, dataset, ingested, items, added, criteria FROM runs WHERE status='INGESTING' ORDER BY finished LIMIT 1`).first<any>();
  if (!run) return null;
  const rows: any[] = await (await apify(env, `/datasets/${run.dataset}/items?clean=1&limit=${size}&offset=${run.ingested}`)).json();
  // the landlords crawler returns everything those companies have: keep what fits the search
  const c = run.criteria ? run : await env.DB.prepare('SELECT criteria FROM searches WHERE enabled=1 LIMIT 1').first<any>();
  const crit: Criteria = c ? JSON.parse(c.criteria) : {};
  const fits = (r: any) => (!crit.maxRent || !r.price || r.price <= crit.maxRent) && (crit.minBeds == null || r.beds == null || r.beds >= crit.minBeds);
  let added = 0;
  for (const row of rows) if (fits(row) && (await upsert(env, row)) === 'new') added++;
  const done = rows.length < size;
  await env.DB.prepare(`UPDATE runs SET ingested=ingested+?, items=COALESCE(items,0)+?, added=COALESCE(added,0)+?, status=? WHERE id=?`)
    .bind(rows.length, rows.length, added, done ? 'SUCCEEDED' : 'INGESTING', run.id).run();
  return { run: run.id, rows: rows.length, added, done };
}

// ── enrichment: a few at a time, every 10 minutes ──────────────────────
export async function enrich(env: Env, geoMax = 15, bldMax = 3) {
  const db = env.DB;
  const pending = await db.prepare(`SELECT id, street, unit, zip, neighbourhood FROM listings
                                    WHERE geo_state='pending' AND street IS NOT NULL ORDER BY first_seen DESC LIMIT ?`).bind(geoMax).all<any>();
  let located = 0, merged = 0;
  for (const l of pending.results) {
    const loc = await locate(l.street, l.zip || l.neighbourhood).catch(() => null);
    if (!loc) { await db.prepare(`UPDATE listings SET geo_state='failed' WHERE id=?`).bind(l.id).run(); continue; }
    located++;
    // same building + unit already listed under another spelling: fold this one in
    const twin = l.unit ? await db.prepare(`SELECT id FROM listings WHERE bbl=? AND unit=? AND id<>? ORDER BY first_seen LIMIT 1`)
      .bind(loc.bbl, l.unit, l.id).first<any>() : null;
    if (twin) {
      await db.batch([
        db.prepare('UPDATE sightings SET listing_id=? WHERE listing_id=?').bind(twin.id, l.id),
        db.prepare('UPDATE OR IGNORE votes SET listing_id=? WHERE listing_id=?').bind(twin.id, l.id),
        db.prepare('DELETE FROM votes WHERE listing_id=?').bind(l.id),
        db.prepare('DELETE FROM listings WHERE id=?').bind(l.id),
        db.prepare(`UPDATE listings SET last_seen=MAX(last_seen, ?), status='active' WHERE id=?`).bind(now(), twin.id),
      ]);
      merged++; continue;
    }
    await db.prepare(`UPDATE listings SET bbl=?, bin=?, lat=COALESCE(lat, ?), lon=COALESCE(lon, ?),
                      neighbourhood=COALESCE(neighbourhood, ?), borough=COALESCE(borough, ?), zip=COALESCE(zip, ?), geo_state='done' WHERE id=?`)
      .bind(loc.bbl, loc.bin, loc.lat, loc.lon, loc.neighbourhood, loc.borough, loc.zip, l.id).run();
  }
  // building checks for buildings we haven't looked at in a week
  const todo = await db.prepare(`SELECT DISTINCT l.bbl, l.bin FROM listings l LEFT JOIN buildings b ON b.bbl=l.bbl
                                 WHERE l.bbl IS NOT NULL AND l.status='active' AND (b.bbl IS NULL OR b.fetched < ?) LIMIT ?`)
    .bind(now() - 7 * 86400, bldMax).all<any>();
  let checked = 0;
  for (const b of todo.results) {
    try {
      const rep = await report(b.bbl, b.bin);
      await db.prepare('INSERT OR REPLACE INTO buildings VALUES (?,?,?,?)').bind(b.bbl, rep.score, JSON.stringify(rep), now()).run();
      checked++;
    } catch (e) { console.log('building', b.bbl, String(e)); }
  }
  // not seen by any crawler for 3 days: probably rented
  await db.prepare(`UPDATE listings SET status='gone' WHERE status='active' AND last_seen < ?`).bind(now() - 3 * 86400).run();
  return { located, merged, checked };
}
