// Canned API behaviour while the real backend is built. Each person's changes are kept in D1
// (meta table, key mock:<user>) on top of the example data in packages/api, so the app behaves
// like the real thing: saving moves a place to Saved, opening one clears its dot, search edits
// stick, and the chat answers what you send. POST /api/mock/reset starts over.
import { fixtures } from '@fng/api';
import type * as S from '@fng/api';
import type { z } from '@hono/zod-openapi';

type I<T extends z.ZodType> = z.infer<T>;
export type Card = I<typeof S.OpportunityCard>;
type Search = I<typeof S.Search>;
type Alerts = I<typeof S.Alerts>;
type Tour = I<typeof S.Tour>;
type SearchPatch = I<typeof S.SearchPatch>;
type Part = { type: string; [k: string]: unknown };
export type Message = { id: string; role: 'user' | 'assistant'; parts: Part[] };

export type MockState = {
  cards: Record<string, { seen?: boolean; status?: Card['status']; note?: string | null }>;
  search?: Search;
  alerts?: Alerts;
  tours?: Tour[];
  /** places Fred added from real listings, newest first */
  created?: Card[];
  threads: Record<string, { title: string; updatedAt: string; messages: Message[] }>;
  profile?: { name?: string; photo?: string | null };
};

const empty = (): MockState => ({ cards: {}, threads: {} });

export async function load(db: D1Database, user: string): Promise<MockState> {
  const r = await db.prepare('SELECT v FROM meta WHERE k=?').bind(`mock:${user}`).first<{ v: string }>();
  return r ? { ...empty(), ...JSON.parse(r.v) } : empty();
}
export async function save(db: D1Database, user: string, st: MockState) {
  await db.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').bind(`mock:${user}`, JSON.stringify(st)).run();
}
export async function reset(db: D1Database, user: string) {
  await db.prepare('DELETE FROM meta WHERE k=?').bind(`mock:${user}`).run();
}

const title = (s: string) => s.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
export function summarize(s: Search) {
  const d = s.dealbreakers, bits = [d.areas.map(title).join(', ') || 'Anywhere'];
  if (d.minBeds != null) bits.push(`${d.minBeds} bed${d.minBaths != null ? `, ${d.minBaths} bath` : ''}`);
  return bits.join(' · ');
}

export function applySearch(s: Search, p: SearchPatch): Search {
  return { ...s, ...p, dealbreakers: { ...s.dealbreakers, ...p.dealbreakers }, updatedAt: new Date().toISOString() };
}

/** The example data with this person's changes applied. */
export function view(st: MockState, now = new Date()) {
  const f = fixtures(now);
  const search = st.search ?? f.search, alerts = st.alerts ?? f.alerts, tours = st.tours ?? f.tours;
  const cards: Card[] = [...(st.created ?? []), ...f.cards].map((c) => ({ ...c, ...st.cards[c.id] }));
  const upcoming = tours.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
  const me = { ...f.me, alerts, summary: summarize(search), counts: {
    new: cards.filter((c) => c.status === 'new' && !c.seen).length,
    saved: cards.filter((c) => c.status === 'saved').length,
    tours: upcoming.length,
  } };
  const threads: MockState['threads'] = { thread_1: { title: f.threads[0].title, updatedAt: f.threads[0].updatedAt, messages: f.messages as Message[] }, ...st.threads };
  return { ...f, search, alerts, tours, cards, me, threads };
}

/** /api/me for the signed-in person: their own name (default: their login) and photo. */
export function meFor(st: MockState, user: string, now = new Date()) {
  const me = view(st, now).me;
  const name = st.profile?.name ?? user.charAt(0).toUpperCase() + user.slice(1);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  return { ...me, user: { id: user, name, initials, photo: st.profile?.photo ?? null } };
}

/* ── chat ─────────────────────────────────────────────────────────────── */

const text = (t: string): Part => ({ type: 'text', text: t });
const suggestions = (...options: { label: string; patch: SearchPatch | null }[]): Part => ({ type: 'data-suggestions', data: { options } });
const watch = (now: Date): Part => ({ type: 'data-watch', data: { state: 'watching', lastCheckedAt: now.toISOString(), nextCheckAt: new Date(now.getTime() + 2 * 3600_000).toISOString() } });
const searchUpdated = (changed: string[], s: Search): Part => ({ type: 'data-search-updated', data: { changed, dealbreakers: s.dealbreakers } });

/**
 * Fred's canned reply. Returns the parts to stream, and the search after any change.
 * - first message in a thread: the mockup's turn
 * - a quick-reply label: applies its change
 * - a listing open: Fred's take on it
 * - anything else: a short demo reply with quick replies
 */
export function reply(st: MockState, threadId: string, said: string, opportunityId?: string | null) {
  const v = view(st), now = new Date();
  const mockupTurn = v.messages[1].parts as Part[];
  const quick = (mockupTurn.find((p) => p.type === 'data-suggestions') as unknown as { data: { options: { label: string; patch: SearchPatch | null }[] } }).data.options;
  const history = v.threads[threadId]?.messages ?? [];
  let search = v.search;

  if (opportunityId) {
    const d = v.details[opportunityId], c = v.cards.find((x) => x.id === opportunityId);
    if (c) {
      const why = d?.take.why ?? [c.highlight ?? `${c.beds} bed, ${c.baths} bath`];
      const concerns = d?.take.concerns ?? (c.feeCallout ? [`${c.feeCallout.label} puts it over budget`] : []);
      return { search, parts: [
        text(`Here's my take on the ${c.area} place at $${c.price.toLocaleString('en-US')}.\n\nWhy it fits: ${why.join('; ')}.` + (concerns.length ? `\n\nWorth knowing: ${concerns.join('; ')}.` : '')),
        suggestions({ label: 'Book a tour', patch: null }, { label: 'Save it', patch: null }, { label: 'Show me similar places', patch: null }),
      ] };
    }
  }

  const q = quick.find((o) => o.label.toLowerCase() === said.trim().toLowerCase());
  if (q?.patch) {
    search = applySearch(search, q.patch);
    const changed = Object.keys(q.patch.dealbreakers ?? {});
    return { search, parts: [searchUpdated(changed, search), text(`Done. I've updated your search to ${summarize(search)}. I'll check again now and put anything new in your inbox.`), watch(now)] };
  }
  if (q) return { search, parts: [text("Okay, I'll keep your search as it is and message you when a strong fit comes in."), watch(now)] };

  if (!history.length) return { search: { ...search, dealbreakers: (mockupTurn[0] as unknown as { data: { dealbreakers: Search['dealbreakers'] } }).data.dealbreakers }, parts: mockupTurn };

  return { search, parts: [
    text("I'm still a demo, so I can only answer with examples for now. The real me is being built. Try one of these:"),
    suggestions(...quick),
  ] };
}
