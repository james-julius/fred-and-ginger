// What Fred remembers about each person, across chats, and what their saves and passes say.
//
// Memory is Fred's own notes, not a transcript: "I'm ok with 1 bath" is kept as "Prefers 2 baths;
// 1 is acceptable". write() enforces that: it turns away quotes of what they just said and
// first-person text, folds a near-duplicate into the note it repeats, and caps the list so Fred
// merges notes instead of piling them up. The person can correct or delete any note in the app.
import type * as S from '@fng/api';
import type { z } from '@hono/zod-openapi';
import type { MockState } from './mock';
import type { Facts } from './facts';

export type Memory = z.infer<typeof S.Memory>;
type Kind = Memory['kind'];
type Strength = Memory['strength'];

export const MAX_NOTES = 40;
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9$.\s]/g, ' ').split(/\s+/).filter(Boolean);
const norm = (s: string) => words(s).join(' ');

/** share of a's words that are also in b */
function overlap(a: string, b: string) {
  const wa = words(a), wb = new Set(words(b));
  return wa.length ? wa.filter((w) => wb.has(w)).length / wa.length : 0;
}

// "I'm fine with…", "my partner…", "we want…": the person's words, not Fred's understanding
const FIRST_PERSON = /^(i|i'm|im|i've|i'd|my|we|we're|our|me)\b/i;

/** why this text isn't a distilled note, or null if it's fine */
export function notDistilled(text: string, said: string | undefined) {
  const t = text.trim();
  if (t.length < 3) return 'Too short to mean anything.';
  if (t.length > 160) return 'Too long: one fact, under 160 characters.';
  if (FIRST_PERSON.test(t)) return 'Written in their words. Say what it means about them, in third person (e.g. "Prefers 2 baths; 1 is acceptable").';
  if (said && words(t).length >= 4 && (norm(said).includes(norm(t)) || overlap(t, said) >= 0.9))
    return 'That repeats their message. Write what it tells you about them: the preference, how strongly, and any exception.';
  return null;
}

export type Write = {
  add?: { kind: Kind; text: string; strength: Strength; from?: 'said' | 'inferred' }[];
  update?: { id: string; text?: string; kind?: Kind; strength?: Strength }[];
  remove?: string[];
};

/** apply Fred's changes; returns what was refused and why, so he can fix and retry */
export function write(st: MockState, w: Write, said?: string) {
  const notes = [...(st.memory ?? [])], now = new Date().toISOString();
  const refused: { text?: string; id?: string; why: string }[] = [];
  const removed = new Set(w.remove ?? []);
  for (const id of removed) if (!notes.some((n) => n.id === id)) refused.push({ id, why: 'No such note.' });
  for (const u of w.update ?? []) {
    const n = notes.find((x) => x.id === u.id);
    if (!n) { refused.push({ id: u.id, why: 'No such note.' }); continue; }
    const why = u.text != null ? notDistilled(u.text, said) : null;
    if (why) { refused.push({ id: u.id, text: u.text, why }); continue; }
    Object.assign(n, { text: u.text?.trim() ?? n.text, kind: u.kind ?? n.kind, strength: u.strength ?? n.strength, updatedAt: now });
  }
  for (const a of w.add ?? []) {
    const why = notDistilled(a.text, said);
    if (why) { refused.push({ text: a.text, why }); continue; }
    // the same fact again: refresh that note rather than keep two
    const twin = notes.find((n) => !removed.has(n.id) && n.kind === a.kind && overlap(a.text, n.text) >= 0.8 && overlap(n.text, a.text) >= 0.8);
    if (twin) { Object.assign(twin, { text: a.text.trim(), strength: a.strength, updatedAt: now }); continue; }
    if (notes.length - removed.size >= MAX_NOTES) { refused.push({ text: a.text, why: `Memory is full (${MAX_NOTES}). Merge related notes with update, or remove stale ones.` }); continue; }
    notes.push({ id: `m_${crypto.randomUUID().slice(0, 6)}`, kind: a.kind, text: a.text.trim(), strength: a.strength, from: a.from ?? 'said', updatedAt: now });
  }
  st.memory = notes.filter((n) => !removed.has(n.id)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { notes: st.memory, refused };
}

/** the notes as Fred reads them each turn, with ids so he can update them */
export function recall(notes: Memory[] | undefined) {
  if (!notes?.length) return null;
  const order: Kind[] = ['needs', 'dislikes', 'likes', 'life', 'timing', 'working_style'];
  return [...notes].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
    .map((n) => `${n.id} ${n.kind}${n.strength === 'mild' ? '' : ` (${n.strength})`}${n.from === 'inferred' ? ' [inferred]' : ''}: ${n.text}`).join('\n');
}

// ── what their saves and passes say ──────────────────────────────────

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

const FEATURES: [string, (f: Facts) => boolean][] = [
  ['in-unit laundry', (f) => f.laundry === 'in_unit'],
  ['private outdoor space', (f) => f.outdoor === 'private'],
  ['a doorman', (f) => f.doorman],
  ['an elevator', (f) => f.elevator],
  ['a dishwasher', (f) => f.dishwasher],
  ['a walk-up', (f) => f.walkUp],
  ['rent stabilization', (f) => f.rentStabilized],
  ['no broker fee', (f) => f.noFee === true],
];

type Row = { id: number; price: number; beds: number | null; area: string | null; facts: string | null };

/** patterns in what they saved vs passed, and their own notes on places. Hints for Fred, not facts. */
export async function taste(db: D1Database, st: MockState) {
  const picks = Object.entries(st.cards)
    .filter(([id, c]) => /^op_\d+$/.test(id) && (c.status === 'saved' || c.status === 'passed'))
    .map(([id, c]) => ({ id: Number(id.slice(3)), status: c.status as 'saved' | 'passed', note: c.note ?? null }));
  if (!picks.length) return null;
  const rows = new Map<number, Row>();
  for (let i = 0; i < picks.length; i += 90) {
    const ids = picks.slice(i, i + 90).map((p) => p.id);
    const r = await db.prepare(`SELECT id, price, beds, COALESCE(neighbourhood, borough) AS area, facts FROM listings WHERE id IN (${ids.map(() => '?').join(',')})`)
      .bind(...ids).all<Row>();
    for (const x of r.results) rows.set(x.id, x);
  }
  const group = (s: 'saved' | 'passed') => picks.filter((p) => p.status === s && rows.has(p.id)).map((p) => ({ ...p, row: rows.get(p.id)! }));
  const saved = group('saved'), passed = group('passed'), out: string[] = [];
  out.push(`Saved ${saved.length}, passed ${passed.length}.`);

  if (saved.length >= 2 && passed.length >= 2) {
    const ms = median(saved.map((x) => x.row.price)), mp = median(passed.map((x) => x.row.price));
    if (Math.abs(ms - mp) / Math.max(ms, mp) >= 0.08) out.push(`Saved places run ${money(ms)} (median); passed ones ${money(mp)}.`);
  }
  const areas = (xs: typeof saved) => { const m = new Map<string, number>(); for (const x of xs) if (x.row.area) m.set(x.row.area, (m.get(x.row.area) ?? 0) + 1); return m; };
  const sa = areas(saved), pa = areas(passed);
  const likedAreas = [...sa].filter(([a, n]) => n >= 2 && (pa.get(a) ?? 0) < n).map(([a]) => a);
  const passedAreas = [...pa].filter(([a, n]) => n >= 2 && !sa.has(a)).map(([a]) => a);
  if (likedAreas.length) out.push(`Saves keep landing in ${likedAreas.join(', ')}.`);
  if (passedAreas.length) out.push(`Passed on everything seen in ${passedAreas.join(', ')}.`);

  const facts = (x: { row: Row }) => { try { return x.row.facts ? JSON.parse(x.row.facts) as Facts : null; } catch { return null; } };
  for (const [label, has] of FEATURES) {
    const s = saved.map(facts).filter(Boolean) as Facts[], p = passed.map(facts).filter(Boolean) as Facts[];
    const ns = s.filter(has).length, np = p.filter(has).length;
    if (s.length >= 2 && ns >= 2 && ns / s.length >= 0.6 && (p.length === 0 || np / p.length <= ns / s.length - 0.4))
      out.push(`${ns} of ${s.length} saved places have ${label}${p.length ? ` (${np} of ${p.length} passed)` : ''}.`);
    if (p.length >= 3 && np / p.length >= 0.6 && (s.length === 0 || ns / s.length <= np / p.length - 0.4))
      out.push(`${np} of ${p.length} passed places have ${label}${s.length ? ` (${ns} of ${s.length} saved)` : ''}.`);
  }
  // their own words about specific places say the most
  const noted = picks.filter((p) => p.note?.trim()).slice(-8);
  for (const p of noted) {
    const r = rows.get(p.id);
    out.push(`${p.status === 'saved' ? 'Saved' : 'Passed'} op_${p.id}${r ? ` (${r.area ?? 'NYC'}, ${money(r.price)})` : ''}, their note: "${p.note!.trim().slice(0, 140)}"`);
  }
  return out.length > 1 ? out.join('\n') : null;
}
