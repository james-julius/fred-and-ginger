// Each person's state in rows: what goes in comes back out, the old blob is copied in once, and
// two writers working from the same load keep each other's changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, reset, save, type MockState } from '../src/mock';
import { mergeSearch } from '../src/store';
import { d1 } from './d1';

const search = (d: object = {}) => ({
  dealbreakers: { areas: ['williamsburg'], excludeAreas: [], maxTotalMonthly: 4000, minBeds: 1, minBaths: null, pets: null, noBrokerFee: false, moveBy: null, ...d },
  preferences: [{ id: 'p1', label: 'Washer/dryer in unit', weight: 'must' }], commutes: [], watching: true, updatedAt: '2026-10-11T00:00:00Z',
}) as any;
const card = (id: number, at = '2026-10-01T00:00:00Z') => ({ id: `op_${id}`, listingId: id, foundAt: at, area: 'Williamsburg', price: 3000 }) as any;
const msg = (id: string, text: string) => ({ id, role: 'user' as const, parts: [{ type: 'text', text }] });

const full = (): MockState => ({
  cards: { op_1: { status: 'saved', seen: true, savedAt: '2026-10-02T00:00:00Z' }, op_7: { note: 'ask about heat' } },
  created: [card(2), card(1)],
  search: search(),
  alerts: { mode: 'daily' } as any,
  tours: [{ id: 'tour_a', opportunityId: 'op_1', status: 'draft' } as any],
  threads: { t1: { title: 'Hunt', updatedAt: '2026-10-11T01:00:00Z', messages: [msg('m1', 'hi'), msg('m2', 'more')] } },
  profile: { name: 'James', photo: null },
  memory: [{ id: 'n1', kind: 'likes', text: 'light', updatedAt: '2026-10-11T02:00:00Z' } as any, { id: 'n2', kind: 'dislikes', text: 'walk-ups', updatedAt: '2026-10-10T00:00:00Z' } as any],
  someLaterField: { kept: true },
} as any);

test('what is saved comes back the same', async () => {
  const { env } = d1(), db = env.DB;
  await save(db, 'james', full());
  assert.deepEqual(await load(db, 'james'), full());
  // unset tours mean the example tours; an empty list stays empty
  await save(db, 'erin', { cards: {}, threads: {} });
  assert.equal((await load(db, 'erin')).tours, undefined);
  await save(db, 'erin', { cards: {}, threads: {}, tours: [] });
  assert.deepEqual((await load(db, 'erin')).tours, []);
});

test('the old blob is copied in once and kept as a backup', async () => {
  const { env, sql } = d1(), db = env.DB;
  sql.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run('mock:james', JSON.stringify(full()));
  assert.deepEqual(await load(db, 'james'), full());
  // changes after the copy stick; the blob isn't read again or changed
  const st = await load(db, 'james');
  st.cards.op_9 = { status: 'passed' };
  await save(db, 'james', st);
  assert.equal((await load(db, 'james')).cards.op_9?.status, 'passed');
  assert.deepEqual(JSON.parse((sql.prepare('SELECT v FROM meta WHERE k=?').get('mock:james') as any).v), JSON.parse(JSON.stringify(full())));
});

test('two writers from the same load keep both changes', async () => {
  const { env } = d1(), db = env.DB;
  await save(db, 'james', full());
  const a = await load(db, 'james'), b = await load(db, 'james');
  // a: saves a place and remembers something. b: Fred adds a card, notes another place, adds a message
  a.cards.op_3 = { status: 'saved' };
  a.memory = [{ id: 'n3', kind: 'likes', text: 'parks', updatedAt: '2026-10-11T03:00:00Z' } as any, ...a.memory!];
  b.created = [card(5), ...b.created!];
  b.cards.op_7 = { note: 'heat is included' };
  b.threads.t1.messages.push(msg('m3', 'and Bushwick?'));
  await save(db, 'james', a);
  await save(db, 'james', b);
  const st = await load(db, 'james');
  assert.equal(st.cards.op_3?.status, 'saved');
  assert.deepEqual(st.memory!.map((n) => n.id), ['n3', 'n1', 'n2']);
  assert.deepEqual(st.created!.map((c) => c.id), ['op_5', 'op_2', 'op_1']);
  assert.equal(st.cards.op_7?.note, 'heat is included');
  assert.deepEqual(st.threads.t1.messages.map((m) => m.id), ['m1', 'm2', 'm3']);
});

test('search changes from stale copies are merged field by field', async () => {
  const { env } = d1(), db = env.DB;
  await save(db, 'james', full());
  const a = await load(db, 'james'), b = await load(db, 'james');
  a.search = { ...a.search!, dealbreakers: { ...a.search!.dealbreakers, maxTotalMonthly: 4500 } };
  b.search = { ...b.search!, dealbreakers: { ...b.search!.dealbreakers, areas: ['williamsburg', 'greenpoint'] } };
  await save(db, 'james', a);
  await save(db, 'james', b);
  const d = (await load(db, 'james')).search!.dealbreakers;
  assert.equal(d.maxTotalMonthly, 4500);
  assert.deepEqual(d.areas, ['williamsburg', 'greenpoint']);
  // saving again from the same object keeps working (its revision moved on)
  b.search = { ...b.search!, dealbreakers: { ...b.search!.dealbreakers, minBeds: 2 } };
  await save(db, 'james', b);
  assert.deepEqual((await load(db, 'james')).search!.dealbreakers.minBeds, 2);
  assert.equal((await load(db, 'james')).search!.dealbreakers.maxTotalMonthly, 4500);
});

test('merging takes only the fields this save changed', () => {
  const base = JSON.stringify(search()), mine = JSON.stringify(search({ minBeds: 2 })), theirs = JSON.stringify(search({ maxTotalMonthly: 5000 }));
  assert.deepEqual(JSON.parse(mergeSearch(base, mine, theirs)).dealbreakers, search({ minBeds: 2, maxTotalMonthly: 5000 }).dealbreakers);
});

test('removals are saved: a cut-short thread, a forgotten note, a cancelled tour, a dropped card', async () => {
  const { env } = d1(), db = env.DB;
  await save(db, 'james', full());
  const st = await load(db, 'james');
  st.threads.t1.messages = st.threads.t1.messages.slice(0, 1);
  st.memory = st.memory!.filter((n) => n.id !== 'n2');
  st.tours = [];
  st.created = st.created!.filter((c) => c.id !== 'op_2');
  await save(db, 'james', st);
  const back = await load(db, 'james');
  assert.deepEqual(back.threads.t1.messages.map((m) => m.id), ['m1']);
  assert.deepEqual(back.memory!.map((n) => n.id), ['n1']);
  assert.deepEqual(back.tours, []);
  assert.deepEqual(back.created!.map((c) => c.id), ['op_1']);
});

test('reset starts over, blob included', async () => {
  const { env, sql } = d1(), db = env.DB;
  sql.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run('mock:james', JSON.stringify(full()));
  await load(db, 'james');
  await reset(db, 'james');
  assert.deepEqual(await load(db, 'james'), { cards: {}, threads: {} });
});
