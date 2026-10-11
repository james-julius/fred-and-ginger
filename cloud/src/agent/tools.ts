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
import { knownArea } from '../areas';
import { checkSites, crawlStatus } from './crawl';
import { AlertError, examplePlaces, patchAlerts, sendTest, verifyCode } from '../alerts';
import { write as writeMemory } from '../memory';

type Ctx = { requestContext?: { get(k: string): unknown; set?(k: string, v: unknown): void }; writer?: { custom(part: { type: string; data: unknown }): Promise<void> } };
const who = (c: Ctx) => {
  const env = c.requestContext?.get('env') as (Env & { ME: string }) | undefined;
  if (!env) throw new Error('No request context: tools must run inside a signed-in request');
  return { db: env.DB, user: env.ME, nimble: env.NIMBLE_API_KEY, env };
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
    importantPreferences: z.array(z.string()).optional().describe('Preferences the user says matter a lot; adds them or raises existing ones to important'),
    removePreferences: z.array(z.string()).optional(),
  }),
  execute: (input, c) => {
    // searchListings in the same step waits for this, so it searches the new search
    const saving = changeSearch(input, c as Ctx);
    (c as Ctx).requestContext?.set?.('savingSearch', saving.catch(() => {}));
    return saving;
  },
});

async function changeSearch(input: { dealbreakers?: Partial<z.infer<typeof S.Dealbreakers>>; addPreferences?: string[]; importantPreferences?: string[]; removePreferences?: string[] }, c: Ctx) {
  const { db, user } = who(c);
  const st = await load(db, user), cur = view(st).search;
  const prefs = cur.preferences.filter((p) => !(input.removePreferences ?? []).some((r) => r.toLowerCase() === p.label.toLowerCase()));
  for (const label of input.addPreferences ?? []) if (!prefs.some((p) => p.label.toLowerCase() === label.toLowerCase())) prefs.push({ id: `p_${crypto.randomUUID().slice(0, 6)}`, label, weight: 'nice' });
  for (const label of input.importantPreferences ?? []) {
    const p = prefs.find((x) => x.label.toLowerCase() === label.toLowerCase());
    if (p) p.weight = 'important'; else prefs.push({ id: `p_${crypto.randomUUID().slice(0, 6)}`, label, weight: 'important' });
  }
  st.search = applySearch(cur, { dealbreakers: input.dealbreakers, preferences: prefs });
  await save(db, user, st);
  await emit(c, 'data-search-updated', { changed: Object.keys(input.dealbreakers ?? {}), dealbreakers: st.search.dealbreakers });
  const d = st.search.dealbreakers, unknown = [...d.areas, ...(d.excludeAreas ?? [])].filter((a) => !knownArea(a));
  return { summary: summarize(st.search), dealbreakers: d, preferences: prefs.map((p) => `${p.label} (${p.weight})`),
           ...(unknown.length && { unknownAreas: unknown, note: 'Not neighbourhoods I know; these only match listings whose neighbourhood says exactly that. Check the spelling with the user.' }) };
}

export const searchListings = createTool({
  id: 'searchListings',
  description: "Search the real NYC rental listings Fred has collected from StreetEasy, Zillow, RentHop, Zumper, Craigslist, Compass, Nooklyn and landlord sites. It always searches inside the saved search (areas, excluded areas, budget, beds, baths, pets, fee); your filters can only narrow it. To look outside it, updateSearch first. Results come best fit first. Each match comes with highlights (deal vs the area's usual rent, laundry, outdoor space, pets, light), and a buildingWarning only when the city record is bad. Areas are neighbourhood or borough names.",
  inputSchema: z.object({
    areas: z.array(z.string()).optional().describe('e.g. ["williamsburg", "greenpoint"] or ["brooklyn"]'),
    maxRent: z.number().optional(), minBeds: z.number().optional(), minBaths: z.number().optional(),
    noFeeOnly: z.boolean().optional(), minBuildingScore: z.number().optional().describe('0-100; 60+ avoids buildings with many city complaints'),
    pets: z.enum(['dogs', 'cats', 'dogs_and_cats']).optional().describe("The user's pets. Drops places that say no; places that don't say stay in"),
    limit: z.number().optional().describe('Default 15, max 40'),
  }),
  execute: async (input, c) => {
    const { db, user } = who(c as Ctx);
    await (c as Ctx).requestContext?.get('savingSearch');
    const saved = view(await load(db, user)).search, r = await search(db, saved, input);
    for (const l of r.found) seen(c as Ctx).add(l.listingId);
    const areas = input.areas?.length ? input.areas : saved.dealbreakers.areas;
    const where = areas.length ? areas.join(', ') : 'all of NYC';
    await emit(c as Ctx, 'data-scan', { checked: r.total, matched: r.found.length, hidden: 0, steps: [{ label: `Searched ${where}${input.maxRent ? ` up to $${input.maxRent.toLocaleString('en-US')}` : ''}`, toolCallId: null }] });
    // Ids are "op_317", the same as inbox places and place: links. A bare number sat next to
    // addresses like "1584 Bushwick Ave" and Fred mixed the two up.
    return { matching: r.total, showing: r.found.length, listings: r.found.map(({ listingId, ...l }) => ({ id: `op_${listingId}`, ...l })),
             ...(r.outside.length && { outsideSearch: r.outside, note: 'These areas are outside the saved search, so nothing there was searched. If the user wants them, updateSearch first.' }) };
  },
});

export const addToInbox = createTool({
  id: 'addToInbox',
  description: "Put listings from searchListings into the user's inbox as places, each with your verdict. Use likely_scam to hide a suspicious one with the reason. Over-budget ones can still go in with over_budget_with_fees.",
  inputSchema: z.object({
    places: z.array(z.object({
      id: z.string().regex(/^op_\d+$/).describe('The id from searchListings, like "op_317"'),
      verdict: S.Verdict.shape.kind,
      fit: z.number().min(0).max(100).describe('How well it fits this user'),
      highlight: z.string().nullable().optional().describe('The one feature this user will care about most, e.g. "Washer/dryer in unit"'),
      reason: z.string().nullable().optional().describe('Short reason shown on the card, mainly for warnings'),
    })).min(1).max(20),
  }),
  execute: async ({ places: picked }, c) => {
    const { db, user } = who(c as Ctx);
    const places = picked.map((p) => ({ ...p, listingId: Number(p.id.slice(3)) }));
    const { st, v, cards } = await real(db, user);
    // Fred's verdict replaces an earlier one for the same place
    const redo = new Set(places.filter((p) => seen(c as Ctx).has(p.listingId)).map((p) => `op_${p.listingId}`));
    st.created = (st.created ?? []).filter((x) => !redo.has(x.id));
    const existing = new Set<string>();
    const added: Card[] = [], known = seen(c as Ctx);
    const rejected = places.filter((p) => !known.has(p.listingId)).map((p) => p.id);
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
  description: "Turn alerts on or off, choose how often, and set where they go. Giving a new email address saves it unverified and emails it a 6-digit code; then ask the user for the code. Texts aren't available yet: a phone number can be saved, but nothing is sent to it.",
  inputSchema: z.object({
    mode: S.AlertMode.optional().describe('instant_strong: strong fits right away; daily: one digest; off'),
    email: z.string().email().optional().describe('Where to email alerts'),
    emailOn: z.boolean().optional().describe('Turn email alerts on or off (only sends once the address is verified)'),
    phone: z.string().optional().describe('For texts later. US numbers can be 10 digits.'),
    quietHours: z.object({ start: z.string(), end: z.string() }).nullable().optional().describe('New York time, HH:MM'),
  }),
  execute: async (input, c) => {
    const { env } = who(c as Ctx), user = env.ME;
    try {
      const { alerts, codeSent } = await patchAlerts(env, user, {
        mode: input.mode, quietHours: input.quietHours,
        email: input.email !== undefined || input.emailOn !== undefined ? { address: input.email, enabled: input.emailOn } : undefined,
        sms: input.phone !== undefined ? { number: input.phone } : undefined,
      });
      return { alerts, ...(codeSent && { codeSentTo: codeSent.sentTo, next: 'Ask the user for the 6-digit code from that email, then call verifyAlerts.' }),
        ...(input.phone && { note: "Saved the number. Texts aren't available yet, so alerts go by email for now." }) };
    } catch (e) {
      if (e instanceof AlertError) return { error: e.message };
      throw e;
    }
  },
});

export const verifyAlerts = createTool({
  id: 'verifyAlerts',
  description: 'Check the 6-digit code the user got by email. On success, alerts to that address are on.',
  inputSchema: z.object({ channel: S.AlertChannel.default('email'), code: z.string().regex(/^\d{6}$/) }),
  execute: async ({ channel, code }, c) => {
    const { env } = who(c as Ctx);
    try { return { verified: true, alerts: await verifyCode(env, env.ME, channel, code) }; }
    catch (e) { if (e instanceof AlertError) return { verified: false, error: e.message }; throw e; }
  },
});

export const sendTestAlert = createTool({
  id: 'sendTestAlert',
  description: 'Email an example alert with the best places in their inbox, so they can see what alerts look like. Only after the address is verified.',
  inputSchema: z.object({}),
  execute: async (_in, c) => {
    const { env, db } = who(c as Ctx), user = env.ME;
    try {
      const st = await load(db, user), v = view(st);
      return await sendTest(env, user, 'email', await examplePlaces(db, await inbox(db, user, st, v.search)), summarize(v.search));
    } catch (e) { if (e instanceof AlertError) return { error: e.message }; throw e; }
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

export const updateMemory = createTool({
  id: 'updateMemory',
  description: `Keep your notes on this person: what they like, dislike and need in a place, their life (work, partner, pets, commute), timing, and how they like you to work. Your current notes come with each message, with ids.
Write what you understood, not what they said: "I'm ok with 1 bath" becomes "Prefers 2 baths; 1 is acceptable" (likes, strong). One fact per note, third person, under 160 characters.
When something refines or contradicts a note, update that note; don't add a second one. Remove notes they take back ("forget that", "actually I don't care about X").
from: "said" when they told you, "inferred" when you read it from their saves and passes (use mild, and only once the pattern is clear).`,
  inputSchema: z.object({
    add: z.array(z.object({ kind: S.MemoryKind, text: z.string(), strength: S.Memory.shape.strength, from: S.Memory.shape.from.optional() })).optional(),
    update: z.array(z.object({ id: z.string(), text: z.string().optional(), kind: S.MemoryKind.optional(), strength: S.Memory.shape.strength.optional() })).optional(),
    remove: z.array(z.string()).optional().describe('Note ids to forget'),
  }),
  execute: async (input, c) => {
    const { db, user } = who(c as Ctx);
    const st = await load(db, user);
    const said = (c as Ctx).requestContext?.get('said') as string | undefined;
    const { notes, refused } = writeMemory(st, input, said);
    await save(db, user, st);
    return { notes: notes.map((n) => `${n.id} ${n.kind} (${n.strength}${n.from === 'inferred' ? ', inferred' : ''}): ${n.text}`),
             ...(refused.length ? { refused, fix: 'Rewrite the refused ones and call updateMemory again.' } : {}) };
  },
});

export const updateProfile = createTool({
  id: 'updateProfile',
  description: 'Change the name the app shows for this person, when they ask ("call me Jim").',
  inputSchema: z.object({ name: S.MePatch.shape.name.unwrap() }),
  execute: async ({ name }, c) => {
    const { db, user } = who(c as Ctx);
    const st = await load(db, user);
    st.profile = { ...st.profile, name };
    await save(db, user, st);
    return { name };
  },
});

export const listTours = createTool({
  id: 'listTours',
  description: 'The tours this person has: drafts, requested, confirmed, done and cancelled, with their place ids and times.',
  inputSchema: z.object({}),
  execute: async (_in, c) => {
    const { db, user } = who(c as Ctx);
    return { tours: view(await load(db, user)).tours };
  },
});

export const updateTour = createTool({
  id: 'updateTour',
  description: 'Change a tour when the user tells you about it: the confirmed time, a status (requested once they sent it, confirmed, done, cancelled), or notes. You never contact anyone; this only records it.',
  inputSchema: z.object({ id: z.string().describe('Tour id, like tour_1a2b3c4d'), status: S.Tour.shape.status.optional(),
                          startsAt: z.string().nullable().optional().describe('ISO date-time, New York time'), notes: z.string().nullable().optional() }),
  execute: async ({ id, ...patch }, c) => {
    const { db, user } = who(c as Ctx);
    const st = await load(db, user), v = view(st), t = v.tours.find((x) => x.id === id);
    if (!t) return { error: `No tour ${id}. listTours shows their tours.` };
    const next = { ...t, ...Object.fromEntries(Object.entries(patch).filter(([, x]) => x !== undefined)) };
    st.tours = v.tours.map((x) => (x.id === id ? next : x));
    await save(db, user, st);
    return { tour: next };
  },
});

export const tools = { getSearch, updateSearch, searchListings, addToInbox, listInbox, getPlace, updatePlace, requestTour, setAlerts, verifyAlerts, sendTestAlert, suggestReplies, researchWeb, readListingPage, checkSites, crawlStatus, updateMemory, updateProfile, listTours, updateTour };
