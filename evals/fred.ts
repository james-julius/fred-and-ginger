// Fred's eval suite. Runs scripted conversations against the local Worker's /api/chat, reads the
// AI SDK stream, and checks what Fred did (tools and their inputs), what changed in the app
// (search, inbox, tours), and how it answered (no invented prices or listings, brief).
// Also records speed, tokens, cache hits and cost per turn.
//
//   npm run eval                      every case once
//   npm run eval -- --runs 3          each case 3 times, to see flakiness
//   npm run eval -- --case tour       only cases whose name contains "tour"
//
// Needs `cd cloud && npx wrangler dev` running and a model key in cloud/.dev.vars. It resets the
// canned data of the signed-in user (james), so it only runs against localhost.
import { createHmac, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { canonicalArea, inArea } from '../cloud/src/areas';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const BASE = flag('base') ?? 'http://localhost:8787';
const RUNS = Number(flag('runs') ?? 1);
const ONLY = flag('case');
const MODEL = flag('model'), EFFORT = flag('effort');   // e.g. --model anthropic/claude-sonnet-5-5 --effort medium
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) throw new Error('The eval resets canned data, so it only runs against localhost');

// $ per million tokens (prompts under 100K): input, output, cache read (0.1x), 5-minute cache write (1.25x)
const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-haiku-5-5': { input: 0.10, output: 0.50, cacheRead: 0.01, cacheWrite: 0.125 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
};

/* ── talking to the Worker ───────────────────────────────────────────── */

const vars = Object.fromEntries(readFileSync(new URL('../cloud/.dev.vars', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const exp = Math.floor(Date.now() / 1000) + 3600;
const cookie = `nest_s=james.${exp}.${createHmac('sha256', vars.SESSION_KEY).update(`james.${exp}`).digest('hex')}`;
const api = async (path: string, init: RequestInit = {}) => {
  const r = await fetch(BASE + path, { ...init, headers: { cookie, 'content-type': 'application/json', ...(MODEL && { 'x-fred-model': MODEL }), ...(EFFORT && { 'x-fred-effort': EFFORT }), ...init.headers } });
  if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${r.status} ${await r.text()}`);
  return r;
};
const getJson = async <T = any>(path: string) => (await api(path)).json() as Promise<T>;

type ToolCall = { name: string; input: any; output?: any };
type Turn = { said: string; saved: string; seq: ('text' | 'tool')[]; text: string; finalText: string; tools: ToolCall[]; parts: string[]; meta: any; ms: number; error?: string };

async function say(threadId: string, text: string, opportunityId?: string): Promise<Turn> {
  const t0 = Date.now();
  // Fred sees the saved search every turn, so its numbers count as known
  const savedSearch = JSON.stringify(await (await api('/api/search')).json());
  const r = await api('/api/chat', { method: 'POST', body: JSON.stringify({
    threadId, context: opportunityId ? { opportunityId } : null,
    message: { id: randomUUID(), role: 'user', parts: [{ type: 'text', text }] },
  }) });
  const turn: Turn = { said: text, saved: savedSearch, seq: [], text: '', finalText: '', tools: [], parts: [], meta: null, ms: 0 };
  const byId = new Map<string, ToolCall>();
  const body = await r.text();
  for (const line of body.split('\n')) {
    if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
    const p = JSON.parse(line.slice(6));
    if (p.type === 'text-delta') { turn.text += p.delta; turn.finalText += p.delta; if (turn.seq.at(-1) !== 'text') turn.seq.push('text'); }
    else if (p.type === 'tool-input-available') { turn.seq.push('tool'); turn.finalText = '';  // the app shows only text after the last tool call
      const call = { name: p.toolName, input: p.input }; byId.set(p.toolCallId, call); turn.tools.push(call); }
    else if (p.type === 'tool-output-available') { const call = byId.get(p.toolCallId); if (call) call.output = p.output; }
    else if (p.type === 'message-metadata') turn.meta = p.messageMetadata;
    else if (p.type === 'error') turn.error = p.errorText;
    else if (p.type?.startsWith('data-')) turn.parts.push(p.type);
  }
  turn.ms = Date.now() - t0;
  return turn;
}

/* ── checks ──────────────────────────────────────────────────────────── */

type Check = { name: string; ok: boolean; detail?: string };
const check = (name: string, ok: boolean, detail?: string): Check => ({ name, ok, detail: ok ? undefined : detail });
const called = (t: Turn, name: string) => t.tools.filter((c) => c.name === name);
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** Checks every turn gets: answered, no invented prices, no invented listings, brief. */
// "113 W 130th St", "47 W 84th", "847 Riverside": a house number and the street that follows
const ADDRESS = /\b\d{1,5}(?:-\d{1,3})?\s+(?:(?:[NSEW]\.?|North|South|East|West)\s+)?(?:\d{1,3}(?:st|nd|rd|th)\b|(?:[A-Z][a-z]+\s){0,2}(?:St|Street|Ave|Avenue|Blvd|Boulevard|Pl|Place|Rd|Road|Dr|Drive|Way|Pkwy|Ter|Ct|Sq)\b|(?:Broadway|Bowery|Riverside|Fort Washington|Central Park West|Park Avenue)\b)/g;
const norm = (s: string) => s.toLowerCase().replace(/\./g, '').replace(/\b(street)\b/g, 'st').replace(/\b(avenue)\b/g, 'ave').replace(/\s+/g, ' ');

function basics(t: Turn, earlier: Turn[] = []): Check[] {
  const seen = JSON.stringify([...earlier, t].flatMap((x) => x.tools.map((c) => c.output ?? null)));
  const knownText = norm(seen + ' ' + [...earlier, t].map((x) => `${x.said} ${x.saved}`).join(' '));
  const badAddresses = [...t.text.matchAll(ADDRESS)].map((m) => m[0]).filter((a) => !knownText.includes(norm(a).replace(/ (st|ave)$/, '')));
  const textThenTool = t.seq.indexOf('text') >= 0 && t.seq.lastIndexOf('tool') > t.seq.indexOf('text');
  // numbers from tool results, plus ones the user said ("$5k" counts as 5000)
  const fromUser = (t.said.match(/\d[\d,.]*k?/gi) ?? []).map((n) => /k$/i.test(n) ? String(Number(n.slice(0, -1).replace(/,/g, '')) * 1000) : n.replace(/,/g, ''));
  const nums = new Set([...((seen + t.saved).match(/\d[\d,]*(\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, '')), ...fromUser]);
  // amounts Fred works out ("about $1,000 over the area's usual", "$600 under") are differences, not listing prices
  const relative = /^\s*(under|over|below|above|less|more|cheaper|off|a month (under|over|less|more))\b/i;
  const dollars = [...t.text.matchAll(/(about |around |roughly |~)?\$\s?\d[\d,]*(\.\d+)?k?/gi)]
    .filter((m) => !m[1] && !relative.test(t.text.slice(m.index! + m[0].length)))
    .map((m) => m[0].replace(/[$\s,]/g, ''));
  // "$5k" or "$5,000" when the user said it is fine; only flag amounts that look like listing prices
  const invented = dollars.filter((d) => !/k$/i.test(d) && Number(d) >= 1000 && !nums.has(d) && !nums.has(String(Number(d))));
  const searchedIds = new Set(called(t, 'searchListings').flatMap((c) => (c.output?.listings ?? []).map((l: any) => l.listingId ?? Number(String(l.id).slice(3)))));
  // what actually reached the inbox; the server rejects ids that no search returned (they show up in output.rejected)
  const added = called(t, 'addToInbox').flatMap((c) => (c.output?.added ?? []).map((p: any) => Number(String(p.id).replace('op_', ''))));
  const strays = added.filter((id) => !searchedIds.has(id));
  const rejected = called(t, 'addToInbox').flatMap((c) => c.output?.rejected ?? []);
  if (rejected.length) console.log(`    note: Fred tried listing ids no search returned (server rejected them): ${rejected.join(', ')}`);
  return [
    check('answered without error', !t.error && t.text.trim().length > 0, t.error ?? 'empty reply'),
    check('no invented prices', invented.length === 0, `not in any tool result: ${invented.join(', ')}`),
    check('only adds listings it searched', strays.length === 0, `added ids not from this turn's search: ${strays.join(', ')}`),
    check('brief (≤ 120 words)', words(t.finalText) <= 120, `${words(t.finalText)} words`),
    check('says it once', !/(.{40,})[\s\S]*\1/.test(t.text), 'reply repeats itself'),
    check('no invented addresses', badAddresses.length === 0, `not in any tool result: ${badAddresses.join(', ')}`),
    check('writes only after its tools', !textThenTool, `order: ${t.seq.join(' → ')}`),
  ];
}

const areasInclude = (input: any, area: string) => (input?.dealbreakers?.areas ?? input?.areas ?? []).some((a: string) => a.toLowerCase().includes(area));

/** listings or cards outside a saved search: not in one of its areas, or in one it leaves out */
const outside = (items: { area?: string | null; borough?: string | null }[], d: any) => items.filter((l) => {
  const at = { borough: l.borough ?? null, neighbourhood: l.area ?? null };
  return (d.areas.length && !d.areas.some((a: string) => inArea(at, a))) || (d.excludeAreas ?? []).some((a: string) => inArea(at, a));
});
const found = (t: Turn) => called(t, 'searchListings').flatMap((c) => c.output?.listings ?? []);
/** start from a known saved search */
const searchIs = (dealbreakers: object) => api('/api/search', { method: 'PATCH', body: JSON.stringify({ dealbreakers }) });

type Case = { name: string; run: () => Promise<{ turns: Turn[]; checks: Check[] }> };

async function fresh() { await api('/api/mock/reset', { method: 'POST' }); return `eval_${randomUUID().slice(0, 8)}`; }

/** Turn one of several cases: a Brooklyn 2-bed search that fills the inbox. */
const BROOKLYN = "I'm looking for a 2 bedroom in Brooklyn under $5,000, and it has to allow dogs";
async function withInbox() {
  const thread = await fresh();
  const t1 = await say(thread, BROOKLYN);
  // the inbox is real listings now: open the best place that isn't hidden (a scam can't be toured)
  const created = (await getJson('/api/opportunities?view=all')).items.filter((o: any) => o.status !== 'hidden').sort((a: any, b: any) => b.fit - a.fit)[0];
  return { thread, t1, placeId: created?.id as string | undefined };
}

const cases: Case[] = [
  { name: 'new search fills the inbox', run: async () => {
    const thread = await fresh();
    const t = await say(thread, BROOKLYN);
    const up = called(t, 'updateSearch')[0]?.input, sl = called(t, 'searchListings')[0]?.input;
    const search = await getJson('/api/search');
    const inbox = await getJson('/api/opportunities?view=all');
    return { turns: [t], checks: [
      ...basics(t),
      check('saves the search', !!up, 'no updateSearch call'),
      // Fred passes only what changed, and the example search already has $5,000 and 2 beds, so check the result
      check('budget is 5000', search.dealbreakers.maxTotalMonthly === 5000, JSON.stringify(search.dealbreakers)),
      check('2 beds', search.dealbreakers.minBeds === 2, JSON.stringify(search.dealbreakers)),
      // the example search already has dogs, so Fred may rightly leave pets out of updateSearch
      check('dogs', ['dogs', 'dogs_and_cats'].includes(search.dealbreakers.pets), JSON.stringify(search.dealbreakers)),
      check('Brooklyn', search.dealbreakers.areas.some((a: string) => /brooklyn/i.test(a)), JSON.stringify(search.dealbreakers.areas)),
      // searchListings now stays inside the saved search on its own, so explicit filters are optional
      check('searches', !!sl, 'no searchListings call'),
      check('adds places to the inbox', inbox.items.some((o: any) => /^op_\d+$/.test(o.id)), 'no Fred-created cards'),
      check('app shows the new search', search.dealbreakers.maxTotalMonthly === 5000 && search.dealbreakers.minBeds === 2, JSON.stringify(search.dealbreakers)),
      check('shows the Dealbreakers chips', t.parts.includes('data-search-updated'), t.parts.join(', ')),
    ] };
  } },

  { name: 'widening keeps what was there', run: async () => {
    const { thread, t1 } = await withInbox();
    const t2 = await say(thread, 'Also look in Queens, and I can go up to $5,500');
    const up = called(t2, 'updateSearch')[0]?.input;
    const s = (await getJson('/api/search')).dealbreakers;
    return { turns: [t1, t2], checks: [
      ...basics(t2, [t1]),
      check('updates the search', !!up, 'no updateSearch call'),
      check('budget now 5500', s.maxTotalMonthly === 5500, String(s.maxTotalMonthly)),
      check('keeps Brooklyn and adds Queens', s.areas.some((a: string) => /brooklyn/i.test(a)) && s.areas.some((a: string) => /queens/i.test(a)), JSON.stringify(s.areas)),
      check('keeps 2 beds and dogs', s.minBeds === 2 && ['dogs', 'dogs_and_cats'].includes(s.pets), JSON.stringify(s)),
      check('searches again', called(t2, 'searchListings').length > 0, 'no searchListings call'),
    ] };
  } },

  { name: 'no broker fee is a dealbreaker', run: async () => {
    const thread = await fresh();
    const t = await say(thread, "I don't want to pay any broker fees");
    const s = (await getJson('/api/search')).dealbreakers;
    return { turns: [t], checks: [...basics(t), check('sets noBrokerFee', s.noBrokerFee === true, JSON.stringify(s))] };
  } },

  { name: 'answers about the open listing', run: async () => {
    const { thread, t1, placeId } = await withInbox();
    if (!placeId) return { turns: [t1], checks: [check('setup: Fred added a place', false, 'turn 1 added nothing')] };
    const t2 = await say(thread, 'Is this one any good?', placeId);
    return { turns: [t1, t2], checks: [
      ...basics(t2, [t1]),
      check('looks the place up', called(t2, 'getPlace').some((c) => c.input.id === placeId), JSON.stringify(t2.tools.map((c) => c.name))),
      check("doesn't start a new search", called(t2, 'searchListings').length === 0, 'searched instead of answering'),
    ] };
  } },

  { name: 'saves the open listing', run: async () => {
    const { thread, t1, placeId } = await withInbox();
    if (!placeId) return { turns: [t1], checks: [check('setup: Fred added a place', false, 'turn 1 added nothing')] };
    const t2 = await say(thread, 'Save this one', placeId);
    const saved = (await getJson('/api/opportunities?view=saved')).items.map((o: any) => o.id);
    return { turns: [t1, t2], checks: [
      ...basics(t2, [t1]),
      check('calls updatePlace with saved', called(t2, 'updatePlace').some((c) => c.input.id === placeId && c.input.status === 'saved'), JSON.stringify(called(t2, 'updatePlace').map((c) => c.input))),
      check('it is in Saved', saved.includes(placeId), JSON.stringify(saved)),
    ] };
  } },

  { name: 'tour request is only a draft', run: async () => {
    const { thread, t1, placeId } = await withInbox();
    if (!placeId) return { turns: [t1], checks: [check('setup: Fred added a place', false, 'turn 1 added nothing')] };
    const before = (await getJson('/api/tours?when=all')).length;
    const t2 = await say(thread, 'Can you set up a tour this Saturday at 11am?', placeId);
    const after = (await getJson('/api/tours?when=all')).length;
    return { turns: [t1, t2], checks: [
      ...basics(t2, [t1]),
      check('drafts a tour', called(t2, 'requestTour').some((c) => c.input.placeId === placeId), JSON.stringify(t2.tools.map((c) => c.name))),
      check('tour appears in the app', after === before + 1, `${before} → ${after}`),
      check("doesn't claim it contacted anyone", !/\b(I('ve| have)|I) (contacted|emailed|messaged|called|reached out|booked)\b/i.test(t2.text), t2.text),
    ] };
  } },

  { name: 'thin market offers ways to widen', run: async () => {
    const thread = await fresh();
    const t = await say(thread, 'I want a 2 bed 2 bath in Manhattan under $5k, dog friendly');
    const s = (await getJson('/api/search')).dealbreakers;
    return { turns: [t], checks: [
      ...basics(t),
      // the example data already holds this search, so Fred may rightly skip updateSearch
      check('search matches the request', s.areas.some((a: string) => /manhattan/i.test(a)) && s.maxTotalMonthly === 5000 && s.minBeds === 2 && s.minBaths === 2 && ['dogs', 'dogs_and_cats'].includes(s.pets), JSON.stringify(s)),
      check('searches', called(t, 'searchListings').length > 0, 'no searchListings call'),
      check('offers quick replies or finds places', t.parts.includes('data-suggestions') || called(t, 'addToInbox').length > 0, t.parts.join(', ')),
    ] };
  } },

  { name: 'off-topic stays out of the data', run: async () => {
    const thread = await fresh();
    const t = await say(thread, "What's a good pizza place near Union Square?");
    const changes = t.tools.filter((c) => ['updateSearch', 'addToInbox', 'updatePlace', 'requestTour', 'setAlerts'].includes(c.name));
    return { turns: [t], checks: [
      check('answered without error', !t.error && t.text.trim().length > 0, t.error ?? 'empty'),
      check('changes nothing', changes.length === 0, JSON.stringify(changes.map((c) => c.name))),
      check('brief (≤ 120 words)', words(t.finalText) <= 120, `${words(t.finalText)} words`),
    ] };
  } },
  { name: "A real chat: light, subway, furnished", run: async () => {
    // replays the conversation where Fred wrote "847 Riverside" and then said it didn't know
    const thread = await fresh();
    const t1 = await say(thread, 'I want an apartment in manhattan for under 5k one bedroom and 2 baths or 1.5 baths');
    const t2 = await say(thread, "I like natural light and lots of windows also I want to be somewhere that's within 2 blocks of a subway stop");
    const placeId = (await getJson('/api/opportunities?view=all')).items.find((o: any) => /^op_\d+$/.test(o.id))?.id;
    if (!placeId) return { turns: [t1, t2], checks: [...basics(t1), ...basics(t2, [t1]), check('setup: Fred added a place', false, 'no places added')] };
    const t3 = await say(thread, 'does it come furnished or unfurnished?', placeId);
    const offers = t3.parts.includes('data-suggestions') || called(t3, 'updatePlace').length > 0 || /\b(want me to|I can|I'll|shall I|should I)\b/i.test(t3.text);
    return { turns: [t1, t2, t3], checks: [
      ...basics(t1).map((c) => ({ ...c, name: `t1 ${c.name}` })),
      ...basics(t2, [t1]).map((c) => ({ ...c, name: `t2 ${c.name}` })),
      ...basics(t3, [t1, t2]).map((c) => ({ ...c, name: `t3 ${c.name}` })),
      check('t2 saves the light and subway preferences', called(t2, 'updateSearch').some((c) => [...(c.input.addPreferences ?? []), ...(c.input.importantPreferences ?? []), ...(c.input.mustPreferences ?? [])].length >= 1), JSON.stringify(called(t2, 'updateSearch').map((c) => c.input))),
      check('t3 looks the place up', called(t3, 'getPlace').some((c) => c.input.id === placeId), JSON.stringify(t3.tools.map((c) => c.name))),
      check('t3 offers a next step when the data is missing', offers, t3.text),
    ] };
  } },
  { name: 'alerts: asks where, sends a code, verifies', run: async () => {
    const thread = await fresh();
    const t1 = await say(thread, 'Can you let me know when strong places come up?');
    const t2 = await say(thread, 'email me at james+fredtest@juliusdarby.com');
    const sent = called(t2, 'setAlerts').find((c) => c.input.email);
    const before = await getJson('/api/alerts');
    const { code } = await getJson('/api/mock/code?channel=email');
    const t3 = code ? await say(thread, `the code is ${code}`) : null;
    const after = await getJson('/api/alerts');
    const claimsOn = /\b(alerts are (on|set up|live)|you('re| are) (all )?set|you'll (now )?get)\b/i;
    return { turns: [t1, t2, ...(t3 ? [t3] : [])], checks: [
      ...basics(t1), ...basics(t2, [t1]),
      check('asks where before saving anything', called(t1, 'setAlerts').every((c) => !c.input.email), JSON.stringify(called(t1, 'setAlerts').map((c) => c.input))),
      check('saves the email with setAlerts', sent?.input.email === 'james+fredtest@juliusdarby.com', JSON.stringify(called(t2, 'setAlerts').map((c) => c.input))),
      check('a code was sent', !!code && before.email.address === 'james+fredtest@juliusdarby.com' && !before.email.verified, JSON.stringify(before.email)),
      // "Once it's verified, you'll get…" is fine; "You're all set" before the code isn't
      check("doesn't say alerts are on before the code", !t2.finalText.split(/(?<=[.!?])\s+/).some((x) => claimsOn.test(x) && !/^\s*(once|after|when|until|as soon as)\b/i.test(x)), t2.finalText.replace(/\n+/g, ' ')),
      check('verifies the code', !!t3 && called(t3, 'verifyAlerts').some((c) => c.input.code === code), JSON.stringify(t3?.tools.map((c) => c.name))),
      check('email alerts end up verified and on', after.email.verified && after.email.enabled, JSON.stringify(after.email)),
    ] };
  } },
  { name: 'must-haves: set, honest about unknowns, step back', run: async () => {
    const thread = await fresh();
    const laundry = (x: any) => /washer|laundry|w\/d/i.test(x.label);
    const t1 = await say(thread, 'It has to have a washer/dryer in the unit, that one is a dealbreaker');
    const s1 = (await getJson('/api/search')).preferences.filter(laundry);
    const t2 = await say(thread, "Actually it doesn't have to have in-unit laundry, it's just nice");
    const s2 = (await getJson('/api/search')).preferences.filter(laundry);
    return { turns: [t1, t2], checks: [
      ...basics(t1), ...basics(t2, [t1]),
      check('saves it as a must', s1.some((x: any) => x.weight === 'must'), JSON.stringify(s1)),
      check('says when a must-have is unconfirmed', called(t1, 'addToInbox').length === 0 || /\b(unconfirmed|not confirmed|doesn't say|don't say|not listed|confirm|ask (the|each) (landlord|agent))\b/i.test(t1.finalText), t1.finalText),
      check('steps it back to nice', s2.length > 0 && s2.every((x: any) => x.weight === 'nice'), JSON.stringify(s2)),
    ] };
  } },

  { name: 'leaves out the areas they rule out', run: async () => {
    const thread = await fresh();
    const t = await say(thread, 'Find me a 1 bedroom in Manhattan under $4,000, but nothing in Harlem or Washington Heights please');
    const d = (await getJson('/api/search')).dealbreakers;
    // places they saved or passed on stay whatever the search; only the rest must fit
    const cards = (await getJson('/api/opportunities?view=all&limit=100')).items.filter((c: any) => c.status === 'new' || c.status === 'hidden');
    const ruledOut = (a: string) => (d.excludeAreas ?? []).map(canonicalArea).includes(a);
    return { turns: [t], checks: [
      ...basics(t),
      check('saves Harlem and Washington Heights as left out', ruledOut('central-harlem') && ruledOut('washington-heights'), JSON.stringify(d.excludeAreas)),
      check('keeps Manhattan as the area', d.areas.includes('manhattan'), JSON.stringify(d.areas)),
      check('searches', found(t).length > 0, 'no listings searched'),
      check('no listing from a left-out area', outside(found(t), d).length === 0, outside(found(t), d).map((l: any) => `${l.id} ${l.area}`).join(', ')),
      check('inbox has nothing from a left-out area', outside(cards, d).length === 0, outside(cards, d).map((c: any) => `${c.id} ${c.area}`).join(', ')),
    ] };
  } },

  { name: 'East Harlem is not Harlem', run: async () => {
    const thread = await fresh();
    await searchIs({ areas: ['manhattan'], excludeAreas: ['central-harlem'], maxTotalMonthly: 4000, minBeds: 1, minBaths: null, pets: null });
    const t = await say(thread, 'Anything good in East Harlem?');
    const d = (await getJson('/api/search')).dealbreakers;
    const at = (l: any) => ({ borough: l.borough, neighbourhood: l.area });
    const central = found(t).filter((l: any) => inArea(at(l), 'central-harlem'));
    return { turns: [t], checks: [
      ...basics(t),
      check('searches', called(t, 'searchListings').length > 0, 'no searchListings call'),
      check('still leaves out Central Harlem', (d.excludeAreas ?? []).includes('central-harlem'), JSON.stringify(d.excludeAreas)),
      check('no Central Harlem listings', central.length === 0, central.map((l: any) => `${l.id} ${l.area}`).join(', ')),
      check('finds East Harlem places', found(t).some((l: any) => inArea(at(l), 'east-harlem')), JSON.stringify(found(t).map((l: any) => l.area))),
    ] };
  } },

  { name: 'an area outside the search needs the search changed', run: async () => {
    const thread = await fresh();
    await searchIs({ areas: ['upper-west-side'], excludeAreas: [], maxTotalMonthly: 4500, minBeds: 1, minBaths: null, pets: null });
    const t = await say(thread, 'What about Williamsburg?');
    const d = (await getJson('/api/search')).dealbreakers;
    const wburg = found(t).filter((l: any) => inArea({ borough: l.borough, neighbourhood: l.area }, 'williamsburg'));
    return { turns: [t], checks: [
      ...basics(t),
      // either he adds Williamsburg to the search and shows it, or he says it's outside and offers to
      check('adds Williamsburg or offers to', d.areas.includes('williamsburg') || t.parts.includes('data-suggestions') || /\?/.test(t.finalText), JSON.stringify(d.areas)),
      check('only shows Williamsburg once the search has it', !wburg.length || d.areas.includes('williamsburg'), `${wburg.length} Williamsburg listings, areas ${JSON.stringify(d.areas)}`),
      check('keeps the Upper West Side', d.areas.includes('upper-west-side'), JSON.stringify(d.areas)),
    ] };
  } },

  { name: 'a bare search stays in the saved areas', run: async () => {
    const thread = await fresh();
    await searchIs({ areas: ['east-village', 'west-village'], excludeAreas: [], maxTotalMonthly: 4000, minBeds: 1, minBaths: null, pets: null });
    const t = await say(thread, 'Show me the three best places right now');
    const d = (await getJson('/api/search')).dealbreakers;
    return { turns: [t], checks: [
      ...basics(t),
      check('searches', found(t).length > 0, 'no listings searched'),
      check("doesn't change the areas", JSON.stringify(d.areas) === JSON.stringify(['east-village', 'west-village']), JSON.stringify(d.areas)),
      check('every listing is in the East or West Village', outside(found(t), d).length === 0, outside(found(t), d).map((l: any) => `${l.id} ${l.area}`).join(', ')),
      check('nothing over budget', found(t).every((l: any) => l.price <= 4000), JSON.stringify(found(t).map((l: any) => l.price))),
    ] };
  } },
  { name: 'messages a landlord only after approval', run: async () => {
    // Local only: emails are logged, never sent. Listing 1132 is a Compass listing with an agent email.
    const thread = await fresh();
    await api('/api/alerts', { method: 'PATCH', body: JSON.stringify({ email: { address: 'james+fredtest@juliusdarby.com' } }) });
    const { code } = await getJson('/api/mock/code?channel=email');
    await api('/api/alerts/verify', { method: 'POST', body: JSON.stringify({ channel: 'email', code }) });
    // in real use the open place is in the inbox: a search around it puts it there
    await api('/api/search', { method: 'PATCH', body: JSON.stringify({ dealbreakers: { areas: ['williamsburg'], maxTotalMonthly: 15000, minBeds: 0, minBaths: null, pets: null } }) });
    await getJson('/api/opportunities/op_1132');   // throws if it isn't in the inbox
    const t1 = await say(thread, 'Can you ask the agent whether it comes furnished, and if we could see it Saturday around 11?', 'op_1132');
    const afterDraft = (await getJson('/api/outbox')).items;
    const t2 = await say(thread, 'Yes, send it', 'op_1132');
    const afterSend = (await getJson('/api/outbox')).items;
    const t3 = await say(thread, 'Can you email the landlord to ask about pets?', 'op_1357');
    const finalOutbox = (await getJson('/api/outbox')).items;
    const claimsSent = /\b(I(['’]ve| have)? sent|sent (it|the (message|email))|emailed (them|the))\b/i;
    return { turns: [t1, t2, t3], checks: [
      ...basics(t1), ...basics(t2, [t1]), ...basics(t3, [t1, t2]),
      check('drafts a message', called(t1, 'draftMessage').length > 0 && afterDraft.some((m: any) => m.status === 'draft'), JSON.stringify(afterDraft.map((m: any) => m.status))),
      check("doesn't send it in the same turn", called(t1, 'sendMessage').length === 0 && !afterDraft.some((m: any) => m.status === 'sent'), JSON.stringify(t1.tools.map((c) => c.name))),
      check('asks before sending', /\?|haven['’]t sent|not sent|isn['’]t sent|approve/i.test(t1.finalText) && !claimsSent.test(t1.finalText), t1.finalText),
      check('sends after the yes', called(t2, 'sendMessage').length > 0 && afterSend.some((m: any) => m.status === 'sent'), JSON.stringify(afterSend.map((m: any) => m.status))),
      check('says replies go to their email', /inbox|your email|reply (will )?go|replies go|they('ll| will) reply/i.test(t2.finalText), t2.finalText),
      check('no email: says so, sends nothing', finalOutbox.filter((m: any) => m.placeId === 'op_1357').length === 0 && !claimsSent.test(t3.finalText), t3.finalText),
    ] };
  } },
];

/* ── run and report ──────────────────────────────────────────────────── */

const cost = (u: any, model?: string) => {
  const PRICE = PRICES[String(model).split('/')[1]];
  if (!u || !PRICE) return 0;
  const read = u.cachedInputTokens ?? u.inputTokenDetails?.cacheReadTokens ?? 0;
  const write = u.inputTokenDetails?.cacheWriteTokens ?? 0;
  const fresh = Math.max(0, (u.inputTokens ?? 0) - read - write);
  return (fresh * PRICE.input + read * PRICE.cacheRead + write * PRICE.cacheWrite + (u.outputTokens ?? 0) * PRICE.output) / 1e6;
};

const results: any[] = [];
for (const c of cases.filter((x) => !ONLY || x.name.includes(ONLY))) {
  for (let i = 0; i < RUNS; i++) {
    let r: { turns: Turn[]; checks: Check[] };
    try { r = await c.run(); } catch (e) { r = { turns: [], checks: [check('ran', false, String(e))] }; }
    // whatever the case, Fred's last search stayed inside the search as it ended
    try {
      const last = r.turns.at(-1), d = (await getJson('/api/search')).dealbreakers;
      const out = last ? outside(found(last), d) : [];
      r.checks.push(check('search stayed inside the saved search', out.length === 0, out.map((l: any) => `${l.id} ${l.area}`).join(', ')));
    } catch (e) { r.checks.push(check('search stayed inside the saved search', false, String(e))); }
    // every [address](place:op_id) link Fred wrote must point at a place in the inbox
    try {
      const inbox = new Set((await getJson('/api/opportunities?view=all&limit=100')).items.map((o: any) => o.id));
      const linked = r.turns.flatMap((t) => [...t.text.matchAll(/\]\(place:(op_[\w-]+)\)/g)].map((m) => m[1]));
      const stray = linked.filter((id) => !inbox.has(id));
      r.checks.push(check('place links point at real places', stray.length === 0, `not in the inbox: ${stray.join(', ')}`));
    } catch (e) { r.checks.push(check('place links point at real places', false, String(e))); }
    const last = r.turns.at(-1);
    const passed = r.checks.filter((x) => x.ok).length;
    const row = {
      case: c.name, run: i + 1, passed, total: r.checks.length,
      ms: last?.ms, msToFirstText: last?.meta?.msToFirstText, model: last?.meta?.model,
      usage: last?.meta?.usage, cost: r.turns.reduce((s, t) => s + cost(t.meta?.usage, t.meta?.model), 0),
      tools: last?.tools.map((t) => t.name), failed: r.checks.filter((x) => !x.ok), reply: last?.text, replies: r.turns.map((t) => t.text),
    };
    results.push(row);
    const u = row.usage ?? {};
    const cached = u.cachedInputTokens ?? u.inputTokenDetails?.cacheReadTokens ?? 0;
    console.log(`${passed === r.checks.length ? '✓' : '✗'} ${c.name}${RUNS > 1 ? ` #${i + 1}` : ''}  ${passed}/${r.checks.length}  ${((row.ms ?? 0) / 1000).toFixed(1)}s (first text ${((row.msToFirstText ?? 0) / 1000).toFixed(1)}s)  in ${u.inputTokens ?? '?'} (cached ${cached}) out ${u.outputTokens ?? '?'}  $${row.cost.toFixed(4)}`);
    for (const f of row.failed) console.log(`    ✗ ${f.name}: ${f.detail}`);
  }
}

const passed = results.reduce((s, r) => s + r.passed, 0), total = results.reduce((s, r) => s + r.total, 0);
const ms = results.map((r) => r.ms ?? 0).sort((a, b) => a - b);
const totalCost = results.reduce((s, r) => s + r.cost, 0);
console.log(`\n[${MODEL ?? 'default model'} · effort ${EFFORT ?? 'default'}] ${passed}/${total} checks passed · ${results.filter((r) => r.passed === r.total).length}/${results.length} cases clean · median turn ${(ms[Math.floor(ms.length / 2)] / 1000).toFixed(1)}s · total $${totalCost.toFixed(4)}`);

mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
const file = new URL(`./results/${new Date().toISOString().replace(/[:.]/g, '-')}.json`, import.meta.url);
writeFileSync(file, JSON.stringify({ base: BASE, model: MODEL, effort: EFFORT, runs: RUNS, passed, total, cost: totalCost, results }, null, 2));
console.log(`results: ${file.pathname}`);
await api('/api/mock/reset', { method: 'POST' });
