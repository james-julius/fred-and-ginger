// The inbox from real listings in D1: every active listing that passes this person's
// dealbreakers, plus the places Fred added, plus anything they saved or passed on. Each person's
// changes (seen, status, note) sit on top. Saving or passing also writes the old grid's votes
// table, and a vote cast there shows here, so both UIs agree until the grid is retired.
import type * as S from '@fng/api';
import type { z } from '@hono/zod-openapi';
import type { Card, MockState } from './mock';
import { nearby, transitLabel } from './transit';
import { cellOf, toSafety } from './safety';
import { highlights, notShareSql, petsSql, scamSigns, typicalKey, typicalRents, type Facts } from './facts';

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

const COLS = `l.id, l.neighbourhood, l.borough, l.price, l.beds, l.baths, l.no_fee, l.photos, l.first_seen, l.status, l.price_history, l.facts, l.lat, l.lon,
              b.score AS bscore, b.report AS breport`;

/**
 * A first take for a listing nobody has judged yet, the way a realtor cousin would size it up:
 * is it a good deal, does it have what you want, anything to steer clear of. Fred's own verdict
 * replaces it. The building record only counts against a place when it's genuinely bad.
 */
function judge(r: any, s: Search, typical: number | null, safer: boolean): { kind: VerdictKind; reason: string | null; fit: number; highlight: string | null } {
  const d = s.dealbreakers, f = json<Facts | null>(r.facts, null), rep = json<{ flags?: string[] }>(r.breport, {});
  const hist = json<any[]>(r.price_history, []).map((h) => Number(Array.isArray(h) ? h[1] : h?.price)).filter(Number.isFinite);
  const dropped = hist.length > 1 && r.price < Math.max(...hist);
  const t = nearby(r.lat, r.lon)[0];
  const hl = highlights(f, { price: r.price, noFee: r.no_fee, typical, safer, train: t && t.walkMinutes <= 6 ? transitLabel(t) : null }, { pets: d.pets, preferences: s.preferences.map((p) => p.label) });
  let fit = 55 + Math.min(25, hl.length * 6);
  if (t) fit += t.walkMinutes <= 5 ? 5 : t.walkMinutes > 12 ? -5 : 0;
  if (typical) fit += Math.max(-10, Math.min(15, ((typical - r.price) / typical) * 60));
  if (d.maxTotalMonthly) fit += r.price <= d.maxTotalMonthly ? 5 : -15;
  if (r.bscore != null && r.bscore < 40) fit -= 20;
  const highlight = hl[0] ?? null, scam = scamSigns(f, r.price, typical);
  if (scam.length) return { kind: 'likely_scam', reason: scam[0], fit: 0, highlight: null };
  if (r.status === 'gone') return { kind: 'gone', reason: null, fit, highlight };
  if (d.maxTotalMonthly && r.price > d.maxTotalMonthly) return { kind: 'over_budget_with_fees', reason: `$${(r.price - d.maxTotalMonthly).toLocaleString('en-US')} over budget`, fit, highlight };
  if (r.bscore != null && r.bscore < 40) return { kind: 'building_issues', reason: rep.flags?.[0] ?? 'The building has a bad record with the city', fit, highlight };
  if (r.no_fee === 0) return { kind: 'broker_fee', reason: null, fit, highlight };
  if (dropped) return { kind: 'price_dropped', reason: `Was $${Math.max(...hist).toLocaleString('en-US')}`, fit: fit + 5, highlight };
  return { kind: fit >= 75 ? 'strong_fit' : 'good_fit', reason: null, fit, highlight };
}

function card(r: any, s: Search, now: number, typical: number | null, safer = false): Card {
  const v = judge(r, s, typical, safer), [label, tone] = LABELS[v.kind], found = (r.first_seen ?? 0) * 1000;
  return {
    id: `op_${r.id}`, listingId: r.id, foundAt: new Date(found || now).toISOString(), seen: now - found > FRESH_MS,
    status: v.kind === 'likely_scam' ? 'hidden' : 'new', price: r.price, totalMonthly: r.price, area: r.neighbourhood ?? r.borough ?? 'New York', beds: r.beds ?? 0, baths: r.baths,
    transit: nearby(r.lat, r.lon)[0] ?? null, highlight: v.highlight, thumbnail: json<string[]>(r.photos, [])[0] ?? null,
    fit: Math.max(0, Math.min(100, Math.round(v.fit))), verdict: { kind: v.kind, label, tone, reason: v.reason }, feeCallout: null,
  };
}

const VOTE: Record<number, Card['status']> = { 1: 'saved', [-1]: 'passed' };

/** Everything in this person's inbox, newest first, with their changes applied. */
export async function inbox(db: D1Database, user: string, st: MockState, s: Search, now = Date.now()): Promise<Card[]> {
  const d = s.dealbreakers, where = [`l.status='active'`, 'l.price > 0'], args: unknown[] = [];
  if (d.maxTotalMonthly) { where.push('l.price <= ?'); args.push(Math.round(d.maxTotalMonthly * 1.1)); } // a little over still shows, flagged
  if (d.minBeds != null) { where.push('l.beds >= ?'); args.push(d.minBeds); }
  // unknown baths, fee or pet policy stay in: most sites don't say, and the card or Fred flags it
  if (d.minBaths != null) { where.push('(l.baths IS NULL OR l.baths >= ?)'); args.push(d.minBaths); }
  if (d.noBrokerFee) where.push('(l.no_fee IS NULL OR l.no_fee = 1)');
  const pets = petsSql(d.pets);
  if (pets) where.push(pets);
  where.push(notShareSql);
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
  const rows = [...(matched.results as any[]), ...(voted.results as any[])];
  const typical = await typicalRents(db, rows.map((r) => r.neighbourhood));
  // area safety for every checked cell (a few hundred small rows), ranked against each other
  const areas = (await db.prepare('SELECT cell, violent, property, total, report FROM areas').all<any>()).results;
  const ranks = areas.length >= 50 ? areas.map((a) => a.violent).sort((a, b) => a - b) : null;
  const byCell = new Map(areas.map((a) => [a.cell, a]));
  const safer = (r: any) => { const a = r.lat != null && ranks && byCell.get(cellOf(r.lat, r.lon)); return !!a && toSafety(a, ranks!).percentile < 30; };
  const byId = new Map<string, Card>();
  for (const c of st.created ?? []) byId.set(c.id, c);
  for (const r of rows) {
    const id = `op_${r.id}`;
    if (!byId.has(id)) byId.set(id, card(r, s, now, typical.get(typicalKey(r.neighbourhood, r.beds)) ?? null, safer(r)));
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
