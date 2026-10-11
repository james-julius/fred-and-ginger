// The Fred API: every route in packages/api/src/routes.ts. Places (and the counts in /api/me) come
// from the real listings in D1 (places.ts) and say X-Fred-Data: real. The rest are still canned
// (mock.ts): the example data plus each person's changes, marked X-Fred-Data: example. Handlers
// move over one by one; the contract stays the same.
import { OpenAPIHono } from '@hono/zod-openapi';
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { swaggerUI } from '@hono/swagger-ui';
import { routes as R } from '@fng/api';
import * as S from '@fng/api';
import type { Env } from './ingest';
import { applySearch, load, meFor, reset, reply, save, summarize, view, type Message } from './mock';
import { RequestContext, MASTRA_RESOURCE_ID_KEY } from '@mastra/core/request-context';
import { toAISdkStream } from '@mastra/ai-sdk';
import { fred, DEFAULT_MODEL, type Harness } from './agent/fred';
import { detail } from './agent/listings';
import { counts, inbox, vote } from './places';
import { AlertError, examplePlaces, getAlerts, patchAlerts, sendCode, sendDueAlerts, sendTest, verifyCode } from './alerts';
import { recall, taste } from './memory';

/** Keep only text written after the last tool call: a draft Fred wrote mid-turn and then corrected
 *  shouldn't come back on reload or be reread as history. The app shows the same thing live. */
const finalTextOnly = (parts: Message['parts']) => {
  const lastTool = parts.map((p) => p.type.startsWith('tool-')).lastIndexOf(true);
  return parts.filter((p, i) => p.type !== 'text' || i > lastTool);
};

const hasModelKey = (e: Env) => !!(e.ANTHROPIC_API_KEY || e.OPENAI_API_KEY || e.GOOGLE_GENERATIVE_AI_API_KEY);

type Ctx = { Bindings: Env & { ME: string } };

export const v2 = new OpenAPIHono<Ctx>({
  // invalid requests get the same { error } shape as everything else
  defaultHook: (result, c) => { if (!result.success) return c.json({ error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400); },
});

v2.use('*', async (c, next) => { await next(); if (!c.res.headers.has('X-Fred-Data')) c.header('X-Fred-Data', 'example'); c.header('Cache-Control', 'no-store'); });
const real = (c: { header(k: string, v: string): void }) => c.header('X-Fred-Data', 'real');

const notFound = { error: 'not found' } as const;
const state = (c: { env: Ctx['Bindings'] }) => load(c.env.DB, c.env.ME);
const store = (c: { env: Ctx['Bindings'] }, st: Awaited<ReturnType<typeof load>>) => save(c.env.DB, c.env.ME, st);
/** this person's state, the canned view, and their real inbox */
const places = async (c: { env: Ctx['Bindings'] }) => {
  const st = await state(c), v = view(st);
  return { st, v, cards: await inbox(c.env.DB, c.env.ME, st, v.search) };
};

/* you */
const meWithCounts = async (c: { env: Ctx['Bindings'] }, st: Awaited<ReturnType<typeof load>>) => {
  const v = view(st), cards = await inbox(c.env.DB, c.env.ME, st, v.search);
  return { ...meFor(st, c.env.ME), counts: counts(cards, v.tours), alerts: await getAlerts(c.env.DB, c.env.ME) };
};
v2.openapi(R.getMe, async (c) => c.json(await meWithCounts(c, await state(c)), 200));
v2.openapi(R.patchMe, async (c) => {
  const st = await state(c);
  st.profile = { ...st.profile, ...c.req.valid('json') };
  await store(c, st);
  return c.json(await meWithCounts(c, st), 200);
});
/* what Fred remembers: he writes it, the person can correct or delete it */
v2.openapi(R.listMemory, async (c) => c.json({ items: (await state(c)).memory ?? [] }, 200));
v2.openapi(R.patchMemory, async (c) => {
  const st = await state(c), id = c.req.valid('param').id, n = (st.memory ?? []).find((x) => x.id === id);
  if (!n) return c.json(notFound, 404);
  // the person's own correction is taken as written
  Object.assign(n, c.req.valid('json'), { from: 'said', updatedAt: new Date().toISOString() });
  await store(c, st);
  return c.json(n, 200);
});
v2.openapi(R.deleteMemory, async (c) => {
  const st = await state(c), id = c.req.valid('param').id;
  if (!(st.memory ?? []).some((x) => x.id === id)) return c.json(notFound, 404);
  st.memory = st.memory!.filter((x) => x.id !== id);
  await store(c, st);
  return c.body(null, 204);
});
/* alerts: real, in D1 (src/alerts.ts) */
const alertsLine = (a: Awaited<ReturnType<typeof getAlerts>>) =>
  `${a.mode}; email ${a.email.address ? `${a.email.address} (${a.email.verified ? 'verified' : 'not verified'}${a.email.enabled ? ', on' : ', off'})` : 'none'}; texts not available yet${a.sms.number ? ' (number saved)' : ''}`;
const alertError = (e: unknown) => {
  if (e instanceof AlertError) return { body: { error: e.message }, status: e.status };
  throw e;
};
v2.openapi(R.getAlerts, async (c) => c.json(await getAlerts(c.env.DB, c.env.ME), 200));
v2.openapi(R.patchAlerts, async (c) => {
  try { return c.json((await patchAlerts(c.env, c.env.ME, c.req.valid('json'))).alerts, 200); }
  catch (e) { const r = alertError(e); return c.json(r.body, r.status as 400); }
});
v2.openapi(R.verifyAlerts, async (c) => {
  const b = c.req.valid('json');
  try { return c.json(await verifyCode(c.env, c.env.ME, b.channel, b.code), 200); }
  catch (e) { const r = alertError(e); return c.json(r.body, r.status as 400 | 429); }
});
v2.openapi(R.resendAlertCode, async (c) => {
  try { return c.json(await sendCode(c.env, c.env.ME, c.req.valid('json').channel), 200); }
  catch (e) { const r = alertError(e); return c.json(r.body, r.status as 400 | 429 | 501); }
});
v2.openapi(R.testAlert, async (c) => {
  try {
    const st = await state(c), v = view(st);
    const places = await examplePlaces(c.env.DB, await inbox(c.env.DB, c.env.ME, st, v.search));
    return c.json(await sendTest(c.env, c.env.ME, c.req.valid('json').channel, places, summarize(v.search)), 200);
  } catch (e) { const r = alertError(e); return c.json(r.body, r.status as 400 | 429 | 501); }
});



/* search */
v2.openapi(R.getSearch, async (c) => c.json(view(await state(c)).search, 200));
v2.openapi(R.patchSearch, async (c) => {
  const st = await state(c);
  st.search = applySearch(view(st).search, c.req.valid('json'));
  await store(c, st);
  return c.json(st.search, 200);
});

/* places */
v2.openapi(R.listOpportunities, async (c) => {
  const { view: tab, limit } = c.req.valid('query');
  // the inbox shows new places plus hidden ones (struck through, with the reason)
  real(c);
  const items = (await places(c)).cards.filter((o) => tab === 'all' || (tab === 'new' ? o.status === 'new' || o.status === 'hidden' : o.status === tab));
  return c.json({ items: items.slice(0, limit), nextCursor: null }, 200);
});
v2.openapi(R.getOpportunity, async (c) => {
  real(c);
  const { st, cards } = await places(c), id = c.req.valid('param').id;
  const card = cards.find((o) => o.id === id), full = card && (await detail(c.env.DB, card));
  if (!card || !full) return c.json(notFound, 404);
  return c.json({ ...full, note: st.cards[id]?.note ?? null }, 200);
});
v2.openapi(R.patchOpportunity, async (c) => {
  real(c);
  const { st, cards } = await places(c), id = c.req.valid('param').id;
  const card = cards.find((o) => o.id === id);
  if (!card) return c.json(notFound, 404);
  const p = c.req.valid('json');
  st.cards[id] = { ...st.cards[id], ...(p.seen !== undefined && { seen: p.seen }), ...(p.status && { status: p.status }), ...(p.note !== undefined && { note: p.note }) };
  await Promise.all([store(c, st), vote(c.env.DB, c.env.ME, card, p)]);
  return c.json({ ...card, ...st.cards[id] }, 200);
});

/* tours */
v2.openapi(R.listTours, async (c) => {
  const { when } = c.req.valid('query'), now = Date.now();
  const past = (t: { status: string; startsAt: string | null }) => t.status === 'done' || t.status === 'cancelled' || (!!t.startsAt && Date.parse(t.startsAt) < now);
  const tours = view(await state(c)).tours.filter((t) => when === 'all' || (when === 'past') === past(t));
  return c.json(tours.sort((a, b) => (a.startsAt ?? '9').localeCompare(b.startsAt ?? '9')), 200);
});
v2.openapi(R.createTour, async (c) => {
  const { st, v, cards } = await places(c), b = c.req.valid('json');
  const card = cards.find((o) => o.id === b.opportunityId);
  if (!card) return c.json(notFound, 404);
  const tour = { id: `tour_${crypto.randomUUID().slice(0, 8)}`, opportunityId: card.id, startsAt: null, address: (await detail(c.env.DB, card))?.address ?? card.area,
                 status: 'draft' as const, contact: null, notes: `Asked for: ${b.slots.map((s) => s.start).join(', ')}` };
  st.tours = [...v.tours, tour];
  await store(c, st);
  return c.json(tour, 201);
});
v2.openapi(R.patchTour, async (c) => {
  const st = await state(c), v = view(st), id = c.req.valid('param').id;
  const t = v.tours.find((x) => x.id === id);
  if (!t) return c.json(notFound, 404);
  const next = { ...t, ...c.req.valid('json') };
  st.tours = v.tours.map((x) => (x.id === id ? next : x));
  await store(c, st);
  return c.json(next, 200);
});

/* application packet */
v2.openapi(R.getPacket, async (c) => c.json(view(await state(c)).packet, 200));

/* chat */
v2.openapi(R.listThreads, async (c) => {
  const v = view(await state(c));
  const list = Object.entries(v.threads).map(([id, t]) => ({ id, title: t.title, updatedAt: t.updatedAt }));
  return c.json(list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), 200);
});
v2.openapi(R.getThread, async (c) => {
  const id = c.req.valid('param').id, t = view(await state(c)).threads[id];
  if (!t) return c.json(notFound, 404);
  return c.json({ thread: { id, title: t.title, updatedAt: t.updatedAt }, messages: t.messages }, 200);
});

// Fred for real when a model key is set; otherwise the canned reply. Both stream the AI SDK
// format and save the turn to the thread.
v2.openapi(R.chat, async (c) => {
  const st = await state(c), { threadId, message, context } = c.req.valid('json');
  const user = (message ?? {}) as Partial<Message>;
  const said = (user.parts ?? []).filter((p) => p.type === 'text').map((p) => String(p.text ?? '')).join(' ');
  const userMsg: Message = { id: user.id ?? crypto.randomUUID(), role: 'user', parts: user.parts ?? [{ type: 'text', text: said }] };

  if (hasModelKey(c.env)) {
    // an id already in the thread means the user edited that message: Fred sees only what came before it
    const keep = (msgs: Message[] = []) => { const i = user.id ? msgs.findIndex((m) => m.id === user.id) : -1; return i === -1 ? msgs : msgs.slice(0, i); };
    const harnessV1 = c.env.FRED_DEV === '1' && c.req.header('x-fred-harness') === 'v1';
    const prior = view(st).threads[threadId], kept = keep(prior?.messages);
    const title = kept.length && prior?.title ? prior.title : (said.slice(0, 60) || 'New chat');
    // Save the user's message now, so an edit sticks even if the reply fails or they leave mid-reply.
    st.threads[threadId] = { title, updatedAt: new Date().toISOString(), messages: [...kept, userMsg] };
    await store(c, st);
    // history as plain text for now; Mastra memory in Postgres replaces this
    type Turn = { role: 'user'; content: string } | { role: 'assistant'; content: string };
    const history: Turn[] = kept.flatMap((m): Turn[] => {
      // v2 also drops drafts from chats saved before the fix
      let content = (harnessV1 ? m.parts : finalTextOnly(m.parts)).filter((p) => p.type === 'text').map((p) => String(p.text)).join('\n');
      // Tool results aren't replayed, so keep the ground truth Fred will be asked about: the places
      // it added, with their exact addresses. Without this it misremembers addresses on follow-ups.
      if (m.role === 'assistant' && !harnessV1) {
        const found = new Map<number, { address: string; price: number }>();
        for (const p of m.parts) if (p.type === 'tool-searchListings') for (const l of ((p.output as any)?.listings ?? [])) found.set(l.listingId ?? Number(String(l.id).slice(3)), l);
        const added = m.parts.filter((p) => p.type === 'tool-addToInbox').flatMap((p) => ((p.output as any)?.added ?? []) as { id: string; listingId?: number; area: string; price: number }[]);
        const lines = added.map((a) => { const f = found.get(Number(a.id.replace('op_', ''))); return `${a.id}: ${f?.address ?? a.area}, $${a.price}`; });
        if (lines.length) content += `\n[Places I added: ${lines.join('; ')}]`;
      }
      return !content ? [] : [m.role === 'user' ? { role: 'user', content } : { role: 'assistant', content }];
    });
    // Per-turn facts go in the user message, after the cached prefix (tools + instructions + history).
    // Sending the current search saves Fred a getSearch round trip.
    const now = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'short' });
    const s = view(st).search;
    const known = recall(st.memory), pattern = await taste(c.env.DB, st).catch(() => null);
    const note = [
      `(Now: ${now}, New York.)`,
      `(Alerts: ${alertsLine(await getAlerts(c.env.DB, c.env.ME))})`,
      `(Saved search: ${JSON.stringify({ ...s.dealbreakers, preferences: s.preferences.map((p) => p.weight === 'must' ? `${p.label} (dealbreaker)` : p.weight === 'important' ? `${p.label} (important)` : p.label) })})`,
      context?.opportunityId && `(The user has place ${context.opportunityId} open.)`,
      `(What you remember about them:\n${known ?? 'Nothing yet.'})`,
      pattern && `(From their saves and passes, hints to confirm, not facts:\n${pattern})`,
    ].filter(Boolean).join('\n');
    const rc = new RequestContext();
    rc.set('env', c.env);
    rc.set(MASTRA_RESOURCE_ID_KEY, c.env.ME);
    rc.set('said', said);   // updateMemory turns away notes that just repeat this
    // addToInbox takes ids from this turn's search, and the open place: Fred's verdict on it replaces the first take
    const open = Number(String(context?.opportunityId ?? '').replace(/^op_/, ''));
    rc.set('seenListings', new Set<number>(Number.isFinite(open) && open > 0 ? [open] : []));
    // local dev only: the eval suite compares models, effort levels and harness versions per request
    const dev = c.env.FRED_DEV === '1';   // set only in cloud/.dev.vars; wrangler dev reports the production hostname
    const model = (dev && c.req.header('x-fred-model')) || c.env.FRED_MODEL || DEFAULT_MODEL, t0 = Date.now();
    const effort = (dev && c.req.header('x-fred-effort')) || c.env.FRED_EFFORT || 'low';
    // v1 = the harness deployed before the 847-Riverside fixes (old prompt, text-only history, every text part saved)
    const harness: Harness = harnessV1 ? 'v1' : 'v2';

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        const out = await fred(model, harness).stream([...history, { role: 'user' as const, content: `${note}\n\n${said}` }], {
          requestContext: rc, maxSteps: 12,
          // cacheControl: Anthropic caches the whole prefix, so each step of the tool loop reads
          // the previous step's tokens at a tenth of the price. effort: low keeps chat fast.
          providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' }, effort: effort as 'low' } },
        });
        let firstText: number | null = null;
        for await (const part of toAISdkStream(out, { from: 'agent', version: 'v7', sendFinish: false })) {
          if (firstText == null && (part as { type: string }).type === 'text-delta') firstText = Date.now() - t0;
          writer.write(part as never);
        }
        // timing and token usage, for the eval suite and for watching cost
        const usage = await out.totalUsage;
        writer.write({ type: 'message-metadata', messageMetadata: { model, effort, harness, ms: Date.now() - t0, msToFirstText: firstText, usage } } as never);
        writer.write({ type: 'finish' });
      },
      onFinish: async ({ responseMessage }) => {
        // Nothing to keep if the reply failed before Fred said or did anything.
        if (!responseMessage.parts.some((p) => p.type === 'text' || p.type.startsWith('tool-') || p.type.startsWith('data-'))) return;
        // Put Fred's reply right after this user message (already saved above).
        const fresh = await state(c), was = view(fresh).threads[threadId]?.messages ?? [];
        const at = was.findIndex((m) => m.id === userMsg.id), upTo = at === -1 ? [...was, userMsg] : was.slice(0, at + 1);
        const parts = responseMessage.parts as Message['parts'];
        fresh.threads[threadId] = { title, updatedAt: new Date().toISOString(),
          messages: [...upTo, { id: responseMessage.id, role: 'assistant', parts: harnessV1 ? parts : finalTextOnly(parts) }] };
        await store(c, fresh);
      },
      onError: (e) => { console.error('fred', e); return 'Fred hit a problem answering that. Try again in a moment.'; },
    });
    return createUIMessageStreamResponse({ stream }) as never;
  }

  const { parts, search } = reply(st, threadId, said, context?.opportunityId);
  const messageId = crypto.randomUUID(), now = new Date().toISOString();

  const prior = view(st).threads[threadId];
  // An id that's already in the thread means the user edited that message: keep only what came before it.
  const edited = user.id ? (prior?.messages ?? []).findIndex((m) => m.id === user.id) : -1;
  const kept = edited === -1 ? (prior?.messages ?? []) : prior!.messages.slice(0, edited);
  st.threads[threadId] = {
    title: kept.length && prior?.title ? prior.title : (said.slice(0, 60) || 'New chat'),
    updatedAt: now,
    messages: [...kept, { id: user.id ?? crypto.randomUUID(), role: 'user', parts: user.parts ?? [] }, { id: messageId, role: 'assistant', parts }],
  };
  st.search = search;
  await store(c, st);

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
      writer.write({ type: 'start', messageId });
      for (const [i, part] of parts.entries()) {
        if (part.type === 'text') {
          const id = `t${i}`;
          writer.write({ type: 'text-start', id });
          for (const word of String(part.text).split(/(?<= )/)) { writer.write({ type: 'text-delta', id, delta: word }); await pause(25); }
          writer.write({ type: 'text-end', id });
        } else {
          writer.write(part as never);
          await pause(400);
        }
      }
      writer.write({ type: 'finish' });
    },
  });
  return createUIMessageStreamResponse({ stream, headers: { 'X-Fred-Data': 'example' } }) as never;
});

/* live: counts and watch status now, then every 20 seconds for 5 minutes. EventSource reconnects after. */
v2.openapi(R.events, (c) => {
  const enc = new TextEncoder(), env = c.env;
  let timer: ReturnType<typeof setInterval> | null = null;
  const body = new ReadableStream({
    async start(ctl) {
      const send = async () => {
        const v = view(await load(env.DB, env.ME)), now = new Date();
        ctl.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'counts', counts: v.me.counts })}\n\n`));
        ctl.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'watch', watch: { state: 'watching', lastCheckedAt: now.toISOString(), nextCheckAt: new Date(now.getTime() + 2 * 3600_000).toISOString() } })}\n\n`));
      };
      await send();
      let ticks = 0;
      timer = setInterval(async () => {
        try { if (++ticks > 15) { clearInterval(timer); ctl.close(); } else await send(); } catch { clearInterval(timer); }
      }, 20_000);
    },
    cancel() { clearInterval(timer); },
  });
  return c.body(body, 200, { 'Content-Type': 'text/event-stream' }) as never;
});

/* not in the contract: start the canned data over for whoever is signed in */
/* local dev only: put a stored conversation into a thread, so evals can replay it from the same starting point */
v2.post('/api/mock/thread', async (c) => {
  if (c.env.FRED_DEV !== '1') return c.json(notFound, 404);
  const b = await c.req.json<{ threadId: string; messages: Message[] }>(), st = await state(c);
  st.threads[b.threadId] = { title: 'Replay', updatedAt: new Date().toISOString(), messages: b.messages };
  await store(c, st);
  return c.json({ ok: true, messages: b.messages.length });
});
/* local dev only: the last verification code, so evals don't need an inbox */
v2.get('/api/mock/code', async (c) => {
  if (c.env.FRED_DEV !== '1') return c.json(notFound, 404);
  const r = await c.env.DB.prepare('SELECT v FROM meta WHERE k=?').bind(`dev:code:${c.env.ME}:${c.req.query('channel') ?? 'email'}`).first<{ v: string }>();
  return c.json({ code: r?.v ?? null });
});
/* local dev only: run the alert sender now for the signed-in person; ?since=<unix seconds> widens the window */
v2.post('/api/mock/run-alerts', async (c) => {
  if (c.env.FRED_DEV !== '1') return c.json(notFound, 404);
  const since = c.req.query('since');
  return c.json(await sendDueAlerts(c.env, { only: c.env.ME, since: since ? Number(since) : undefined }));
});
v2.post('/api/mock/reset', async (c) => {
  await reset(c.env.DB, c.env.ME);
  // local dev only: alert settings are real data, so production resets leave them alone
  if (c.env.FRED_DEV === '1') for (const t of ['alert_settings', 'alert_codes', 'alert_log']) await c.env.DB.prepare(`DELETE FROM ${t} WHERE user=?`).bind(c.env.ME).run();
  return c.json({ ok: true });
});

export const openapiDoc = {
  openapi: '3.1.0',
  info: { title: 'Fred API', version: '0.1.0', description: [
    'Generated from packages/api. Run `npm run gen:api` at the repo root after changing it.',
    '',
    'Every route is canned for now (response header `X-Fred-Data: example`): the mockup\'s example data, plus your own changes, which are saved. Saving a place moves it to Saved, marking it seen lowers the New count, search edits stick, and the chat answers what you send. `POST /api/mock/reset` starts your data over.',
    '',
    'Sign in at /login first; "Try it out" uses your session.',
  ].join('\n') },
};

// Chat parts and live events aren't request or response bodies, so list them to get them into the spec.
for (const [name, schema] of Object.entries({
  DataSearchUpdated: S.DataSearchUpdated, DataScan: S.DataScan, DataPlaces: S.DataPlaces, DataSuggestions: S.DataSuggestions, DataWatch: S.DataWatch, Event: S.Event,
})) v2.openAPIRegistry.register(name, schema);

// The spec, and Swagger UI to browse and call it
v2.doc31('/api/openapi.json', openapiDoc);
v2.get('/api/docs', swaggerUI({ url: '/api/openapi.json', persistAuthorization: true, title: 'Fred API' }));

// unknown /api/* paths fall through to the old routes in index.ts
v2.notFound((c) => c.json(notFound, 404, { 'X-Fred-Route': 'none' }));
