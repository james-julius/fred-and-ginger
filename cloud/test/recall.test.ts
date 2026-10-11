// Chat recall: exchanges go in per person, edits take theirs out, old chats are indexed once, and
// a search finds the closest exchange in another chat. Workers AI and Vectorize are faked: words
// hash into a vector, so "kitchen" finds "kitchen". The live model is checked by hand (see PR).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backfill, exchanges, forget, placesIn, remember, search, worthRemembering } from '../src/recall';
import type { Message } from '../src/mock';
import { d1 } from './d1';

const DIM = 768;
function embed(text: string) {
  const v = new Array(DIM).fill(0);
  for (const w of text.toLowerCase().match(/[a-z]{4,}/g) ?? []) {
    let h = 0; for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % DIM] += 1;
  }
  return v;
}
const cos = (a: number[], b: number[]) => {
  let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] ** 2; y += b[i] ** 2; }
  return x && y ? d / Math.sqrt(x * y) : 0;
};
function fakes() {
  const store = new Map<string, { values: number[]; metadata: any }>();
  const seen: string[] = [];
  // bge reads the search prefix as an instruction, not content
  const AI = { run: async (_m: string, { text }: { text: string[] }) => { seen.push(...text); return { data: text.map((t) => embed(t.replace(/^Represent this sentence for searching relevant passages: /, ''))) }; } } as unknown as Ai;
  const CHATS = {
    upsert: async (vs: any[]) => { for (const v of vs) store.set(v.id, v); return { mutationId: 'x' }; },
    deleteByIds: async (ids: string[]) => { for (const id of ids) store.delete(id); return { mutationId: 'x' }; },
    query: async (q: number[], o: any) => ({
      matches: [...store.entries()].filter(([, v]) => v.metadata.user === o.filter.user)
        .map(([id, v]) => ({ id, score: cos(q, v.values), metadata: v.metadata })).sort((a, b) => b.score - a.score).slice(0, o.topK),
    }),
  } as unknown as VectorizeIndex;
  return { AI, CHATS, store, seen };
}

const msg = (id: string, role: 'user' | 'assistant', text: string, extra: any[] = []): Message =>
  ({ id, role, parts: [{ type: 'text', text }, ...extra] } as Message);

const kitchenChat = [
  msg('u1', 'user', 'Show me Greenpoint two bedrooms with a huge kitchen and a dishwasher'),
  msg('a1', 'assistant', 'The best is [118 Java St](place:op_41): a huge kitchen, dishwasher, and $3,900.',
      [{ type: 'tool-addToInbox', output: { added: [{ id: 'op_41' }, { id: 'op_42' }] } }]),
  msg('u2', 'user', 'what about laundry'),
  msg('a2', 'assistant', 'Java St has laundry in the basement.'),
];

test('each Fred reply is one exchange, with the places it touched', () => {
  const xs = exchanges('t1', 'Greenpoint', kitchenChat, '2026-10-11T18:00:00Z');
  assert.equal(xs.length, 2);
  assert.match(xs[0].you, /huge kitchen/);
  assert.deepEqual(xs[0].places.sort(), ['op_41', 'op_42']);
  assert.equal(xs[1].id, 'a2');
  assert.deepEqual(placesIn([{ type: 'data-places', data: { ids: ['op_7'] } } as any]), ['op_7']);
});

test("a search finds the closest exchange in another chat, only this person's", async () => {
  const { AI, CHATS, seen } = fakes(), env = { AI, CHATS };
  await remember(env, 'james', exchanges('t1', 'Greenpoint', kitchenChat));
  assert.doesNotMatch(seen[0], /^Represent/);                              // stored exchanges carry no prefix
  await remember(env, 'james', exchanges('t2', 'Astoria', [msg('u9', 'user', 'Astoria studios near the train'), msg('a9', 'assistant', 'Three studios near the Ditmars station.')]));
  await remember(env, 'erin', exchanges('t3', 'Erin kitchen', [msg('u8', 'user', 'huge kitchen please'), msg('a8', 'assistant', 'huge kitchen dishwasher Greenpoint')]));

  const hits = await search(env, 'james', 'the place with the huge kitchen and dishwasher', { exceptThread: 't9' });
  assert.match(seen.at(-1)!, /^Represent this sentence for searching relevant passages: the place/);
  assert.equal(hits[0].threadId, 't1');
  assert.deepEqual(hits[0].places.sort(), ['op_41', 'op_42']);
  assert.ok(hits.every((h) => h.threadId !== 't3'));                      // never another person's
  assert.deepEqual(await search(env, 'james', 'huge kitchen dishwasher', { exceptThread: 't1' }).then((h) => h.map((x) => x.threadId)), []);   // weak matches are dropped
});

test("a turn spent looking back isn't indexed", () => {
  assert.equal(worthRemembering([{ type: 'text', text: 'You described a Greenpoint loft' }, { type: 'tool-recallChats', output: {} } as any]), false);
  assert.equal(worthRemembering(kitchenChat[1].parts), true);
});

test('an edit removes the exchanges it replaced', async () => {
  const { AI, CHATS, store } = fakes(), env = { AI, CHATS };
  await remember(env, 'james', exchanges('t1', 'Greenpoint', kitchenChat));
  assert.equal(store.size, 2);
  await forget(env, 'james', kitchenChat.slice(2));
  assert.deepEqual([...store.keys()], ['james:a1']);
});

test('old chats are indexed once', async () => {
  const { AI, CHATS, store } = fakes(), { env: e } = d1();
  const env = { AI, CHATS, DB: e.DB };
  assert.equal(await backfill(env, 'james', { t1: { title: 'Greenpoint', updatedAt: '2026-10-10T12:00:00Z', messages: kitchenChat } }), 2);
  assert.equal(store.size, 2);
  assert.equal(await backfill(env, 'james', { t1: { title: 'Greenpoint', updatedAt: '2026-10-10T12:00:00Z', messages: kitchenChat } }), null);
  assert.equal(await backfill(env, 'erin', {}), 0);                       // each person has their own flag
});

test('without the bindings nothing breaks', async () => {
  assert.equal(await remember({}, 'james', exchanges('t1', 'x', kitchenChat)), 0);
  await forget({}, 'james', kitchenChat);
  await assert.rejects(search({}, 'james', 'kitchen'), /not set up/);
});
