// The inbox from real listings in D1: every active listing that passes this person's
// dealbreakers, plus the places Fred added, plus anything they saved or passed on. Each person's
// changes (seen, status, note) sit on top. Saving or passing also writes the old grid's votes
// table, and a vote cast there shows here, so both UIs agree until the grid is retired.
import type * as S from '@fng/api';
import type { z } from '@hono/zod-openapi';
import type { Card, MockState } from './mock';

type Search = z.infer<typeof S.Search>;
type VerdictKind = z.infer<typeof S.Verdict>['kind'];

/** listings first seen longer ago than this start out seen, so the inbox isn't hundreds of dots */
const FRESH_MS = 3 * 86400_000;
const MAX = 200;

const json = <T>(s: string | null | undefined, d: T): T => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

const LABELS: Record<VerdictKind, [string, 'good' | 'warn' | 'bad' | 'neutral']> = {
  strong_fit: ['Strong fit', 'good'], good_fit: ['Good fit', 'good'], over_budget_with_fees: ['Over budget with fees', 'warn'],
  price_dropped: ['Price dropped', 'good'], broker_fee: ['Broker fee', 'warn'], building_issues: ['Building issues', 'warn'],
  likely_scam: ['Hidden: likely scam', 'bad'], gone: ['Gone', 'neutral'],
};

const COLS = `l.id, l.neighbourhood, l.borough, l.price, l.beds, l.baths, l.no_fee, l.photos, l.first_seen, l.status, l.price_history,
              b.score AS bscore, b.report AS breport`;

/** A rules verdict for a listing nobody has judged yet. Fred's own verdicts replace these. */
function judge(r: any, s: Search): { kind: VerdictKind; reason: string | null; fit: number; highlight: string | null } {
  const d = s.dealbreakers, flags = json<{ flags?: string[]; good?: string[] }>(r.breport, {});
  const hist = json<any[]>(r.price_history, []).map((h) => Number(Array.isArray(h) ? h[1] : h?.price)).filter(Number.isFinite);
  const dropped = hist.length > 1 && r.price < Math.max(...hist);
  let fit = 60;
  if (r.bscore != null) fit += (r.bscore - 60) / 2;
  if (d.maxTotalMonthly) fit += Math.max(-20, Math.min(15, ((d.maxTotalMonthly - r.price) / d.maxTotalMonthly) * 60));
  if (r.no_fee === 1) fit += 5;
  const good = flags.good?.[0] ?? null;
  if (r.status === 'gone') return { kind: 'gone', reason: null, fit, highlight: good };
  if (d.maxTotalMonthly && r.price > d.maxTotalMonthly) return { kind: 'over_budget_with_fees', reason: `$${(r.price - d.maxTotalMonthly).toLocaleString('en-US')} over budget`, fit, highlight: good };
  if (r.bscore != null && r.bscore < 50) return { kind: 'building_issues', reason: flags.flags?.[0] ?? null, fit, highlight: good };
  if (r.no_fee === 0) return { kind: 'broker_fee', reason: null, fit, highlight: good };
  if (dropped) return { kind: 'price_dropped', reason: `Was $${Math.max(...hist).toLocaleString('en-US')}`, fit: fit + 5, highlight: good };
  return { kind: fit >= 75 ? 'strong_fit' : 'good_fit', reason: null, fit, highlight: good };
}

function card(r: any, s: Search, now: number): Card {
  const v = judge(r, s), [label, tone] = LABELS[v.kind], found = (r.first_seen ?? 0) * 1000;
  return {
    id: `op_${r.id}`, listingId: r.id, foundAt: new Date(found || now).toISOString(), seen: now - found > FRESH_MS,
    status: 'new', price: r.price, totalMonthly: r.price, area: r.neighbourhood ?? r.borough ?? 'New York', beds: r.beds ?? 0, baths: r.baths,
    transit: null, highlight: v.highlight, thumbnail: json<string[]>(r.photos, [])[0] ?? null,
    fit: Math.max(0, Math.min(100, Math.round(v.fit))), verdict: { kind: v.kind, label, tone, reason: v.reason }, feeCallout: null,
  };
}

const VOTE: Record<number, Card['status']> = { 1: 'saved', [-1]: 'passed' };

/** Everything in this person's inbox, newest first, with their changes applied. */
export async function inbox(db: D1Database, user: string, st: MockState, s: Search, now = Date.now()): Promise<Card[]> {
  const d = s.dealbreakers, where = [`l.status='active'`, 'l.price > 0'], args: unknown[] = [];
  if (d.maxTotalMonthly) { where.push('l.price <= ?'); args.push(Math.round(d.maxTotalMonthly * 1.1)); } // a little over still shows, flagged
  if (d.minBeds != null) { where.push('l.beds >= ?'); args.push(d.minBeds); }
  if (d.minBaths != null) { where.push('l.baths >= ?'); args.push(d.minBaths); }
  if (d.noBrokerFee) where.push('l.no_fee = 1');
  if (d.areas.length) {
    // "east-village" matches "East Village"; a borough name matches its whole borough
    where.push('(' + d.areas.map(() => '(lower(l.neighbourhood) LIKE ? OR lower(l.borough) LIKE ?)').join(' OR ') + ')');
    for (const a of d.areas) { const q = '%' + a.toLowerCase().replace(/-/g, ' ') + '%'; args.push(q, q); }
  }
  // places this person acted on stay, even if the search no longer matches them
  const touched = Object.keys(st.cards).map((id) => Number(id.replace(/^op_/, ''))).filter(Number.isFinite);
  const [matched, voted] = await db.batch([
    db.prepare(`SELECT ${COLS} FROM listings l LEFT JOIN buildings b ON b.bbl=l.bbl WHERE ${where.join(' AND ')} ORDER BY l.first_seen DESC LIMIT ${MAX}`).bind(...args),
    db.prepare(`SELECT ${COLS}, v.vote, v.note FROM votes v JOIN listings l ON l.id=v.listing_id LEFT JOIN buildings b ON b.bbl=l.bbl
                WHERE v.user=? AND (v.vote IN (1,-1) OR v.note IS NOT NULL ${touched.length ? `OR l.id IN (${touched.join(',')})` : ''})`).bind(user),
  ]);
  const byId = new Map<string, Card>();
  for (const c of st.created ?? []) byId.set(c.id, c);
  for (const r of [...(matched.results as any[]), ...(voted.results as any[])]) {
    const id = `op_${r.id}`;
    if (!byId.has(id)) byId.set(id, card(r, s, now));
  }
  // the old grid's vote is the default; a change made in the new app wins
  const votes = new Map((voted.results as any[]).map((r) => [`op_${r.id}`, r]));
  for (const [id, c] of byId) {
    const v = votes.get(id), mine = st.cards[id];
    byId.set(id, { ...c, ...(v && VOTE[v.vote] && { status: VOTE[v.vote], seen: true }), ...mine });
  }
  return [...byId.values()].sort((a, b) => b.foundAt.localeCompare(a.foundAt));
}

/** Mirror a status or note change into the old grid's votes table. */
export async function vote(db: D1Database, user: string, card: Card, p: { status?: Card['status']; note?: string | null }) {
  const v = p.status === 'saved' ? 1 : p.status === 'passed' ? -1 : p.status ? 0 : null;
  if (v == null && p.note === undefined) return;
  await db.prepare(`INSERT INTO votes (listing_id, user, vote, note, updated) VALUES (?,?,?,?,?)
                    ON CONFLICT (listing_id, user) DO UPDATE SET vote=COALESCE(excluded.vote, vote), note=${p.note !== undefined ? 'excluded.note' : 'note'}, updated=excluded.updated`)
    .bind(card.listingId, user, v, p.note ?? null, Math.floor(Date.now() / 1000)).run();
}

export function counts(cards: Card[], tours: { status: string }[]) {
  return {
    new: cards.filter((c) => c.status === 'new' && !c.seen).length,
    saved: cards.filter((c) => c.status === 'saved').length,
    tours: tours.filter((t) => t.status !== 'done' && t.status !== 'cancelled').length,
  };
}
