// The saved search as SQL. The inbox and Fred's searchListings both start here, so a place that
// doesn't fit the search can't reach the person either way. Unknown baths, fee or pet policy stay
// in: most sites don't say, and the card or Fred flags it.
import type * as S from '@fng/api';
import type { z } from '@hono/zod-openapi';
import { areaSql } from './areas';
import { notShareSql, petsSql } from './facts';

type Dealbreakers = z.infer<typeof S.Dealbreakers>;

export type Where = { where: string[]; args: unknown[] };

/** `slack` lets a little over budget through (the inbox shows it, flagged); Fred gets none. */
export async function dealbreakerWhere(db: D1Database, d: Partial<Dealbreakers>, opts: { slack?: number } = {}): Promise<Where> {
  const where = [`l.status='active'`, 'l.price > 0', notShareSql], args: unknown[] = [];
  if (d.maxTotalMonthly) { where.push('l.price <= ?'); args.push(Math.round(d.maxTotalMonthly * (opts.slack ?? 1))); }
  if (d.minBeds != null) { where.push('l.beds >= ?'); args.push(d.minBeds); }
  if (d.minBaths != null) { where.push('(l.baths IS NULL OR l.baths >= ?)'); args.push(d.minBaths); }
  if (d.noBrokerFee) where.push('(l.no_fee IS NULL OR l.no_fee = 1)');
  const pets = petsSql(d.pets);
  if (pets) where.push(pets);
  const areas = await areaSql(db, d.areas, d.excludeAreas);
  if (areas) where.push(areas);
  return { where, args };
}
