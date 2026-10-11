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

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const BASE = flag('base') ?? 'http://localhost:8787';
const RUNS = Number(flag('runs') ?? 1);
const ONLY = flag('case');
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) throw new Error('The eval resets canned data, so it only runs against localhost');

// Haiku 5.5, per million tokens (prompts under 100K): input, output, cache read (0.1x), 5-minute cache write (1.25x)
const PRICE = { input: 0.10, output: 0.50, cacheRead: 0.01, cacheWrite: 0.125 };

/* ── talking to the Worker ───────────────────────────────────────────── */

const vars = Object.fromEntries(readFileSync(new URL('../cloud/.dev.vars', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const exp = Math.floor(Date.now() / 1000) + 3600;
const cookie = `nest_s=james.${exp}.${createHmac('sha256', vars.SESSION_KEY).update(`james.${exp}`).digest('hex')}`;
const api = async (path: string, init: RequestInit = {}) => {
  const r = await fetch(BASE + path, { ...init, headers: { cookie, 'content-type': 'application/json', ...init.headers } });
  if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${r.status} ${await r.text()}`);
  return r;
};
const getJson = async <T = any>(path: string) => (await api(path)).json() as Promise<T>;

type ToolCall = { name: string; input: any; output?: any };
type Turn = { said: string; text: string; tools: ToolCall[]; parts: string[]; meta: any; ms: number; error?: string };

async function say(threadId: string, text: string, opportunityId?: string): Promise<Turn> {
  const t0 = Date.now();
  const r = await api('/api/chat', { method: 'POST', body: JSON.stringify({
    threadId, context: opportunityId ? { opportunityId } : null,
    message: { id: randomUUID(), role: 'user', parts: [{ type: 'text', text }] },
  }) });
  const turn: Turn = { said: text, text: '', tools: [], parts: [], meta: null, ms: 0 };
  const byId = new Map<string, ToolCall>();
  const body = await r.text();
  for (const line of body.split('\n')) {
    if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
    const p = JSON.parse(line.slice(6));
    if (p.type === 'text-delta') turn.text += p.delta;
    else if (p.type === 'tool-input-available') { const call = { name: p.toolName, input: p.input }; byId.set(p.toolCallId, call); turn.tools.push(call); }
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
function basics(t: Turn): Check[] {
  const seen = JSON.stringify(t.tools.map((c) => c.output ?? null));
  // numbers from tool results, plus ones the user said ("$5k" counts as 5000)
  const fromUser = (t.said.match(/\d[\d,.]*k?/gi) ?? []).map((n) => /k$/i.test(n) ? String(Number(n.slice(0, -1).replace(/,/g, '')) * 1000) : n.replace(/,/g, ''));
  const nums = new Set([...(seen.match(/\d[\d,]*(\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, '')), ...fromUser]);
  const dollars = (t.text.match(/\$\s?\d[\d,]*(\.\d+)?k?/gi) ?? []).map((d) => d.replace(/[$\s,]/g, ''));
  // "$5k" or "$5,000" when the user said it is fine; only flag amounts that look like listing prices
  const invented = dollars.filter((d) => !/k$/i.test(d) && Number(d) >= 1000 && !nums.has(d) && !nums.has(String(Number(d))));
  const searchedIds = new Set(called(t, 'searchListings').flatMap((c) => (c.output?.listings ?? []).map((l: any) => l.listingId)));
  const added = called(t, 'addToInbox').flatMap((c) => c.input.places.map((p: any) => p.listingId));
  const strays = added.filter((id) => !searchedIds.has(id));
  return [
    check('answered without error', !t.error && t.text.trim().length > 0, t.error ?? 'empty reply'),
    check('no invented prices', invented.length === 0, `not in any tool result: ${invented.join(', ')}`),
    check('only adds listings it searched', strays.length === 0, `added ids not from this turn's search: ${strays.join(', ')}`),
    check('brief (≤ 120 words)', words(t.text) <= 120, `${words(t.text)} words`),
    check('says it once', !/(.{40,})[\s\S]*\1/.test(t.text), 'reply repeats itself'),
  ];
}

const areasInclude = (input: any, area: string) => (input?.dealbreakers?.areas ?? input?.areas ?? []).some((a: string) => a.toLowerCase().includes(area));

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
      check('budget is 5000', up?.dealbreakers?.maxTotalMonthly === 5000, JSON.stringify(up?.dealbreakers)),
      check('2 beds', up?.dealbreakers?.minBeds === 2, JSON.stringify(up?.dealbreakers)),
      check('dogs', ['dogs', 'dogs_and_cats'].includes(up?.dealbreakers?.pets), JSON.stringify(up?.dealbreakers)),
      check('Brooklyn', areasInclude(up, 'brooklyn'), JSON.stringify(up?.dealbreakers?.areas)),
      check('searches with the filters', !!sl && sl.maxRent <= 5000 && sl.minBeds === 2 && areasInclude(sl, 'brooklyn'), JSON.stringify(sl)),
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
      ...basics(t2),
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
      ...basics(t2),
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
      ...basics(t2),
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
      ...basics(t2),
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
      check('brief (≤ 120 words)', words(t.text) <= 120, `${words(t.text)} words`),
    ] };
  } },
];

/* ── run and report ──────────────────────────────────────────────────── */

const cost = (u: any) => {
  if (!u) return 0;
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
    const last = r.turns.at(-1);
    const passed = r.checks.filter((x) => x.ok).length;
    const row = {
      case: c.name, run: i + 1, passed, total: r.checks.length,
      ms: last?.ms, msToFirstText: last?.meta?.msToFirstText, model: last?.meta?.model,
      usage: last?.meta?.usage, cost: r.turns.reduce((s, t) => s + cost(t.meta?.usage), 0),
      tools: last?.tools.map((t) => t.name), failed: r.checks.filter((x) => !x.ok), reply: last?.text,
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
console.log(`\n${passed}/${total} checks passed · ${results.filter((r) => r.passed === r.total).length}/${results.length} cases clean · median turn ${(ms[Math.floor(ms.length / 2)] / 1000).toFixed(1)}s · total $${totalCost.toFixed(4)}`);

mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
const file = new URL(`./results/${new Date().toISOString().replace(/[:.]/g, '-')}.json`, import.meta.url);
writeFileSync(file, JSON.stringify({ base: BASE, runs: RUNS, passed, total, cost: totalCost, results }, null, 2));
console.log(`results: ${file.pathname}`);
await api('/api/mock/reset', { method: 'POST' });
