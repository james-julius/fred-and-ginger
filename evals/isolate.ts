// Model or harness? Replays the two turns from a real chat that went wrong, from the exact same
// starting point every time, across harness versions × models, and counts each failure type.
//
//   v1 = the harness deployed before the fixes (old prompt, text-only history, every text part saved)
//   v2 = current (reply only after tools, exact addresses in history, proactive when data is missing)
//
// If v1→v2 removes a failure on the same model, the harness caused it. If one model fails where
// another doesn't on the same harness, the model did.
//
//   npm run isolate                 default grid, 20 runs of the address turn, 8 of the furnished turn
//   npm run isolate -- --runs 3     fewer repeats
//
// Needs `cd cloud && npx wrangler dev` running with a model key. Resets james's canned data; localhost only.
import { createHmac, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const BASE = 'http://localhost:8787';
const RUNS = Number(flag('runs') ?? 20), RUNS_FURNISHED = Number(flag('furnished-runs') ?? flag('runs') ?? 8);

const CELLS = [
  { harness: 'v1', model: 'anthropic/claude-haiku-5-5', effort: 'low' },   // what's deployed
  { harness: 'v2', model: 'anthropic/claude-haiku-5-5', effort: 'low' },
  { harness: 'v1', model: 'anthropic/claude-haiku-5-5', effort: 'medium' },
  { harness: 'v2', model: 'anthropic/claude-haiku-5-5', effort: 'medium' },
  { harness: 'v1', model: 'anthropic/claude-sonnet-5-5', effort: 'low' },
  { harness: 'v2', model: 'anthropic/claude-sonnet-5-5', effort: 'low' },
  // Gemini (needs GOOGLE_GENERATIVE_AI_API_KEY in cloud/.dev.vars); effort becomes its thinking level
  { harness: 'v2', model: 'google/gemini-3.8-flash', effort: 'low' },
  { harness: 'v2', model: 'google/gemini-3.1-pro-preview', effort: 'low' },
];
// $ per million tokens: input, output, cache read, cache write (5 min)
const PRICE: Record<string, number[]> = { 'claude-haiku-5-5': [0.10, 0.50, 0.01, 0.125], 'claude-sonnet-5-5': [2, 10, 0.2, 2.5] };

const vars = Object.fromEntries(readFileSync(new URL('../cloud/.dev.vars', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const exp = Math.floor(Date.now() / 1000) + 7200;
const cookie = `nest_s=james.${exp}.${createHmac('sha256', vars.SESSION_KEY).update(`james.${exp}`).digest('hex')}`;
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(BASE + path, { method: path === '/api/search' ? 'PATCH' : 'POST', headers: { cookie, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

const sample = JSON.parse(readFileSync(new URL('./fixtures/dog-friendly-thread.json', import.meta.url), 'utf8')).messages as { role: string; parts: any[] }[];
const textOf = (m: { parts: any[] }) => m.parts.filter((p) => p.type === 'text').map((p) => p.text).join(' ');

type Turn = { text: string; texts: number; seq: string[]; tools: { name: string; input: any; output?: any }[]; parts: string[]; meta: any };
async function say(cell: typeof CELLS[number], threadId: string, text: string, opportunityId?: string): Promise<Turn> {
  const r = await post('/api/chat', { threadId, context: opportunityId ? { opportunityId } : null, message: { id: randomUUID(), role: 'user', parts: [{ type: 'text', text }] } },
    { 'x-fred-harness': cell.harness, 'x-fred-model': cell.model, 'x-fred-effort': cell.effort });
  const t: Turn = { text: '', texts: 0, seq: [], tools: [], parts: [], meta: null };
  const byId = new Map<string, Turn['tools'][number]>();
  for (const line of (await r.text()).split('\n')) {
    if (!line.startsWith('data: {')) continue;
    const p = JSON.parse(line.slice(6));
    if (p.type === 'text-start') { t.texts++; t.seq.push('text'); }
    else if (p.type === 'text-delta') t.text += p.delta;
    else if (p.type === 'tool-input-available') { const c = { name: p.toolName, input: p.input }; byId.set(p.toolCallId, c); t.tools.push(c); t.seq.push('tool'); }
    else if (p.type === 'tool-output-available') { const c = byId.get(p.toolCallId); if (c) c.output = p.output; }
    else if (p.type === 'message-metadata') t.meta = p.messageMetadata;
    else if (p.type?.startsWith('data-')) t.parts.push(p.type);
  }
  return t;
}

// a house number and the street that follows: "113 W 130th", "847 Riverside", "373 Manhattan Avenue"
const ADDRESS = /\b\d{1,5}(?:-\d{1,3})?\s+(?:(?:[NSEW]\.?|North|South|East|West)\s+)?(?:\d{1,3}(?:st|nd|rd|th)\b|(?:[A-Z][a-z]+\s){0,2}(?:St|Street|Ave|Avenue|Blvd|Boulevard|Pl|Place|Rd|Road|Dr|Drive|Way|Pkwy|Ter|Ct|Sq)\b|(?:Broadway|Bowery|Riverside|Fort Washington|Central Park West|Park Avenue)\b)/g;
const norm = (s: string) => s.toLowerCase().replace(/\./g, '').replace(/\bstreet\b/g, 'st').replace(/\bavenue\b/g, 'ave').replace(/\s+/g, ' ');

/** Failure flags for one turn. `known` is every tool output and user message Fred could have read. */
function score(t: Turn, known: string) {
  const k = norm(known);
  const invented = [...t.text.matchAll(ADDRESS)].map((m) => m[0]).filter((a) => !k.includes(norm(a).replace(/ (st|ave)$/, '')));
  const first = t.seq.indexOf('text');
  return {
    inventedAddress: invented.length > 0, invented,
    textBeforeTool: first >= 0 && t.seq.lastIndexOf('tool') > first,
    multipleReplies: t.texts > 1,
    selfCorrection: /\b(correction|I need to correct|I meant|scratch that|sorry, I (wrote|said))\b/i.test(t.text),
    overLength: t.text.trim().split(/\s+/).length > 120,
    words: t.text.trim().split(/\s+/).length,
  };
}

const cost = (m: any) => {
  const u = m?.usage, p = PRICE[String(m?.model).split('/')[1]];
  if (!u || !p) return 0;
  const read = u.cachedInputTokens ?? u.inputTokenDetails?.cacheReadTokens ?? 0, write = u.inputTokenDetails?.cacheWriteTokens ?? 0;
  return ((Math.max(0, (u.inputTokens ?? 0) - read - write)) * p[0] + (u.outputTokens ?? 0) * p[1] + read * p[2] + write * p[3]) / 1e6;
};

const rows: any[] = [];
const seed = async (n: number) => {
  await post('/api/mock/reset', {});
  // the search at that point, so the place that was open (op_469) is in the inbox for getPlace
  await post('/api/search', { dealbreakers: { areas: ['manhattan'], maxTotalMonthly: 5000, minBeds: 1, minBaths: 1.5, pets: null } });
  const threadId = `iso_${randomUUID().slice(0, 8)}`;
  const r = await post('/api/mock/thread', { threadId, messages: sample.slice(0, n) });
  if (!r.ok) throw new Error(`seeding failed (${r.status}); is FRED_DEV=1 in cloud/.dev.vars?`);
  return threadId;
};
const seededKnown = (n: number) => JSON.stringify(sample.slice(0, n).flatMap((m) => m.parts.filter((p) => String(p.type).startsWith('tool-')).map((p) => p.output))) + ' ' + sample.slice(0, n).filter((m) => m.role === 'user').map(textOf).join(' ');

for (const cell of CELLS) {
  const label = `${cell.harness} · ${cell.model.split('/')[1]} · ${cell.effort}`;
  // Turn A: "I like natural light..." (where "847 Riverside" happened). History: messages 0-5.
  for (let i = 0; i < RUNS; i++) {
    const thread = await seed(6);
    const t = await say(cell, thread, textOf(sample[6]));
    if (t.meta && (t.meta.harness !== cell.harness || t.meta.model !== cell.model || t.meta.effort !== cell.effort)) throw new Error(`override ignored: asked ${label}, got ${JSON.stringify(t.meta)}`);
    const s = score(t, seededKnown(6) + JSON.stringify(t.tools.map((x) => x.output)) + textOf(sample[6]));
    rows.push({ cell: label, ...cell, turn: 'address', ms: t.meta?.ms, cost: cost(t.meta), ...s, tools: t.tools.map((x) => x.name), reply: t.text });
    process.stdout.write(`${label} address #${i + 1}: ${s.inventedAddress ? 'INVENTED ' + s.invented.join('/') : 'ok'}${s.textBeforeTool ? ' text-before-tool' : ''}${s.multipleReplies ? ' multi-reply' : ''}\n`);
  }
  // Turn B: "does it come furnished or unfurnished?" with op_469 (47 W 84th St) open. History: messages 0-7.
  for (let i = 0; i < RUNS_FURNISHED; i++) {
    const thread = await seed(8);
    const t = await say(cell, thread, textOf(sample[8]), 'op_469');
    const s = score(t, seededKnown(8) + JSON.stringify(t.tools.map((x) => x.output)) + textOf(sample[8]));
    const nextStep = t.parts.includes('data-suggestions') || t.tools.some((x) => x.name === 'updatePlace') || /\b(want me to|I can|I'll|shall I|should I|here's a (message|draft))\b/i.test(t.text);
    rows.push({ cell: label, ...cell, turn: 'furnished', ms: t.meta?.ms, cost: cost(t.meta), ...s, deadEnd: !nextStep, lookedUp: t.tools.some((x) => x.name === 'getPlace'), tools: t.tools.map((x) => x.name), reply: t.text });
    process.stdout.write(`${label} furnished #${i + 1}: ${nextStep ? 'offers next step' : 'DEAD END'}\n`);
  }
}

// summary: failure rates per cell
const pct = (xs: any[], f: (r: any) => boolean) => xs.length ? `${Math.round(100 * xs.filter(f).length / xs.length)}%` : '-';
console.log('\n| harness · model · effort | invented address | text before a tool | >1 reply | self-correction | >120 words | dead end (furnished) | median s | $ / turn |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const cell of [...new Set(rows.map((r) => r.cell))]) {
  const a = rows.filter((r) => r.cell === cell && r.turn === 'address'), b = rows.filter((r) => r.cell === cell && r.turn === 'furnished'), all = [...a, ...b];
  const ms = all.map((r) => r.ms ?? 0).sort((x, y) => x - y);
  console.log(`| ${cell} | ${pct(a, (r) => r.inventedAddress)} | ${pct(all, (r) => r.textBeforeTool)} | ${pct(all, (r) => r.multipleReplies)} | ${pct(all, (r) => r.selfCorrection)} | ${pct(all, (r) => r.overLength)} | ${pct(b, (r) => r.deadEnd)} | ${(ms[Math.floor(ms.length / 2)] / 1000).toFixed(1)} | ${(all.reduce((s, r) => s + r.cost, 0) / all.length).toFixed(4)} |`);
}

mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
const file = new URL(`./results/isolate-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, import.meta.url);
writeFileSync(file, JSON.stringify(rows, null, 2));
console.log(`\nresults: ${file.pathname}`);
await post('/api/mock/reset', {});
