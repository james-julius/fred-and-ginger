// Fred's tools. Each reads and writes through the same store as the REST API, so whatever Fred
// does shows up in the app at once: a search change, a new place in the inbox, a draft tour.
// Who the user is comes from the request context set by the server, never from the model.
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import * as S from '@fng/api';
import type { Env } from '../ingest';
import { applySearch, load, save, summarize, view, type Card } from '../mock';
import { detail, search, toCard } from './listings';
import { counts, inbox, vote } from '../places';
import { readPage, webSearch } from '../nimble';
import { factsFrom, mergeFacts, type Facts } from '../facts';
import { checkSites, crawlStatus } from './crawl';

type Ctx = { requestContext?: { get(k: string): unknown }; writer?: { custom(part: { type: string; data: unknown }): Promise<void> } };
const who = (c: Ctx) => {
  const env = c.requestContext?.get('env') as (Env & { ME: string }) | undefined;
  if (!env) throw new Error('No request context: tools must run inside a signed-in request');
  return { db: env.DB, user: env.ME, nimble: env.NIMBLE_API_KEY };
};
const emit = (c: Ctx, type: string, data: unknown) => c.writer?.custom({ type, data });
/** listing ids searchListings returned this turn; addToInbox only accepts these */
const seen = (c: Ctx) => (c.requestContext?.get('seenListings') as Set<number> | undefined) ?? new Set<number>();

/** the real inbox, the same one the app shows */
const real = async (db: D1Database, user: string) => {
  const st = await load(db, user), v = view(st);
  return { st, v, cards: await inbox(db, user, st, v.search) };
};

const compact = (c: Card) => ({ id: c.id, area: c.area, price: c.price, beds: c.beds, baths: c.baths, status: c.status, seen: c.seen, verdict: c.verdict.label, highlight: c.highlight });

export const getSearch = createTool({
  id: 'getSearch',
  description: "Read the user's saved search: dealbreakers (hard filters), preferences and commutes.",
  inputSchema: z.object({}),
  execute: async (_in, c) => {
    const { db, user } = who(c as Ctx);
    const s = view(await load(db, user)).search;
    return { summary: summarize(s), ...s };
  },
});

export const updateSearch = createTool({
  id: 'updateSearch',
  description: 'Change the saved search. Use when the user states or changes a requirement. Only pass what changed. Budget is total monthly cost including required fees.',
  inputSchema: z.object({
    dealbreakers: S.Dealbreakers.partial().optional().describe('Hard filters to change'),
    addPreferences: z.array(z.string()).optional().describe('Nice-to-haves to add, e.g. "Washer/dryer in unit"'),
    removePreferences: z.array(z.string()).optional(),
  }),
  execute: async (input, c) => {
    const { db, user } = who(c as Ctx);
    const st = await load(db, user), cur = view(st).search;
    const prefs = cur.preferences.filter((p) => !(input.removePreferences ?? []).some((r) => r.toLowerCase() === p.label.toLowerCase()));
    for (const label of input.addPreferences ?? []) if (!prefs.some((p) => p.label.toLowerCase() === label.toLowerCase())) prefs.push({ id: `p_${crypto.randomUUID().slice(0, 6)}`, label, weight: 'nice' });
    st.search = applySearch(cur, { dealbreakers: input.dealbreakers, preferences: prefs });
    await save(db, user, st);
    await emit(c as Ctx, 'data-search-updated', { changed: Object.keys(input.dealbreakers ?? {}), dealbreakers: st.search.dealbreakers });
    return { summary: summarize(st.search), dealbreakers: st.search.dealbreakers, preferences: prefs.map((p) => p.label) };
  },
});

export const searchListings = createTool({
  id: 'searchListings',
  description: "Search the real NYC rental listings Fred has collected from StreetEasy, Zillow, RentHop, Zumper, Craigslist, Compass, Nooklyn and landlord sites. Each match comes with highlights (deal vs the area's usual rent, laundry, outdoor space, pets, light), and a buildingWarning only when the city record is bad. Areas are neighbourhood or borough names.",
  inputSchema: z.object({
    areas: z.array(z.string()).optional().describe('e.g. ["williamsburg", "greenpoint"] or ["brooklyn"]'),
    maxRent: z.number().optional(), minBeds: z.number().optional(), minBaths: z.number().optional(),
    noFeeOnly: z.boolean().optional(), minBuildingScore: z.number().optional().describe('0-100; 60+ avoids buildings with many city complaints'),
    pets: z.enum(['dogs', 'cats', 'dogs_and_cats']).optional().describe("The user's pets. Drops places that say no; places that don't say stay in"),
    limit: z.number().optional().describe('Default 15, max 40'),
  }),
  execute: async (input, c) => {
    const { db } = who(c as Ctx);
    const r = await search(db, input);
    for (const l of r.found) seen(c as Ctx).add(l.listingId);
    const where = input.areas?.length ? input.areas.join(', ') : 'all of NYC';
    await emit(c as Ctx, 'data-scan', { checked: r.total, matched: r.found.length, hidden: 0, steps: [{ label: `Searched ${where}${input.maxRent ? ` up to $${input.maxRent.toLocaleString('en-US')}` : ''}`, toolCallId: null }] });
    return { matching: r.total, showing: r.found.length, listings: r.found };
  },
});

export const addToInbox = createTool({
  id: 'addToInbox',
  description: "Put listings from searchListings into the user's inbox as places, each with your verdict. Use likely_scam to hide a suspicious one with the reason. Over-budget ones can still go in with over_budget_with_fees.",
  inputSchema: z.object({
    places: z.array(z.object({
      listingId: z.number(),
      verdict: S.Verdict.shape.kind,
      fit: z.number().min(0).max(100).describe('How well it fits this user'),
      highlight: z.string().nullable().optional().describe('The one feature this user will care about most, e.g. "Washer/dryer in unit"'),
      reason: z.string().nullable().optional().describe('Short reason shown on the card, mainly for warnings'),
    })).min(1).max(20),
  }),
  execute: async ({ places }, c) => {
    const { db, user } = who(c as Ctx);
    const { st, v, cards } = await real(db, user);
    // Fred's verdict replaces an earlier one for the same place
    const redo = new Set(places.filter((p) => seen(c as Ctx).has(p.listingId)).map((p) => `op_${p.listingId}`));
    st.created = (st.created ?? []).filter((x) => !redo.has(x.id));
    const existing = new Set<string>();
    const added: Card[] = [], known = seen(c as Ctx);
    const rejected = places.filter((p) => !known.has(p.listingId)).map((p) => p.listingId);
    for (const p of places.filter((x) => known.has(x.listingId))) {
      const card = await toCard(db, p.listingId, p);
      if (card && !existing.has(card.id)) { added.push(card); existing.add(card.id); }
    }
    st.created = [...added, ...(st.created ?? [])];
    await save(db, user, st);
    return {
      added: added.map(compact), alreadyInInbox: places.length - rejected.length - added.length,
      counts: counts([...added, ...cards.filter((x) => !added.some((a) => a.id === x.id))], v.tours),
      ...(rejected.length && { rejected, why: 'These ids were not in your searchListings results this turn. Use ids exactly as returned.' }),
    };
  },
});

export const listInbox = createTool({
  id: 'listInbox',
  description: "List places in the user's inbox: new (includes hidden), saved, hidden or all.",
  inputSchema: z.object({ view: z.enum(['new', 'saved', 'hidden', 'all']).default('new') }),
  execute: async ({ view: tab }, c) => {
    const { db, user } = who(c as Ctx);
    const cards = (await real(db, user)).cards.filter((o) => tab === 'all' || (tab === 'new' ? o.status === 'new' || o.status === 'hidden' : o.status === tab));
    return { places: cards.map(compact) };
  },
});

export const getPlace = createTool({
  id: 'getPlace',
  description: 'Everything about one place in the inbox: costs and fees, building record, photos, every site it is listed on, price history.',
  inputSchema: z.object({ id: z.string().describe('Place id, like op_123') }),
  execute: async ({ id }, c) => {
    const { db, user } = who(c as Ctx);
    const card = (await real(db, user)).cards.find((x) => x.id === id);
    if (!card) return { error: `No place ${id} in the inbox` };
    return (await detail(db, card)) ?? { error: `Listing for ${id} is gone` };
  },
});

export const updatePlace = createTool({
  id: 'updatePlace',
  description: 'Save, pass on, hide or unhide a place, or add a note to it, when the user asks.',
  inputSchema: z.object({ id: z.string(), status: S.OpportunityStatus.optional(), note: z.string().nullable().optional() }),
  execute: async ({ id, status, note }, c) => {
    const { db, user } = who(c as Ctx);
    const { st, v, cards } = await real(db, user), card = cards.find((x) => x.id === id);
    if (!card) return { error: `No place ${id} in the inbox` };
    st.cards[id] = { ...st.cards[id], ...(status && { status }), ...(note !== undefined && { note }) };
    await Promise.all([save(db, user, st), vote(db, user, card, { status, note })]);
    const next = cards.map((x) => (x.id === id ? { ...x, ...st.cards[id] } : x));
    return { place: compact(next.find((x) => x.id === id)!), counts: counts(next, v.tours) };
  },
});

export const requestTour = createTool({
  id: 'requestTour',
  description: 'Draft a tour request for a place, with the times the user can do. This only creates a draft; nothing is sent to anyone.',
  inputSchema: z.object({ placeId: z.string(), slots: z.array(z.object({ start: z.string().describe('ISO date-time'), end: z.string() })).min(1) }),
  execute: async ({ placeId, slots }, c) => {
    const { db, user } = who(c as Ctx);
    const { st, v, cards } = await real(db, user), card = cards.find((x) => x.id === placeId);
    if (!card) return { error: `No place ${placeId} in the inbox` };
    const tour = { id: `tour_${crypto.randomUUID().slice(0, 8)}`, opportunityId: card.id, startsAt: null, address: (await detail(db, card))?.address ?? card.area,
                   status: 'draft' as const, contact: null, notes: `Asked for: ${slots.map((s) => s.start).join(', ')}` };
    st.tours = [...v.tours, tour];
    await save(db, user, st);
    return { tour };
  },
});

export const setAlerts = createTool({
  id: 'setAlerts',
  description: 'Change how the user hears about new places: instant_strong (strong fits right away), daily (one digest) or off.',
  inputSchema: z.object({ mode: S.AlertMode, channel: z.enum(['email', 'sms', 'push']).optional() }),
  execute: async (input, c) => {
    const { db, user } = who(c as Ctx);
    const st = await load(db, user);
    st.alerts = { ...view(st).alerts, ...input };
    await save(db, user, st);
    return st.alerts;
  },
});

export const suggestReplies = createTool({
  id: 'suggestReplies',
  description: 'Show 2-3 quick-reply buttons under your message, usually ways to widen or narrow the search. Give each a search change when it has one. Call it before your final reply; the app shows the buttons under your message.',
  inputSchema: z.object({
    options: z.array(z.object({ label: z.string().describe('Short, e.g. "Allow 1.5 baths"'), dealbreakers: S.Dealbreakers.partial().nullable().optional() })).min(1).max(3),
  }),
  execute: async ({ options }, c) => {
    await emit(c as Ctx, 'data-suggestions', { options: options.map((o) => ({ label: o.label, patch: o.dealbreakers ? { dealbreakers: o.dealbreakers } : null })) });
    return { shown: options.map((o) => o.label) };
  },
});

export const researchWeb = createTool({
  id: 'researchWeb',
  description: "Search the web to research a place for the user: tenant reviews of a building (Openigloo, StreetEasy, Google), the landlord or management company, what the block is like, whether a building has an elevator or laundry. Include the street address and 'NYC' in the query. Returns titles, links and snippets; say where a claim came from.",
  inputSchema: z.object({ query: z.string().describe('e.g. "376 Graham Ave Brooklyn tenant reviews"') }),
  execute: async ({ query }, c) => {
    const { nimble } = who(c as Ctx);
    if (!nimble) return { error: 'Web research is not set up (no NIMBLE_API_KEY)' };
    await emit(c as Ctx, 'data-scan', { checked: 0, matched: 0, hidden: 0, steps: [{ label: `Looked up "${query}"`, toolCallId: null }] });
    try { return { results: await webSearch(nimble, query, 5) }; } catch (e) { return { error: String(e).slice(0, 200) }; }
  },
});

// the sites whose listing pages say the most, best first
const PAGE_ORDER = ['streeteasy', 'renthop', 'compass', 'nooklyn', 'zumper', 'craigslist', 'zillow', 'landlord'];
const WEEK = 7 * 86400;

export const readListingPage = createTool({
  id: 'readListingPage',
  description: "Read the full listing page for a place (the crawlers mostly saw only the search card). Use it when the user asks something the data doesn't answer: windows and light, layout, laundry, pets, fees, the exact lease terms. What it learns is saved to the place. Slow (5-15s), so only when needed.",
  inputSchema: z.object({ id: z.string().describe('Place id like op_123, or a listing id from searchListings') }),
  execute: async ({ id }, c) => {
    const { db, nimble } = who(c as Ctx);
    if (!nimble) return { error: 'Page reading is not set up (no NIMBLE_API_KEY)' };
    const listingId = Number(String(id).replace(/^op_/, ''));
    const sights = (await db.prepare('SELECT source, url FROM sightings WHERE listing_id=? AND url IS NOT NULL').bind(listingId).all<{ source: string; url: string }>()).results;
    const rank = (s: string) => { const i = PAGE_ORDER.indexOf(s.split(':')[0]); return i === -1 ? 99 : i; };
    const pick = sights.filter((s) => /^https?:/.test(s.url)).sort((a, b) => rank(a.source) - rank(b.source))[0];
    if (!pick) return { error: `No listing page for ${id}` };
    const key = `page:${listingId}`, now = Math.floor(Date.now() / 1000);
    const cached = await db.prepare('SELECT v FROM meta WHERE k=?').bind(key).first<{ v: string }>();
    let page = cached && JSON.parse(cached.v);
    if (!page || now - page.at > WEEK) {
      await emit(c as Ctx, 'data-scan', { checked: 0, matched: 0, hidden: 0, steps: [{ label: `Reading the ${pick.source.split(':')[0]} listing`, toolCallId: null }] });
      try { page = { at: now, url: pick.url, md: (await readPage(nimble, pick.url)).slice(0, 12000) }; } catch (e) { return { error: String(e).slice(0, 200) }; }
      await db.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').bind(key, JSON.stringify(page)).run();
      // what the page says joins what the cards said
      const row = await db.prepare('SELECT facts FROM listings WHERE id=?').bind(listingId).first<{ facts: string | null }>();
      const had: Facts[] = row?.facts ? [JSON.parse(row.facts)] : [];
      const merged = mergeFacts([...had, factsFrom({ body: page.md })]);
      await db.prepare('UPDATE listings SET facts=?, no_fee=COALESCE(no_fee, ?) WHERE id=?').bind(JSON.stringify(merged), merged.noFee ? 1 : null, listingId).run();
    }
    return { url: page.url, page: page.md.slice(0, 6000) };
  },
});

export const tools = { getSearch, updateSearch, searchListings, addToInbox, listInbox, getPlace, updatePlace, requestTour, setAlerts, suggestReplies, researchWeb, readListingPage, checkSites, crawlStatus };
