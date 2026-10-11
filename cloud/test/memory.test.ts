// Fred's memory: notes are his understanding, not quotes; repeats fold into one note; the person's
// saves and passes become hints. Run: npm test (from cloud/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notDistilled, recall, taste, write, MAX_NOTES } from '../src/memory';
import type { MockState } from '../src/mock';
import { d1 } from './d1';

const fresh = (): MockState => ({ cards: {}, threads: {} });

test('a quote or first-person text is sent back to be distilled', () => {
  const said = "honestly I'm ok with 1 bath, 2 would be nice though";
  assert.match(notDistilled("I'm ok with 1 bath", said)!, /third person/);
  assert.match(notDistilled('ok with 1 bath, 2 would be nice', said)!, /repeats their message/);
  assert.match(notDistilled('My partner works in Midtown', 'my partner works in midtown')!, /third person/);
  assert.equal(notDistilled('Prefers 2 baths; 1 is acceptable', said), null);
  assert.equal(notDistilled('Partner commutes to Midtown daily', 'my partner works in midtown'), null);
  assert.match(notDistilled('x'.repeat(161), undefined)!, /under 160/);
  assert.match(notDistilled('ok', undefined)!, /short/);
});

test('add, refine, contradict and forget', () => {
  const st = fresh();
  let r = write(st, { add: [{ kind: 'likes', text: 'Prefers 2 baths; 1 is acceptable', strength: 'strong' },
                             { kind: 'dislikes', text: 'Dislikes ground-floor units', strength: 'strong' }] }, "I'm ok with 1 bath");
  assert.equal(r.refused.length, 0);
  assert.equal(st.memory!.length, 2);
  const bath = st.memory!.find((n) => n.kind === 'likes')!;
  assert.equal(bath.from, 'said');

  // the same fact again refreshes the note instead of adding a second
  write(st, { add: [{ kind: 'likes', text: 'Prefers 2 baths, 1 is acceptable', strength: 'mild' }] });
  assert.equal(st.memory!.length, 2);
  assert.equal(st.memory!.find((n) => n.kind === 'likes')!.strength, 'mild');

  // a change is an update to that note
  write(st, { update: [{ id: bath.id, text: 'Needs 2 baths now that a roommate is moving in', kind: 'needs', strength: 'must' }] });
  assert.equal(st.memory!.find((n) => n.id === bath.id)!.kind, 'needs');

  // forgetting, and ids that don't exist
  r = write(st, { remove: [bath.id, 'm_nope'], update: [{ id: 'm_gone', strength: 'mild' }] });
  assert.equal(st.memory!.length, 1);
  assert.deepEqual(r.refused.map((x) => x.id), ['m_nope', 'm_gone']);
});

test('refusals come back with a reason, and the rest still saves', () => {
  const st = fresh();
  const r = write(st, { add: [{ kind: 'life', text: 'we have a dog named Biscuit', strength: 'must' },
                               { kind: 'life', text: 'Has a dog (Biscuit); needs a dog-friendly building', strength: 'must' }] });
  assert.equal(r.refused.length, 1);
  assert.match(r.refused[0].why, /third person/);
  assert.equal(st.memory!.length, 1);
});

test('memory has a cap, so Fred merges instead of piling up', () => {
  const st = fresh();
  write(st, { add: Array.from({ length: MAX_NOTES }, (_, i) => ({ kind: 'likes' as const, text: `Likes feature number ${i} ${'abcdefghij'[i % 10]}${i}`, strength: 'mild' as const })) });
  assert.equal(st.memory!.length, MAX_NOTES);
  const r = write(st, { add: [{ kind: 'timing', text: 'Lease ends December 31', strength: 'must' }] });
  assert.match(r.refused[0].why, /full/);
  // removing one in the same call makes room
  write(st, { remove: [st.memory![0].id], add: [{ kind: 'timing', text: 'Lease ends December 31', strength: 'must' }] });
  assert.ok(st.memory!.some((n) => n.kind === 'timing'));
});

test('recall lists needs and dislikes first, with ids Fred can update', () => {
  const st = fresh();
  write(st, { add: [{ kind: 'likes', text: 'Likes big kitchens', strength: 'mild' },
                    { kind: 'needs', text: 'Needs a dog-friendly building', strength: 'must' },
                    { kind: 'dislikes', text: 'Avoids walk-ups above the 3rd floor', strength: 'strong', from: 'inferred' }] });
  const lines = recall(st.memory)!.split('\n');
  assert.match(lines[0], /^m_\w+ needs \(must\): Needs a dog-friendly building$/);
  assert.match(lines[1], /dislikes \(strong\) \[inferred\]: Avoids walk-ups/);
  assert.match(lines[2], /^m_\w+ likes: Likes big kitchens$/);
  assert.equal(recall([]), null);
});

test('saves and passes become hints', async () => {
  const { env, sql } = d1();
  const facts = (f: object) => JSON.stringify({ laundry: null, outdoor: null, doorman: false, elevator: false, dishwasher: false, walkUp: false, rentStabilized: false, noFee: null, ...f });
  const add = (id: number, price: number, area: string, f: object) =>
    sql.prepare('INSERT INTO listings (id, key, price, beds, neighbourhood, facts) VALUES (?,?,?,?,?,?)').run(id, `k${id}`, price, 1, area, facts(f));
  add(1, 3400, 'Williamsburg', { laundry: 'in_unit' });
  add(2, 3500, 'Williamsburg', { laundry: 'in_unit', elevator: true });
  add(3, 3300, 'Greenpoint', { laundry: 'in_unit' });
  add(4, 4200, 'Bushwick', { walkUp: true });
  add(5, 4300, 'Bushwick', { walkUp: true });
  add(6, 4100, 'Greenpoint', { walkUp: true });
  const st: MockState = { ...fresh(), cards: {
    op_1: { status: 'saved' }, op_2: { status: 'saved', note: 'love the light, kitchen is tiny' }, op_3: { status: 'saved' },
    op_4: { status: 'passed', note: '5th floor walk up, no way' }, op_5: { status: 'passed' }, op_6: { status: 'passed' }, op_7: { status: 'new' },
  } };
  const t = (await taste(env.DB, st))!;
  assert.match(t, /Saved 3, passed 3/);
  assert.match(t, /Saved places run \$3,400 \(median\); passed ones \$4,200/);
  assert.match(t, /Saves keep landing in Williamsburg/);
  assert.match(t, /Passed on everything seen in Bushwick/);
  assert.match(t, /3 of 3 saved places have in-unit laundry \(0 of 3 passed\)/);
  assert.match(t, /3 of 3 passed places have a walk-up \(0 of 3 saved\)/);
  assert.match(t, /Passed op_4 \(Bushwick, \$4,200\), their note: "5th floor walk up, no way"/);
  assert.doesNotMatch(t, /elevator/);   // one saved place isn't a pattern

  assert.equal(await taste(env.DB, fresh()), null);
});
