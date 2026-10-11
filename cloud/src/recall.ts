// Fred's recall of past chats by meaning: "that place with the big kitchen we talked about".
// Each exchange (what the person said + Fred's reply + the places in it) is embedded with Workers AI
// and kept in Vectorize, filtered by person. Saved after every reply; old chats are indexed once,
// the first time someone chats after this shipped. An edited message drops the exchanges after it.
import type { Message } from './mock';

export const MODEL = '@cf/baai/bge-base-en-v1.5';   // 768 dimensions, cosine
// With the search prefix, bge put the right exchange at 0.55-0.59 and unrelated ones at 0.45-0.53
// (measured Oct 11 on real chats). Fred reads the snippets and judges what's left.
const MIN_SCORE = 0.5;
// bge v1.5 ranks better when a search (not a stored exchange) carries this instruction
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';
const INDEX_VERSION = 1;                              // bump to re-index everyone's old chats

export type RecallEnv = { AI?: Ai; CHATS?: VectorizeIndex };
export type Hit = { threadId: string; title: string; when: string; youSaid: string; fredSaid: string; places: string[]; score: number };

const textOf = (parts: Message['parts']) => parts.filter((p) => p.type === 'text').map((p) => String(p.text ?? '')).join(' ').replace(/\s+/g, ' ').trim();

/** place ids an exchange touched: ones Fred added, and [address](place:op_1) links in his reply */
export function placesIn(parts: Message['parts']) {
  const ids = new Set<string>();
  for (const p of parts) {
    if (p.type === 'tool-addToInbox') for (const a of ((p as any).output?.added ?? [])) if (a?.id) ids.add(String(a.id));
    if (p.type === 'data-places') for (const id of ((p as any).data?.ids ?? [])) ids.add(String(id));
    if (p.type === 'text') for (const m of String(p.text ?? '').matchAll(/\(place:(op_\d+)\)/g)) ids.add(m[1]);
  }
  return [...ids];
}

/** A turn where Fred was looking back ("what did I say about…") adds nothing new, and indexing the
 *  question would make the next search find the question instead of the answer. */
export const worthRemembering = (parts: Message['parts']) => !parts.some((p) => p.type === 'tool-recallChats');

/** one exchange per Fred reply: the user message before it, and the reply */
export function exchanges(threadId: string, title: string, messages: Message[], updatedAt?: string) {
  const out: { id: string; threadId: string; title: string; you: string; fred: string; places: string[]; at: number }[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== 'assistant') continue;
    const prev = messages[i - 1]?.role === 'user' ? messages[i - 1] : null;
    const you = prev ? textOf(prev.parts) : '', fred = textOf(m.parts);
    if (!you && !fred) continue;
    out.push({ id: m.id, threadId, title, you, fred, places: placesIn(m.parts), at: Date.parse(updatedAt ?? '') || Date.now() });
  }
  return out;
}

// Vectorize ids are at most 64 bytes: person + Fred's message id
const vid = (user: string, messageId: string) => `${user}:${messageId}`.slice(0, 64);

export async function remember(env: RecallEnv, user: string, xs: ReturnType<typeof exchanges>) {
  if (!env.AI || !env.CHATS || !xs.length) return 0;
  let n = 0;
  for (let i = 0; i < xs.length; i += 50) {
    const batch = xs.slice(i, i + 50);
    const docs = batch.map((x) => `${x.title}\nThey said: ${x.you}\nFred said: ${x.fred}`.slice(0, 2000));
    const { data } = await env.AI.run(MODEL, { text: docs }) as { data: number[][] };
    await env.CHATS.upsert(batch.map((x, j) => ({
      id: vid(user, x.id), values: data[j],
      metadata: { user, threadId: x.threadId, title: x.title.slice(0, 120), at: x.at, you: x.you.slice(0, 500), fred: x.fred.slice(0, 900), places: x.places.join(',') },
    })));
    n += batch.length;
  }
  return n;
}

/** drop exchanges an edit replaced */
export async function forget(env: RecallEnv, user: string, messages: Message[]) {
  const ids = messages.filter((m) => m.role === 'assistant').map((m) => vid(user, m.id));
  if (env.CHATS && ids.length) await env.CHATS.deleteByIds(ids);
}

/** index this person's old chats once. The flag has its own row, so this never races the chat's own save. */
export async function backfill(env: RecallEnv & { DB: D1Database }, user: string, threads: Record<string, { title: string; updatedAt: string; messages: Message[] }>) {
  if (!env.AI || !env.CHATS) return null;
  const k = `recall:${user}`, done = await env.DB.prepare('SELECT v FROM meta WHERE k=?').bind(k).first<{ v: string }>();
  if (Number(done?.v ?? 0) >= INDEX_VERSION) return null;
  const xs = Object.entries(threads).flatMap(([id, t]) => exchanges(id, t.title, t.messages, t.updatedAt));
  const n = await remember(env, user, xs);
  await env.DB.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').bind(k, String(INDEX_VERSION)).run();
  return n;
}

export async function search(env: RecallEnv, user: string, query: string, opts: { exceptThread?: string; limit?: number } = {}): Promise<Hit[]> {
  if (!env.AI || !env.CHATS) throw new Error('Chat recall is not set up here (AI and CHATS bindings).');
  const { data } = await env.AI.run(MODEL, { text: [QUERY_PREFIX + query] }) as { data: number[][] };
  const r = await env.CHATS.query(data[0], { topK: 10, filter: { user }, returnMetadata: 'all' });
  return r.matches
    .filter((m) => m.score >= MIN_SCORE && m.metadata && m.metadata.threadId !== opts.exceptThread)
    .slice(0, opts.limit ?? 5)
    .map((m) => {
      const x = m.metadata as Record<string, any>;
      return { threadId: String(x.threadId), title: String(x.title ?? ''), when: new Date(Number(x.at)).toISOString().slice(0, 10),
               youSaid: String(x.you ?? ''), fredSaid: String(x.fred ?? ''), places: String(x.places ?? '').split(',').filter(Boolean),
               score: Math.round(m.score * 100) / 100 };
    });
}
