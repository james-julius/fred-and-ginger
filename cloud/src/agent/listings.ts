// Fred's view of the real listings in D1: search them, and turn one into an inbox card or a
// full listing. When Postgres arrives this file is what changes; the tools stay the same.
import type * as S from '@fng/api';
import type { z } from '@hono/zod-openapi';
import { nearby, transitLabel } from '../transit';
import { ranking, safetyFor } from '../safety';
import { highlights, notShareSql, petsLabel, petsSql, scamSigns, typicalKey, typicalRents, type Facts } from '../facts';

type Card = z.infer<typeof S.OpportunityCard>;
type Detail = z.infer<typeof S.OpportunityDetail>;
type VerdictKind = z.infer<typeof S.Verdict>['kind'];

export type Filters = {
  areas?: string[]; maxRent?: number; minBeds?: number; minBaths?: number;
  noFeeOnly?: boolean; minBuildingScore?: number; limit?: number; pets?: 'dogs' | 'cats' | 'dogs_and_cats' | null;
};

export type Found = {
  listingId: number; address: string; area: string | null; borough: string | null;
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
  /** only when the city record is genuinely bad (score under 60): what to warn about */
  buildingWarning: string[] | null;
};

const json = <T>(s: string | null | undefined, d: T): T => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

export async function search(db: D1Database, f: Filters) {
  const where = [`l.status='active'`, 'l.price > 0'], args: unknown[] = [];
  if (f.maxRent) { where.push('l.price <= ?'); args.push(f.maxRent); }
  if (f.minBeds != null) { where.push('l.beds >= ?'); args.push(f.minBeds); }
  if (f.minBaths != null) { where.push('l.baths >= ?'); args.push(f.minBaths); }
  if (f.noFeeOnly) where.push('(l.no_fee IS NULL OR l.no_fee = 1)');
  const pets = petsSql(f.pets);
  if (pets) where.push(pets);
  where.push(notShareSql);
  if (f.minBuildingScore != null) { where.push('COALESCE(b.score, 100) >= ?'); args.push(f.minBuildingScore); }
  if (f.areas?.length) {
    // "east-village" matches "East Village"; a borough name matches its whole borough
    where.push('(' + f.areas.map(() => '(lower(l.neighbourhood) LIKE ? OR lower(l.borough) LIKE ?)').join(' OR ') + ')');
    for (const a of f.areas) { const q = '%' + a.toLowerCase().replace(/-/g, ' ') + '%'; args.push(q, q); }
  }
  const total = await db.prepare(`SELECT count(*) AS n FROM listings l LEFT JOIN buildings b ON b.bbl=l.bbl WHERE ${where.join(' AND ')}`).bind(...args).first<{ n: number }>();
  const rows = await db.prepare(
    `SELECT l.id, l.street, l.unit, l.neighbourhood, l.borough, l.price, l.beds, l.baths, l.sqft, l.no_fee, l.available, l.photos, l.facts, l.lat, l.lon,
            b.score AS bscore, b.report AS breport,
            (SELECT group_concat(DISTINCT CASE WHEN instr(s.source, ':') > 0 THEN substr(s.source, 1, instr(s.source, ':') - 1) ELSE s.source END) FROM sightings s WHERE s.listing_id = l.id) AS sites
     FROM listings l LEFT JOIN buildings b ON b.bbl = l.bbl
     WHERE ${where.join(' AND ')} ORDER BY COALESCE(b.score, 60) DESC, l.first_seen DESC LIMIT ?`).bind(...args, Math.min(f.limit ?? 15, 40)).all<any>();
  const typical = await typicalRents(db, rows.results.map((r) => r.neighbourhood)), ranks = await ranking(db);
  const safety = await Promise.all(rows.results.map((r) => safetyFor(db, r.lat, r.lon, ranks)));
  const found: Found[] = rows.results.map((r, i) => {
    const fx = json<Facts | null>(r.facts, null), t = typical.get(typicalKey(r.neighbourhood, r.beds)) ?? null, trains = nearby(r.lat, r.lon);
    return {
      listingId: r.id, address: [r.street, r.unit && `#${r.unit}`].filter(Boolean).join(' '), area: r.neighbourhood, borough: r.borough,
      price: r.price, beds: r.beds, baths: r.baths, sqft: r.sqft, noFee: r.no_fee == null ? null : !!r.no_fee, available: r.available,
      sites: (r.sites ?? '').split(',').filter(Boolean), photo: json<string[]>(r.photos, [])[0] ?? null,
      highlights: highlights(fx, { price: r.price, noFee: r.no_fee, typical: t, train: trains[0] && trains[0].walkMinutes <= 6 ? transitLabel(trains[0]) : null }, { pets: f.pets }).slice(0, 5),
      subway: trains.slice(0, 3).map(transitLabel),
      areaTypical: t, pets: petsLabel(fx?.pets ?? null), monthsFree: fx?.monthsFree ?? null, rentStabilized: !!fx?.rentStabilized,
      scamSigns: scamSigns(fx, r.price, t),
      areaSafety: safety[i] ? `${safety[i]!.label} (${safety[i]!.violent} violent crimes reported within ${safety[i]!.radiusMeters} m in a year)` : null,
      buildingWarning: r.bscore != null && r.bscore < 60 ? (json<{ flags?: string[] }>(r.breport, {}).flags ?? []).slice(0, 2) : null,
    };
  });
  return { total: total?.n ?? 0, found };
}

const LABELS: Record<VerdictKind, [string, 'good' | 'warn' | 'bad' | 'neutral']> = {
  strong_fit: ['Strong fit', 'good'], good_fit: ['Good fit', 'good'], over_budget_with_fees: ['Over budget with fees', 'warn'],
  price_dropped: ['Price dropped', 'good'], broker_fee: ['Broker fee', 'warn'], building_issues: ['Building issues', 'warn'],
  likely_scam: ['Hidden: likely scam', 'bad'], gone: ['Gone', 'neutral'],
};

export async function toCard(db: D1Database, listingId: number, pick: { verdict: VerdictKind; reason?: string | null; highlight?: string | null; fit: number }): Promise<Card | null> {
  const r = await db.prepare('SELECT id, neighbourhood, borough, price, beds, baths, photos, lat, lon FROM listings WHERE id=?').bind(listingId).first<any>();
  if (!r) return null;
  const [label, tone] = LABELS[pick.verdict];
  return {
    id: `op_${r.id}`, listingId: r.id, foundAt: new Date().toISOString(), seen: false,
    status: pick.verdict === 'likely_scam' ? 'hidden' : 'new',
    price: r.price, totalMonthly: r.price, area: r.neighbourhood ?? r.borough ?? 'New York', beds: r.beds ?? 0, baths: r.baths,
    transit: nearby(r.lat, r.lon)[0] ?? null, highlight: pick.highlight ?? null, thumbnail: json<string[]>(r.photos, [])[0] ?? null,
    fit: Math.max(0, Math.min(100, Math.round(pick.fit))), verdict: { kind: pick.verdict, label, tone, reason: pick.reason ?? null }, feeCallout: null,
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
  const why = highlights(fx, { price: r.price, noFee: r.no_fee, typical, train: trains[0] ? transitLabel(trains[0]) : null });
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
    costs: { rent: r.price, netEffective: r.net_effective, monthsFree: fx?.monthsFree ?? null, leaseMonths: null, monthlyFees: 0, totalMonthly: r.price,
             brokerFee: r.no_fee == null ? (fx?.noFee ? 'none' : 'unknown') : r.no_fee ? 'none' : 'tenant', moveInEstimate: null, fees: [] },
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
