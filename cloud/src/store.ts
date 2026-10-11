// Each person's state, kept in rows (migrations/0010). Code still loads the whole state, changes it
// and saves it, but save writes only the rows that changed since that load, in one transaction.
// So a tool saving a place and another updating the search don't overwrite each other, and two
// writers only collide when they change the same row. The search carries a revision: a save made
// from a stale copy re-applies just its own changes on top of the newer search.
//
// The first load for a person copies their old blob (meta mock:<user>) in, and leaves it as a backup.
import type { MockState, Message } from './mock';

type Row = Record<string, unknown>;
/** what each row looked like at load, as JSON, to compare against at save */
type Snap = {
  person: { profile: string | null; alerts: string | null; extra: string | null } | null;
  search: string | null; rev: number | null;
  places: Map<string, { state: string | null; card: string | null }>;
  threads: Map<string, string>; messages: Map<string, string>;
  tours: Map<string, string>; memories: Map<string, string>;
};
const snaps = new WeakMap<MockState, Snap>();

const KNOWN = new Set(['cards', 'search', 'alerts', 'tours', 'created', 'threads', 'profile', 'memory']);
const j = (v: unknown) => (v === undefined ? null : JSON.stringify(v));
const parse = <T>(s: string | null | undefined): T | undefined => (s == null ? undefined : JSON.parse(s));
const msgKey = (thread: string, idx: number) => `${thread}\t${idx}`;

/** the rows a state is made of */
function rowsOf(st: MockState) {
  const extra: Row = {};
  for (const [k, v] of Object.entries(st)) if (!KNOWN.has(k) && v !== undefined) extra[k] = v;
  // tours left unset mean "the example tours"; an empty list means none
  if (st.tours) extra._toursSet = true;
  const places = new Map<string, { state: string | null; card: string | null }>();
  for (const c of st.created ?? []) places.set(c.id, { state: null, card: JSON.stringify(c) });
  for (const [id, s] of Object.entries(st.cards ?? {})) places.set(id, { state: JSON.stringify(s), card: places.get(id)?.card ?? null });
  const threads = new Map<string, string>(), messages = new Map<string, string>();
  for (const [id, t] of Object.entries(st.threads ?? {})) {
    threads.set(id, JSON.stringify({ title: t.title, updatedAt: t.updatedAt }));
    t.messages.forEach((m, i) => messages.set(msgKey(id, i), JSON.stringify(m)));
  }
  return {
    person: { profile: j(st.profile), alerts: j(st.alerts), extra: Object.keys(extra).length ? JSON.stringify(extra) : null },
    search: j(st.search), places, threads, messages,
    tours: new Map((st.tours ?? []).map((t, i) => [t.id, JSON.stringify({ tour: t, pos: i })])),
    memories: new Map((st.memory ?? []).map((n) => [n.id, JSON.stringify(n)])),
    createdOrder: (st.created ?? []).map((c) => c.id),
  };
}

async function readRows(db: D1Database, user: string) {
  const q = (sql: string) => db.prepare(sql).bind(user);
  const [person, search, places, threads, messages, tours, memories] = await db.batch([
    q('SELECT profile, alerts, extra FROM people WHERE user=?'),
    q('SELECT search, rev FROM saved_searches WHERE user=?'),
    q('SELECT id, state, card, added_at FROM places WHERE user=? ORDER BY added_at DESC'),
    q('SELECT id, title, updated_at FROM threads WHERE user=?'),
    q('SELECT thread, idx, message FROM messages WHERE user=? ORDER BY thread, idx'),
    q('SELECT id, tour FROM tours WHERE user=? ORDER BY pos'),
    q(`SELECT id, note FROM memories WHERE user=? ORDER BY json_extract(note, '$.updatedAt') DESC, rowid`),   // ties keep their order, as memory.ts's sort does
  ]);
  const rs = (r: D1Result) => (r.results ?? []) as any[];
  return { person: rs(person)[0], search: rs(search)[0], places: rs(places), threads: rs(threads), messages: rs(messages), tours: rs(tours), memories: rs(memories) };
}

/** This person's state, from their rows. */
export async function loadState(db: D1Database, user: string): Promise<MockState> {
  let r = await readRows(db, user);
  if (!r.person && (await migrateBlob(db, user))) r = await readRows(db, user);
  const extra = parse<Row>(r.person?.extra) ?? {};
  const { _toursSet, ...rest } = extra;
  const st: MockState = { ...rest, cards: {}, threads: {} };
  if (r.search) st.search = JSON.parse(r.search.search);
  if (r.person?.alerts) st.alerts = JSON.parse(r.person.alerts);
  if (r.person?.profile) st.profile = JSON.parse(r.person.profile);
  const created = r.places.filter((p) => p.card).map((p) => JSON.parse(p.card));
  if (created.length) st.created = created;
  for (const p of r.places) if (p.state) st.cards[p.id] = JSON.parse(p.state);
  for (const t of r.threads) st.threads[t.id] = { title: t.title, updatedAt: t.updated_at, messages: [] };
  for (const m of r.messages) st.threads[m.thread]?.messages.push(JSON.parse(m.message) as Message);
  if (_toursSet || r.tours.length) st.tours = r.tours.map((t) => JSON.parse(t.tour).tour);
  if (r.memories.length) st.memory = r.memories.map((m) => JSON.parse(m.note));
  snaps.set(st, {
    person: r.person ? { profile: r.person.profile, alerts: r.person.alerts, extra: r.person.extra } : null,
    search: r.search?.search ?? null, rev: r.search?.rev ?? null,
    places: new Map(r.places.map((p) => [p.id, { state: p.state, card: p.card }])),
    threads: new Map(r.threads.map((t) => [t.id, JSON.stringify({ title: t.title, updatedAt: t.updated_at })])),
    messages: new Map(r.messages.map((m) => [msgKey(m.thread, m.idx), m.message])),
    tours: new Map(r.tours.map((t) => [t.id, t.tour])),
    memories: new Map(r.memories.map((m) => [m.id, m.note])),
  });
  return st;
}

/**
 * Save what changed since this state was loaded. A state that wasn't loaded (a reset, a test)
 * replaces everything. Returns once every changed row is written, in one transaction.
 */
export async function saveState(db: D1Database, user: string, st: MockState) {
  const before = snaps.get(st), now = rowsOf(st), full = !before;
  const was: Snap = before ?? { person: null, search: null, rev: null, places: new Map(), threads: new Map(), messages: new Map(), tours: new Map(), memories: new Map() };
  const sts: D1PreparedStatement[] = [], p = (sql: string, ...a: unknown[]) => sts.push(db.prepare(sql).bind(...a));

  const person = now.person, wp = was.person;
  if (full || !wp || wp.profile !== person.profile || wp.alerts !== person.alerts || wp.extra !== person.extra) {
    p(`INSERT INTO people (user, profile, alerts, extra) VALUES (?,?,?,?)
       ON CONFLICT (user) DO UPDATE SET profile=excluded.profile, alerts=excluded.alerts, extra=excluded.extra`, user, person.profile, person.alerts, person.extra);
  }

  // places: a place's state and Fred's card are written separately, so one writer saving a place
  // and another adding a card to it don't undo each other. A new or changed card goes on top:
  // newer than anything there, oldest of this batch first.
  const fresh = now.createdOrder.filter((id) => full || now.places.get(id)!.card !== was.places.get(id)?.card);
  for (const id of [...fresh].reverse()) {
    p(`INSERT INTO places (user, id, card, added_at) VALUES (?, ?, ?, (SELECT MAX(COALESCE(MAX(added_at), 0) + 1, ?) FROM places WHERE user=?))
       ON CONFLICT (user, id) DO UPDATE SET card=excluded.card, added_at=excluded.added_at`, user, id, now.places.get(id)!.card, Date.now(), user);
  }
  for (const [id, row] of now.places) {
    const old = was.places.get(id);
    if (full || old?.state !== row.state) p(`INSERT INTO places (user, id, state) VALUES (?,?,?) ON CONFLICT (user, id) DO UPDATE SET state=excluded.state`, user, id, row.state);
    if (!full && old?.card && !row.card) p('UPDATE places SET card=NULL, added_at=NULL WHERE user=? AND id=?', user, id);
  }
  for (const id of was.places.keys()) if (!now.places.has(id)) p('DELETE FROM places WHERE user=? AND id=?', user, id);

  for (const [id, row] of now.threads) {
    if (full || was.threads.get(id) !== row) { const t = JSON.parse(row); p(`INSERT INTO threads (user, id, title, updated_at) VALUES (?,?,?,?) ON CONFLICT (user, id) DO UPDATE SET title=excluded.title, updated_at=excluded.updated_at`, user, id, t.title, t.updatedAt); }
  }
  for (const id of was.threads.keys()) if (!now.threads.has(id)) { p('DELETE FROM threads WHERE user=? AND id=?', user, id); p('DELETE FROM messages WHERE user=? AND thread=?', user, id); }
  for (const [k, m] of now.messages) {
    if (full || was.messages.get(k) !== m) { const [thread, idx] = k.split('\t'); p(`INSERT INTO messages (user, thread, idx, message) VALUES (?,?,?,?) ON CONFLICT (user, thread, idx) DO UPDATE SET message=excluded.message`, user, thread, Number(idx), m); }
  }
  // a thread cut short (an edited message drops what came after)
  for (const k of was.messages.keys()) if (!now.messages.has(k)) { const [thread, idx] = k.split('\t'); if (now.threads.has(thread)) p('DELETE FROM messages WHERE user=? AND thread=? AND idx=?', user, thread, Number(idx)); }

  for (const [id, row] of now.tours) if (full || was.tours.get(id) !== row) p(`INSERT INTO tours (user, id, tour, pos) VALUES (?,?,?,?) ON CONFLICT (user, id) DO UPDATE SET tour=excluded.tour, pos=excluded.pos`, user, id, row, JSON.parse(row).pos);
  for (const id of was.tours.keys()) if (!now.tours.has(id)) p('DELETE FROM tours WHERE user=? AND id=?', user, id);

  for (const [id, row] of now.memories) if (full || was.memories.get(id) !== row) p(`INSERT INTO memories (user, id, note) VALUES (?,?,?) ON CONFLICT (user, id) DO UPDATE SET note=excluded.note`, user, id, row);
  for (const id of was.memories.keys()) if (!now.memories.has(id)) p('DELETE FROM memories WHERE user=? AND id=?', user, id);

  if (full) {
    // a whole-state save replaces whatever else is there
    const keep = (m: Map<string, unknown>) => [...m.keys()];
    p(`DELETE FROM places WHERE user=? AND id NOT IN (SELECT value FROM json_each(?))`, user, JSON.stringify(keep(now.places)));
    p(`UPDATE places SET card=NULL, added_at=NULL WHERE user=? AND id NOT IN (SELECT value FROM json_each(?))`, user, JSON.stringify(now.createdOrder));
    p(`DELETE FROM threads WHERE user=? AND id NOT IN (SELECT value FROM json_each(?))`, user, JSON.stringify(keep(now.threads)));
    p(`DELETE FROM messages WHERE user=? AND (thread || char(9) || idx) NOT IN (SELECT value FROM json_each(?))`, user, JSON.stringify(keep(now.messages)));
    p(`DELETE FROM tours WHERE user=? AND id NOT IN (SELECT value FROM json_each(?))`, user, JSON.stringify(keep(now.tours)));
    p(`DELETE FROM memories WHERE user=? AND id NOT IN (SELECT value FROM json_each(?))`, user, JSON.stringify(keep(now.memories)));
    if (now.search == null) p('DELETE FROM saved_searches WHERE user=?', user);
  }
  if (sts.length) await db.batch(sts);

  let rev = was.rev, search = now.search;
  if (now.search != null && (full || now.search !== was.search)) {
    ({ rev, search } = await saveSearch(db, user, now.search, was, full));
    // a merge wrote more than this copy had: carry on from what's stored
    if (search !== now.search) st.search = JSON.parse(search!);
  }

  snaps.set(st, {
    person, search, rev,
    places: now.places,
    threads: now.threads, messages: now.messages, tours: now.tours, memories: now.memories,
  });
}

/**
 * Write the search if nobody else changed it since load; otherwise put just the fields this save
 * changed on top of the newer one, so neither change is lost. Returns the new revision.
 */
async function saveSearch(db: D1Database, user: string, search: string, was: Snap, full: boolean): Promise<{ rev: number; search: string }> {
  if (full || was.rev == null) {
    await db.prepare(`INSERT INTO saved_searches (user, search, rev) VALUES (?,?,1) ON CONFLICT (user) DO UPDATE SET search=excluded.search, rev=rev+1`).bind(user, search).run();
    return { rev: ((await db.prepare('SELECT rev FROM saved_searches WHERE user=?').bind(user).first<{ rev: number }>())?.rev) ?? 1, search };
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const cur = await db.prepare('SELECT search, rev FROM saved_searches WHERE user=?').bind(user).first<{ search: string; rev: number }>();
    const expect = attempt === 0 ? was.rev : cur?.rev ?? was.rev;
    const next = attempt === 0 || !cur ? search : mergeSearch(was.search, search, cur.search);
    const r = await db.prepare('UPDATE saved_searches SET search=?, rev=rev+1 WHERE user=? AND rev=?').bind(next, user, expect).run();
    if ((r.meta?.changes ?? 0) > 0) return { rev: expect + 1, search: next };
  }
  throw new Error('The search kept changing while saving; try again');
}

/** this save's changes (base → mine) applied to the newer search, field by field */
export function mergeSearch(base: string | null, mine: string, theirs: string): string {
  const b = base ? JSON.parse(base) : {}, m = JSON.parse(mine), t = JSON.parse(theirs);
  const out = { ...t };
  for (const k of Object.keys(m)) {
    if (k === 'dealbreakers') {
      out.dealbreakers = { ...t.dealbreakers };
      for (const d of Object.keys(m.dealbreakers ?? {})) if (JSON.stringify(m.dealbreakers[d]) !== JSON.stringify(b.dealbreakers?.[d])) out.dealbreakers[d] = m.dealbreakers[d];
    } else if (JSON.stringify(m[k]) !== JSON.stringify(b[k])) out[k] = m[k];
  }
  return JSON.stringify(out);
}

/** Copy the old blob in, once. Whoever's copy lands first wins; the blob stays as a backup. */
async function migrateBlob(db: D1Database, user: string): Promise<boolean> {
  const blob = await db.prepare('SELECT v FROM meta WHERE k=?').bind(`mock:${user}`).first<{ v: string }>();
  if (!blob) return false;
  const st: MockState = { cards: {}, threads: {}, ...JSON.parse(blob.v) };
  const now = rowsOf(st), at = Date.now(), sts: D1PreparedStatement[] = [];
  const p = (sql: string, ...a: unknown[]) => sts.push(db.prepare(sql).bind(...a));
  p('INSERT OR IGNORE INTO people (user, profile, alerts, extra, migrated_at) VALUES (?,?,?,?,?)', user, now.person.profile, now.person.alerts, now.person.extra, at);
  if (now.search) p('INSERT OR IGNORE INTO saved_searches (user, search, rev) VALUES (?,?,1)', user, now.search);
  const n = now.createdOrder.length;
  for (const [id, r] of now.places) { const i = now.createdOrder.indexOf(id); p('INSERT OR IGNORE INTO places (user, id, state, card, added_at) VALUES (?,?,?,?,?)', user, id, r.state, r.card, r.card ? at + (n - i) : null); }
  for (const [id, row] of now.threads) { const t = JSON.parse(row); p('INSERT OR IGNORE INTO threads (user, id, title, updated_at) VALUES (?,?,?,?)', user, id, t.title, t.updatedAt); }
  for (const [k, m] of now.messages) { const [thread, idx] = k.split('\t'); p('INSERT OR IGNORE INTO messages (user, thread, idx, message) VALUES (?,?,?,?)', user, thread, Number(idx), m); }
  for (const [id, row] of now.tours) p('INSERT OR IGNORE INTO tours (user, id, tour, pos) VALUES (?,?,?,?)', user, id, row, JSON.parse(row).pos);
  for (const [id, row] of now.memories) p('INSERT OR IGNORE INTO memories (user, id, note) VALUES (?,?,?)', user, id, row);
  await db.batch(sts);
  return true;
}

/** Start this person over: every row, and the old blob. */
export async function resetState(db: D1Database, user: string) {
  await db.batch(['people', 'saved_searches', 'places', 'threads', 'messages', 'tours', 'memories'].map((t) => db.prepare(`DELETE FROM ${t} WHERE user=?`).bind(user))
    .concat(db.prepare('DELETE FROM meta WHERE k=?').bind(`mock:${user}`)));
}
