// The Fred API: every route in packages/api/src/routes.ts. For now each one is canned (mock.ts):
// the example data from packages/api plus each person's changes, marked with an
// X-Fred-Data: example header. Handlers move to Postgres one by one; the contract stays the same.
import { OpenAPIHono } from '@hono/zod-openapi';
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { swaggerUI } from '@hono/swagger-ui';
import { routes as R } from '@fng/api';
import * as S from '@fng/api';
import type { Env } from './ingest';
import { applySearch, load, reset, reply, save, view, type Message } from './mock';

type Ctx = { Bindings: Env & { ME: string } };

export const v2 = new OpenAPIHono<Ctx>({
  // invalid requests get the same { error } shape as everything else
  defaultHook: (result, c) => { if (!result.success) return c.json({ error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400); },
});

v2.use('*', async (c, next) => { await next(); c.header('X-Fred-Data', 'example'); c.header('Cache-Control', 'no-store'); });

const notFound = { error: 'not found' } as const;
const state = (c: { env: Ctx['Bindings'] }) => load(c.env.DB, c.env.ME);
const store = (c: { env: Ctx['Bindings'] }, st: Awaited<ReturnType<typeof load>>) => save(c.env.DB, c.env.ME, st);

/* you */
v2.openapi(R.getMe, async (c) => c.json(view(await state(c)).me, 200));
v2.openapi(R.getAlerts, async (c) => c.json(view(await state(c)).alerts, 200));
v2.openapi(R.patchAlerts, async (c) => {
  const st = await state(c);
  st.alerts = { ...view(st).alerts, ...c.req.valid('json') };
  await store(c, st);
  return c.json(st.alerts, 200);
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
  const items = view(await state(c)).cards.filter((o) => tab === 'all' || (tab === 'new' ? o.status === 'new' || o.status === 'hidden' : o.status === tab));
  return c.json({ items: items.slice(0, limit), nextCursor: null }, 200);
});
v2.openapi(R.getOpportunity, async (c) => {
  const v = view(await state(c)), id = c.req.valid('param').id;
  const card = v.cards.find((o) => o.id === id);
  if (!card) return c.json(notFound, 404);
  // only the first example has full detail; the rest borrow its shape
  return c.json({ ...(v.details[id] ?? v.details.op_hudson), ...card }, 200);
});
v2.openapi(R.patchOpportunity, async (c) => {
  const st = await state(c), id = c.req.valid('param').id;
  if (!view(st).cards.some((o) => o.id === id)) return c.json(notFound, 404);
  const p = c.req.valid('json');
  st.cards[id] = { ...st.cards[id], ...(p.seen !== undefined && { seen: p.seen }), ...(p.status && { status: p.status }), ...(p.note !== undefined && { note: p.note }) };
  await store(c, st);
  return c.json(view(st).cards.find((o) => o.id === id)!, 200);
});

/* tours */
v2.openapi(R.listTours, async (c) => {
  const { when } = c.req.valid('query'), now = Date.now();
  const past = (t: { status: string; startsAt: string | null }) => t.status === 'done' || t.status === 'cancelled' || (!!t.startsAt && Date.parse(t.startsAt) < now);
  const tours = view(await state(c)).tours.filter((t) => when === 'all' || (when === 'past') === past(t));
  return c.json(tours.sort((a, b) => (a.startsAt ?? '9').localeCompare(b.startsAt ?? '9')), 200);
});
v2.openapi(R.createTour, async (c) => {
  const st = await state(c), v = view(st), b = c.req.valid('json');
  const card = v.cards.find((o) => o.id === b.opportunityId);
  if (!card) return c.json(notFound, 404);
  const tour = { id: `tour_${crypto.randomUUID().slice(0, 8)}`, opportunityId: card.id, startsAt: null, address: v.details[card.id]?.address ?? card.area,
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

// Streams Fred's canned reply in the real AI SDK format, and saves both messages to the thread.
v2.openapi(R.chat, async (c) => {
  const st = await state(c), { threadId, message, context } = c.req.valid('json');
  const user = (message ?? {}) as Partial<Message>;
  const said = (user.parts ?? []).filter((p) => p.type === 'text').map((p) => String(p.text ?? '')).join(' ');
  const { parts, search } = reply(st, threadId, said, context?.opportunityId);
  const messageId = crypto.randomUUID(), now = new Date().toISOString();

  const prior = view(st).threads[threadId];
  st.threads[threadId] = {
    title: prior?.title ?? (said.slice(0, 60) || 'New chat'),
    updatedAt: now,
    messages: [...(prior?.messages ?? []), { id: user.id ?? crypto.randomUUID(), role: 'user', parts: user.parts ?? [] }, { id: messageId, role: 'assistant', parts }],
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
v2.post('/api/mock/reset', async (c) => { await reset(c.env.DB, c.env.ME); return c.json({ ok: true }); });

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
  DataSearchUpdated: S.DataSearchUpdated, DataScan: S.DataScan, DataSuggestions: S.DataSuggestions, DataWatch: S.DataWatch, Event: S.Event,
})) v2.openAPIRegistry.register(name, schema);

// The spec, and Swagger UI to browse and call it
v2.doc31('/api/openapi.json', openapiDoc);
v2.get('/api/docs', swaggerUI({ url: '/api/openapi.json', persistAuthorization: true, title: 'Fred API' }));

// unknown /api/* paths fall through to the old routes in index.ts
v2.notFound((c) => c.json(notFound, 404, { 'X-Fred-Route': 'none' }));
