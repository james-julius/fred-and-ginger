// The Fred API: every route in packages/api/src/routes.ts. For now each one serves the example
// data from packages/api (marked with an X-Fred-Data: example header), so the app can be built
// against it. Handlers move to Postgres one by one; the contract stays the same.
import { OpenAPIHono } from '@hono/zod-openapi';
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { swaggerUI } from '@hono/swagger-ui';
import { fixtures, routes as R } from '@fng/api';
import * as S from '@fng/api';
import type { Env } from './ingest';

type Ctx = { Bindings: Env & { ME: string } };

export const v2 = new OpenAPIHono<Ctx>({
  // invalid requests get the same { error } shape as everything else
  defaultHook: (result, c) => { if (!result.success) return c.json({ error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400); },
});

v2.use('*', async (c, next) => { await next(); c.header('X-Fred-Data', 'example'); c.header('Cache-Control', 'no-store'); });

const notFound = { error: 'not found' } as const;

v2.openapi(R.getMe, (c) => c.json(fixtures().me, 200));
v2.openapi(R.getAlerts, (c) => c.json(fixtures().alerts, 200));
v2.openapi(R.patchAlerts, (c) => c.json({ ...fixtures().alerts, ...c.req.valid('json') }, 200));

v2.openapi(R.getSearch, (c) => c.json(fixtures().search, 200));
v2.openapi(R.patchSearch, (c) => {
  const s = fixtures().search, p = c.req.valid('json');
  return c.json({ ...s, ...p, dealbreakers: { ...s.dealbreakers, ...p.dealbreakers }, updatedAt: new Date().toISOString() }, 200);
});

v2.openapi(R.listOpportunities, (c) => {
  const { view, limit } = c.req.valid('query');
  const items = fixtures().cards.filter((o) => view === 'all' || (view === 'new' ? o.status === 'new' || o.status === 'hidden' : o.status === view));
  return c.json({ items: items.slice(0, limit), nextCursor: null }, 200);
});
v2.openapi(R.getOpportunity, (c) => {
  const f = fixtures(), id = c.req.valid('param').id;
  const card = f.cards.find((o) => o.id === id);
  if (!card) return c.json(notFound, 404);
  // only the first example has full detail; the rest reuse its shape
  const d = f.details[id] ?? { ...f.details.op_hudson, ...card };
  return c.json(d, 200);
});
v2.openapi(R.patchOpportunity, (c) => {
  const card = fixtures().cards.find((o) => o.id === c.req.valid('param').id);
  if (!card) return c.json(notFound, 404);
  const p = c.req.valid('json');
  return c.json({ ...card, ...(p.seen !== undefined && { seen: p.seen }), ...(p.status && { status: p.status }) }, 200);
});

v2.openapi(R.listTours, (c) => c.json(fixtures().tours, 200));
v2.openapi(R.createTour, (c) => {
  const b = c.req.valid('json');
  const card = fixtures().cards.find((o) => o.id === b.opportunityId);
  if (!card) return c.json(notFound, 404);
  return c.json({ id: 'tour_new', opportunityId: card.id, startsAt: null, address: card.area, status: 'draft' as const, contact: null, notes: null }, 201);
});
v2.openapi(R.patchTour, (c) => {
  const t = fixtures().tours.find((x) => x.id === c.req.valid('param').id);
  if (!t) return c.json(notFound, 404);
  return c.json({ ...t, ...c.req.valid('json') }, 200);
});

v2.openapi(R.getPacket, (c) => c.json(fixtures().packet, 200));

v2.openapi(R.listThreads, (c) => c.json(fixtures().threads, 200));
v2.openapi(R.getThread, (c) => {
  const f = fixtures(), t = f.threads.find((x) => x.id === c.req.valid('param').id);
  if (!t) return c.json(notFound, 404);
  return c.json({ thread: t, messages: f.messages }, 200);
});

// A scripted reply in the real stream format, so the chat UI can be built before the agent exists.
// Whatever you send, Fred replies with the mockup's turn.
v2.openapi(R.chat, async () => {
  const reply = fixtures().messages[1].parts;
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
      writer.write({ type: 'start', messageId: crypto.randomUUID() });
      for (const part of reply) {
        if (part.type === 'text') {
          writer.write({ type: 'text-start', id: 't1' });
          for (const word of (part as { text: string }).text.split(/(?<= )/)) { writer.write({ type: 'text-delta', id: 't1', delta: word }); await pause(25); }
          writer.write({ type: 'text-end', id: 't1' });
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

v2.openapi(R.events, (c) => {
  const f = fixtures(), enc = new TextEncoder();
  const watch = f.messages[1].parts.find((p) => p.type === 'data-watch') as { data: unknown };
  const body = new ReadableStream({
    start(ctl) {
      ctl.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'counts', counts: f.me.counts })}\n\n`));
      ctl.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'watch', watch: watch.data })}\n\n`));
      ctl.close();
    },
  });
  return c.body(body, 200, { 'Content-Type': 'text/event-stream' }) as never;
});

export const openapiDoc = {
  openapi: '3.1.0',
  info: { title: 'Fred API', version: '0.1.0', description: [
    'Generated from packages/api. Run `npm run gen:api` at the repo root after changing it.',
    '',
    'Every route serves example data for now (response header `X-Fred-Data: example`). Sign in at /login first; "Try it out" uses your session.',
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
