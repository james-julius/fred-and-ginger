// Must-haves are enforced in code: a place that clearly lacks one never reaches the person, from
// the inbox, Fred's search or Fred adding it. One whose listing doesn't say stays, unconfirmed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkMusts } from '../src/musts';
import { forgetPlaces } from '../src/areas';
import { search } from '../src/agent/listings';
import { inbox } from '../src/places';
import { applySearch, save, view } from '../src/mock';
import { d1 } from './d1';

const facts = (x: object) => JSON.stringify({ pets: null, laundry: null, outdoor: null, elevator: false, walkUp: false, dishwasher: false, doorman: false, gym: false, rentStabilized: false, ...x });

test('reads a must-have against what the listing says', () => {
  const f = (x: object) => JSON.parse(facts(x));
  assert.deepEqual(checkMusts(['Washer/dryer in unit'], f({ laundry: 'in_unit' })), { lacks: [], unconfirmed: [] });
  assert.deepEqual(checkMusts(['Washer/dryer in unit'], f({ laundry: 'in_building' })), { lacks: ['Washer/dryer in unit'], unconfirmed: [] });
  assert.deepEqual(checkMusts(['Washer/dryer in unit'], f({})), { lacks: [], unconfirmed: ['Washer/dryer in unit'] });
  assert.deepEqual(checkMusts(['Laundry in building'], f({ laundry: 'in_unit' })), { lacks: [], unconfirmed: [] });
  assert.deepEqual(checkMusts(['Private balcony'], f({ outdoor: 'shared' })).lacks, ['Private balcony']);
  assert.deepEqual(checkMusts(['Elevator'], f({ walkUp: true })).lacks, ['Elevator']);
  // something the data can't check is never a reason to drop a place
  assert.deepEqual(checkMusts(['Near a park'], f({})), { lacks: [], unconfirmed: ['Near a park'] });
  assert.deepEqual(checkMusts(['Washer/dryer in unit'], null), { lacks: [], unconfirmed: ['Washer/dryer in unit'] });
});

function seed() {
  forgetPlaces();
  const { env, sql } = d1();
  const add = sql.prepare(`INSERT INTO listings (id, street, neighbourhood, borough, price, beds, baths, first_seen, status, facts) VALUES (?,?,?,?,?,?,?,?, 'active', ?)`);
  add.run(1, '1 Bedford Ave', 'Williamsburg', 'Brooklyn', 3000, 1, 1, 1_700_000_001, facts({ laundry: 'in_unit' }));
  add.run(2, '2 Bedford Ave', 'Williamsburg', 'Brooklyn', 3000, 1, 1, 1_700_000_002, facts({ laundry: 'in_building' }));
  add.run(3, '3 Bedford Ave', 'Williamsburg', 'Brooklyn', 3000, 1, 1, 1_700_000_003, facts({}));
  return env.DB as D1Database;
}
const withMust = applySearch(view({ cards: {}, threads: {} }).search, {
  dealbreakers: { areas: ['williamsburg'], excludeAreas: [], maxTotalMonthly: 4000, minBeds: 1, minBaths: null, pets: null, noBrokerFee: false },
  preferences: [{ id: 'p1', label: 'Washer/dryer in unit', weight: 'must' }],
});

test("Fred's search drops places that lack a must-have and marks the unknowns", async () => {
  const r = await search(seed(), withMust, {});
  assert.deepEqual(r.found.map((l) => [l.listingId, l.unconfirmed]).sort(), [[1, []], [3, ['Washer/dryer in unit']]]);
  assert.equal(r.lacking, 1);
});

test('the inbox leaves out places that lack a must-have, unless they saved one', async () => {
  const db = seed();
  const ids = async (st: any) => (await inbox(db, 'james', st, withMust)).map((c) => c.id).sort();
  assert.deepEqual(await ids({ cards: {}, threads: {} }), ['op_1', 'op_3']);
  // a place Fred added that lacks it goes too; one they saved stays
  const created = [2].map((id) => ({ id: `op_${id}`, listingId: id, foundAt: '2026-10-01T00:00:00Z', area: 'Williamsburg' }));
  assert.deepEqual(await ids({ cards: {}, threads: {}, created }), ['op_1', 'op_3']);
  assert.deepEqual(await ids({ cards: { op_2: { status: 'saved' } }, threads: {}, created }), ['op_1', 'op_2', 'op_3']);
});

test("addToInbox refuses a place that lacks a must-have, whatever Fred's verdict", async () => {
  const db = seed();
  const { RequestContext } = await import('@mastra/core/request-context');
  const { searchListings, addToInbox } = await import('../src/agent/tools');
  await save(db, 'james', { cards: {}, threads: {}, search: withMust });
  const rc = new RequestContext();
  rc.set('env', { DB: db, ME: 'james' });
  rc.set('seenListings', new Set<number>([2]));   // as if an earlier step had seen it
  const ctx = { requestContext: rc } as any;
  await searchListings.execute!({} as any, ctx);
  const r: any = await addToInbox.execute!({ places: [
    { id: 'op_1', verdict: 'strong_fit', fit: 90 }, { id: 'op_2', verdict: 'strong_fit', fit: 95 },
  ] } as any, ctx);
  assert.deepEqual(r.added.map((x: any) => x.id), ['op_1']);
  assert.deepEqual(r.refused, [{ id: 'op_2', lacks: ['Washer/dryer in unit'] }]);
});
