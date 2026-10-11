// The saved search is binding: the inbox and Fred's searchListings only show places inside it,
// whatever the sites call the neighbourhood, and Fred can narrow it but not widen it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areaLabel, areasIn, canonicalArea, forgetPlaces, inArea, within } from '../src/areas';
import { search } from '../src/agent/listings';
import { inbox } from '../src/places';
import { applySearch, summarize, view } from '../src/mock';
import { d1 } from './d1';

test('reads the most specific area a site names', () => {
  assert.deepEqual(areasIn('East Harlem'), ['east-harlem']);
  assert.deepEqual(areasIn('Spanish Harlem'), ['east-harlem']);
  assert.deepEqual(areasIn('East Williamsburg'), ['east-williamsburg']);
  assert.deepEqual(areasIn('Bedford- Stuyvesant'), ['bedford-stuyvesant']);
  assert.deepEqual(areasIn('BEDSTUY/BROOKLYN').sort(), ['bedford-stuyvesant', 'brooklyn']);
  assert.deepEqual(areasIn('Harlem / Morningside').sort(), ['central-harlem', 'morningside-heights']);
  assert.deepEqual(areasIn('Brooklyn Heights'), ['brooklyn-heights']);
  assert.deepEqual(areasIn("Hell's Kitchen"), ['hells-kitchen']);
  assert.deepEqual(areasIn('Prospect'), []);
});

test('standard slugs for what people type', () => {
  assert.equal(canonicalArea('Spanish Harlem'), 'east-harlem');
  assert.equal(canonicalArea('bed-stuy'), 'bedford-stuyvesant');
  assert.equal(canonicalArea('LIC'), 'long-island-city');
  assert.equal(canonicalArea('Harlem'), 'central-harlem');
  assert.equal(canonicalArea('Narnia Heights'), 'narnia-heights');
});

test('a neighbourhood is strict; a borough is everything in it', () => {
  const at = (borough: string | null, neighbourhood: string | null) => ({ borough, neighbourhood });
  assert.equal(inArea(at('Manhattan', 'East Harlem'), 'harlem'), false);
  assert.equal(inArea(at('Manhattan', 'Central Harlem'), 'harlem'), true);
  assert.equal(inArea(at('Brooklyn', 'East Williamsburg'), 'williamsburg'), false);
  assert.equal(inArea(at('Manhattan', "Hell's Kitchen"), 'midtown'), true);
  assert.equal(inArea(at('Brooklyn', 'Brooklyn'), 'williamsburg'), false);
  assert.equal(inArea(at(null, 'Sunset Park, Brooklyn'), 'brooklyn'), true);
  assert.equal(inArea(at('Brooklyn', 'Manhattan'), 'manhattan'), false);   // the borough field wins
  assert.equal(inArea(at('Manhattan', 'Upper West Side'), 'manhattan'), true);
});

test('Fred can narrow but not widen', () => {
  assert.equal(within('central-harlem', 'manhattan'), true);
  assert.equal(within('hells-kitchen', 'midtown'), true);
  assert.equal(within('williamsburg', 'manhattan'), false);
  assert.equal(within('manhattan', 'upper-west-side'), false);
});

function seed() {
  forgetPlaces();
  const { env, sql } = d1();
  const add = sql.prepare(`INSERT INTO listings (id, street, neighbourhood, borough, price, beds, baths, first_seen, status) VALUES (?,?,?,?,?,?,?,?, 'active')`);
  const rows: [number, string, string | null, string | null, number, number][] = [
    [1, '1 W 125th St', 'Central Harlem', 'Manhattan', 3000, 2],
    [2, '2 E 116th St', 'Spanish Harlem', 'Manhattan', 3100, 2],
    [3, '3 W 84th St', 'Upper West Side', 'Manhattan', 3900, 2],
    [4, '4 E 80th St', 'Upper East Side', 'Manhattan', 3800, 2],
    [5, '5 Bedford Ave', 'Williamsburg', 'Brooklyn', 3500, 2],
    [6, '6 Grand St', 'East Williamsburg', 'Brooklyn', 3400, 2],
    [7, '7 Nostrand Ave', 'Bed Stuy', null, 3000, 2],
    [8, '8 W 90th St', 'Upper West Side', 'Manhattan', 4300, 2],
  ];
  for (const [id, street, hood, boro, price, beds] of rows) add.run(id, street, hood, boro, price, beds, 1, 1_700_000_000 + id);
  return env.DB as D1Database;
}

const searchFor = (dealbreakers: object) => applySearch(view({ cards: {}, threads: {} }).search,
  { dealbreakers: { areas: [], maxTotalMonthly: 4000, minBeds: 2, minBaths: null, pets: null, noBrokerFee: false, ...dealbreakers } });

test('Fred searches inside the saved search, never outside it', async () => {
  const db = seed();
  const ids = async (saved: object, f: object = {}) => (await search(db, searchFor(saved), f)).found.map((x) => x.listingId).sort();
  assert.deepEqual(await ids({ areas: ['upper-west-side', 'upper-east-side'] }), [3, 4]);
  // Fred leaving out areas still means the saved ones, not all of NYC
  assert.deepEqual(await ids({ areas: ['williamsburg'] }), [5]);
  assert.deepEqual(await ids({ areas: ['brooklyn'] }), [5, 6, 7]);
  // asking for Harlem when the search is the Upper West Side finds nothing, and says why
  const r = await search(db, searchFor({ areas: ['upper-west-side'] }), { areas: ['harlem'] });
  assert.deepEqual([r.found.length, r.outside], [0, ['harlem']]);
  // narrowing works; a higher budget than saved doesn't widen it
  assert.deepEqual(await ids({ areas: ['manhattan'] }, { areas: ['upper-west-side'], maxRent: 9000 }), [3]);
  assert.deepEqual(await ids({ areas: ['manhattan'], excludeAreas: ['harlem', 'east-harlem'] }), [3, 4]);
});

test('the inbox follows the search, and drops Fred places it no longer fits', async () => {
  const db = seed();
  const card = (id: number) => ({ id: `op_${id}`, listingId: id, foundAt: '2026-10-01T00:00:00Z' } as any);
  const st: any = { cards: { op_2: { status: 'saved' } }, threads: {}, created: [card(1), card(2), card(3)] };
  const got = (await inbox(db, 'james', st, searchFor({ areas: ['upper-west-side'] }))).map((c) => c.id).sort();
  // 3 and 8 (a little over budget) fit; Fred's Harlem place 1 goes; 2 stays because it was saved
  assert.deepEqual(got, ['op_2', 'op_3', 'op_8']);
});

// Regression: ISSUE-002 — the same neighbourhood showed under several names ("Spanish Harlem",
// "East Harlem") and junk text showed as-is. Found by /qa on 2026-10-11.
test('one name per neighbourhood on the cards', () => {
  assert.equal(areaLabel('Spanish Harlem', 'Manhattan'), 'East Harlem');
  assert.equal(areaLabel('East Harlem', 'Manhattan'), 'East Harlem');
  assert.equal(areaLabel('WILLIAMSBURG right @ L train MORGAN STOP_________________', 'Brooklyn'), 'Williamsburg');
  assert.equal(areaLabel('Bedford- Stuyvesant', 'Brooklyn'), 'Bed-Stuy');
  assert.equal(areaLabel("Hell's Kitchen", 'Manhattan'), "Hell's Kitchen");
  assert.equal(areaLabel('Prospect', 'Brooklyn'), 'Prospect');
  assert.equal(areaLabel(null, 'Brooklyn'), 'Brooklyn');
  assert.equal(areaLabel(null, null), 'New York');
});

test('saved areas become standard slugs, and the summary says what is left out', () => {
  const s = searchFor({ areas: ['Spanish Harlem', 'east-harlem', 'Bed Stuy'], excludeAreas: ['Harlem'] });
  assert.deepEqual(s.dealbreakers.areas, ['east-harlem', 'bedford-stuyvesant']);
  assert.deepEqual(s.dealbreakers.excludeAreas, ['central-harlem']);
  assert.match(summarize(s), /^East Harlem, Bedford Stuyvesant except Central Harlem/);
});

test('cards use the standard name, including places Fred added earlier', async () => {
  const db = seed();
  const st: any = { cards: {}, threads: {}, created: [{ id: 'op_2', listingId: 2, area: 'Spanish Harlem', foundAt: '2026-10-01T00:00:00Z' }] };
  const cards = await inbox(db, 'james', st, searchFor({ areas: ['manhattan'] }));
  assert.deepEqual(new Set(cards.map((c) => c.area)), new Set(['Central Harlem', 'East Harlem', 'Upper West Side', 'Upper East Side']));
});

test('a search in the same step as a search change sees the new search', async () => {
  const db = seed();
  const { RequestContext } = await import('@mastra/core/request-context');
  const { updateSearch, searchListings } = await import('../src/agent/tools');
  const { save } = await import('../src/mock');
  await save(db, 'james', { cards: {}, threads: {}, search: searchFor({ areas: ['williamsburg'] }) });
  const rc = new RequestContext();
  rc.set('env', { DB: db, ME: 'james' });
  const ctx = { requestContext: rc } as any;
  // the model calls both in one step: they start together, update first
  const [, found] = await Promise.all([
    updateSearch.execute!({ dealbreakers: { areas: ['upper-west-side'] } } as any, ctx),
    searchListings.execute!({} as any, ctx),
  ]);
  assert.deepEqual((found as any).listings.map((l: any) => l.id), ['op_3']);
});
