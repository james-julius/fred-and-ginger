// Fred's view of the real listings in D1: search them, and turn one into an inbox card or a
// full listing. When Postgres arrives this file is what changes; the tools stay the same.
import type * as S from '@fng/api';
import type { z } from '@hono/zod-openapi';
import { nearby, transitLabel } from '../transit';
import { ranking, safetyFor } from '../safety';
import { costsOf, feeCallout, highlights, petsLabel, petsSql, scamSigns, typicalKey, typicalRents, type Facts } from '../facts';
import { areaSql, within } from '../areas';
import { dealbreakerWhere } from '../filter';
import { judge } from '../places';

type Card = z.infer<typeof S.OpportunityCard>;
type Search = z.infer<typeof S.Search>;
type Detail = z.infer<typeof S.OpportunityDetail>;
type VerdictKind = z.infer<typeof S.Verdict>['kind'];

export type Filters = {
  areas?: string[]; maxRent?: number; minBeds?: number; minBaths?: number;
  noFeeOnly?: boolean; minBuildingScore?: number; limit?: number; pets?: 'dogs' | 'cats' | 'dogs_and_cats' | null;
};

export type Found = {
  listingId: number;
  /** 0-100, the inbox's first take on how well it fits the saved search */
  fit: number;
  address: string; area: string | null; borough: string | null;
  price: number; beds: number | null; baths: number | null; sqft: number | null; noFee: boolean | null;
  available: string | null; sites: string[]; photo: string | null;
  /** what's good about it, best first: a deal vs the area, then laundry, outdoor space, pets… */
  highlights: string[];
  /** the area's median rent for this many bedrooms, when there are enough listings to say */
  areaTypical: number | null;
  pets: string | null; monthsFree: number | null; rentStabilized: boolean;
  /** nearest trains, e.g. "4 min to the L at Morgan Av" */
  subway: string[];
  /** scam signs: if any, hide it with likely_scam */
  scamSigns: string[];
  /** crime reported nearby vs other rental spots, e.g. "Less crime than most places for rent" */
  areaSafety: string | null;
  /** rent plus required monthly fees the listing names (amenity, pet, utilities) */
  totalMonthly: number;
  /** the listing's own fees, e.g. "Application fee $20 once", when its page was read */
  fees: string[];
  /** utilities included in the rent */
  utilities: string[];
  floor: number | null; leaseMonths: number | null;
  /** only when the city record is genuinely bad (score under 60): what to warn about */
  buildingWarning: string[] | null;
};

const json = <T>(s: string | null | undefined, d: T): T => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

/**
 * Fred's search always runs inside the saved search: his filters can narrow it (a smaller area, a
 * lower budget) but never widen it. To widen, he changes the saved search first. Results are
 * ranked by how well they fit this person, the same first take the inbox shows.
 */
export async function search(db: D1Database, saved: Search, f: Filters) {
  const { where, args } = await dealbreakerWhere(db, saved.dealbreakers);
  // what Fred asked for that the saved search rules out: it can't widen, so say so
  const savedAreas = saved.dealbreakers.areas ?? [], excluded = saved.dealbreakers.excludeAreas ?? [];
  const outside = (f.areas ?? []).filter((a) => (savedAreas.length && !savedAreas.some((s) => within(a, s))) || excluded.some((x) => within(a, x)));
  if (f.areas?.length) { const a = await areaSql(db, f.areas, undefined); if (a) where.push(a); }
  if (f.maxRent) { where.push('l.price <= ?'); args.push(f.maxRent); }
  if (f.minBeds != null) { where.push('l.beds >= ?'); args.push(f.minBeds); }
  if (f.minBaths != null) { where.push('(l.baths IS NULL OR l.baths >= ?)'); args.push(f.minBaths); }
  if (f.noFeeOnly) where.push('(l.no_fee IS NULL OR l.no_fee = 1)');
  const pets = petsSql(f.pets);
  if (pets) where.push(pets);
  if (f.minBuildingScore != null) { where.push('COALESCE(b.score, 100) >= ?'); args.push(f.minBuildingScore); }
  const total = await db.prepare(`SELECT count(*) AS n FROM listings l LEFT JOIN buildings b ON b.bbl=l.bbl WHERE ${where.join(' AND ')}`).bind(...args).first<{ n: number }>();
  // the newest few hundred, ranked by fit, best first
  const pool = await db.prepare(
    `SELECT l.id, l.street, l.unit, l.neighbourhood, l.borough, l.price, l.beds, l.baths, l.sqft, l.no_fee, l.available, l.photos, l.facts, l.lat, l.lon, l.status, l.price_history,
            b.score AS bscore, b.report AS breport,
            (SELECT group_concat(DISTINCT CASE WHEN instr(s.source, ':') > 0 THEN substr(s.source, 1, instr(s.source, ':') - 1) ELSE s.source END) FROM sightings s WHERE s.listing_id = l.id) AS sites
     FROM listings l LEFT JOIN buildings b ON b.bbl = l.bbl
     WHERE ${where.join(' AND ')} ORDER BY l.first_seen DESC LIMIT 300`).bind(...args).all<any>();
  const typical = await typicalRents(db, pool.results.map((r) => r.neighbourhood));
  const fitOf = new Map(pool.results.map((r) => [r.id, judge(r, saved, typical.get(typicalKey(r.neighbourhood, r.beds)) ?? null, false).fit]));
  const rows = { results: [...pool.results].sort((a, b) => fitOf.get(b.id)! - fitOf.get(a.id)!).slice(0, Math.min(f.limit ?? 15, 40)) };
  const ranks = await ranking(db);
  const safety = await Promise.all(rows.results.map((r) => safetyFor(db, r.lat, r.lon, ranks)));
  const found: Found[] = rows.results.map((r, i) => {
    const fx = json<Facts | null>(r.facts, null), t = typical.get(typicalKey(r.neighbourhood, r.beds)) ?? null, trains = nearby(r.lat, r.lon);
    return {
      listingId: r.id, fit: Math.round(fitOf.get(r.id)!), address: [r.street, r.unit && `#${r.unit}`].filter(Boolean).join(' '), area: r.neighbourhood, borough: r.borough,
      price: r.price, beds: r.beds, baths: r.baths, sqft: r.sqft, noFee: r.no_fee == null ? null : !!r.no_fee, available: r.available,
      sites: (r.sites ?? '').split(',').filter(Boolean), photo: json<string[]>(r.photos, [])[0] ?? null,
      highlights: highlights(fx, { price: r.price, noFee: r.no_fee, typical: t, sqft: r.sqft, beds: r.beds, train: trains[0] && trains[0].walkMinutes <= 6 ? transitLabel(trains[0]) : null }, { pets: f.pets }).slice(0, 5),
      subway: trains.slice(0, 3).map(transitLabel),
      areaTypical: t, pets: petsLabel(fx?.pets ?? null), monthsFree: fx?.monthsFree ?? null, rentStabilized: !!fx?.rentStabilized,
      scamSigns: scamSigns(fx, r.price, t),
      totalMonthly: costsOf(r.price, r.net_effective ?? null, r.no_fee, fx).totalMonthly,
      fees: (fx?.fees ?? []).map((x) => `${x.label}${x.amount ? ` $${x.amount.toLocaleString('en-US')}` : ''} ${x.period === 'monthly' ? 'a month' : 'once'}${x.required ? '' : ' (optional)'}`).slice(0, 8),
      utilities: fx?.utilities ?? [], floor: fx?.floor ?? null, leaseMonths: fx?.leaseMonths ?? null,
      areaSafety: safety[i] ? `${safety[i]!.label} (${safety[i]!.violent} violent crimes reported within ${safety[i]!.radiusMeters} m in a year)` : null,
      buildingWarning: r.bscore != null && r.bscore < 60 ? (json<{ flags?: string[] }>(r.breport, {}).flags ?? []).slice(0, 2) : null,
    };
  });
  return { total: total?.n ?? 0, found, outside };
}

const LABELS: Record<VerdictKind, [string, 'good' | 'warn' | 'bad' | 'neutral']> = {
  strong_fit: ['Strong fit', 'good'], good_fit: ['Good fit', 'good'], over_budget_with_fees: ['Over budget with fees', 'warn'],
  price_dropped: ['Price dropped', 'good'], broker_fee: ['Broker fee', 'warn'], building_issues: ['Building issues', 'warn'],
  likely_scam: ['Hidden: likely scam', 'bad'], gone: ['Gone', 'neutral'],
};

export async function toCard(db: D1Database, listingId: number, pick: { verdict: VerdictKind; reason?: string | null; highlight?: string | null; fit: number }): Promise<Card | null> {
  const r = await db.prepare('SELECT id, neighbourhood, borough, price, beds, baths, sqft, no_fee, facts, photos, lat, lon FROM listings WHERE id=?').bind(listingId).first<any>();
  if (!r) return null;
  const [label, tone] = LABELS[pick.verdict];
  return {
    id: `op_${r.id}`, listingId: r.id, foundAt: new Date().toISOString(), seen: false,
    status: pick.verdict === 'likely_scam' ? 'hidden' : 'new',
    price: r.price, totalMonthly: costsOf(r.price, null, r.no_fee, json<Facts | null>(r.facts, null)).totalMonthly, area: r.neighbourhood ?? r.borough ?? 'New York', beds: r.beds ?? 0, baths: r.baths, sqft: r.sqft ?? null,
    transit: nearby(r.lat, r.lon)[0] ?? null, highlight: pick.highlight ?? null, thumbnail: json<string[]>(r.photos, [])[0] ?? null,
    fit: Math.max(0, Math.min(100, Math.round(pick.fit))), verdict: { kind: pick.verdict, label, tone, reason: pick.reason ?? null }, feeCallout: feeCallout(r.no_fee, json<Facts | null>(r.facts, null)),
  };
}

/** The full listing behind a card Fred created. */
export async function detail(db: D1Database, card: Card): Promise<Detail | null> {
  const r = await db.prepare(`SELECT l.*, b.score AS bscore, b.report AS breport FROM listings l LEFT JOIN buildings b ON b.bbl=l.bbl WHERE l.id=?`).bind(card.listingId).first<any>();
  if (!r) return null;
  const sights = await db.prepare('SELECT source, url, price FROM sightings WHERE listing_id=?').bind(card.listingId).all<any>();
  const rep = json<{ score?: number; flags?: string[]; good?: string[] } | null>(r.breport, null);
  const fx = json<Facts | null>(r.facts, null);
  const typical = (await typicalRents(db, [r.neighbourhood])).get(typicalKey(r.neighbourhood, r.beds)) ?? null;
  const trains = nearby(r.lat, r.lon);
  const why = highlights(fx, { price: r.price, noFee: r.no_fee, typical, sqft: r.sqft, beds: r.beds, train: trains[0] ? transitLabel(trains[0]) : null });
  const concerns = [
    ...(card.verdict.reason ? [card.verdict.reason] : []),
    ...(rep?.score != null && rep.score < 60 ? (rep.flags ?? []).slice(0, 2) : []),
    ...(!fx?.pets ? ['Pet policy not listed: ask before you tour'] : []),
    ...(r.no_fee == null && !fx?.noFee ? ['Not clear who pays the broker: ask'] : []),
  ];
  const history = json<unknown[]>(r.price_history, []).flatMap((h: any) => {
    // stored as [unix seconds, price]; arrays have a built-in .at, so check the shape first
    const [at, price] = Array.isArray(h) ? [h[0], Number(h[1])] : [h?.at, Number(h?.price)];
    return Number.isFinite(price) && at ? [{ at: new Date(typeof at === 'number' ? at * 1000 : at).toISOString(), price }] : [];
  });
  return {
    ...card,
    address: r.street ?? '', unit: r.unit, sqft: r.sqft, available: r.available, description: fx?.description ?? null,
    photos: json<string[]>(r.photos, []),
    costs: costsOf(r.price, r.net_effective, r.no_fee, fx),
    amenities: fx?.amenities ?? [], pets: petsLabel(fx?.pets ?? null),
    building: rep?.score != null ? { score: rep.score, flags: rep.flags ?? [], good: rep.good ?? [] } : null,
    sources: sights.results.map((s) => ({ site: String(s.source).split(':')[0], url: s.url, price: s.price })),
    priceHistory: history,
    take: { why: [...new Set([...(card.highlight ? [card.highlight] : []), ...why])].slice(0, 5), concerns: [...new Set(concerns)] },
    note: null,
    location: r.lat != null && r.lon != null ? { lat: r.lat, lon: r.lon } : null,
    safety: await safetyFor(db, r.lat, r.lon),
  };
}
