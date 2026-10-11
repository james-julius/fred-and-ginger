// upsert() against a real SQLite built from the migrations, fed the rows the Zillow actor
// actually pushed: the first scrape of 47 W 84th St #3S said 2.5 baths, Zillow later said 1.
// Run: npm test (from cloud/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { upsert, specs, keyOf } from '../src/ingest';
import { d1 } from './d1';

const here = new URL('.', import.meta.url);
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`fixtures/${name}`, here), 'utf8'));

const listing = (sql: DatabaseSync, id: number) => sql.prepare('SELECT * FROM listings WHERE id=?').get(id) as any;
const count = (sql: DatabaseSync) => (sql.prepare('SELECT count(*) n FROM listings').get() as any).n;

test("a site's correction reaches the listing", async () => {
  const { env, sql } = d1();
  const [first] = fixture('zillow-first.json');
  const [latest] = fixture('zillow-latest.json');
  assert.equal(first.baths, 2.5);       // what Zillow said on Oct 10 (1 full + 3 half)
  assert.equal(latest.baths, 1);

  assert.equal(await upsert(env, { ...first, baths: 1.5 }), 'new');
  assert.equal(listing(sql, 1).baths, 1.5);
  assert.equal(await upsert(env, latest), 'seen');
  assert.equal(listing(sql, 1).baths, 1);
  assert.equal(count(sql), 1);
});

test('implausible baths are never stored', async () => {
  const { env, sql } = d1();
  const [first] = fixture('zillow-first.json');
  await upsert(env, first);              // 1 bed, 2.5 baths
  assert.equal(listing(sql, 1).baths, null);
  assert.equal(listing(sql, 1).beds, 1);
});

test('a site that says nothing about baths keeps what another site said', async () => {
  const { env, sql } = d1();
  const [latest] = fixture('zillow-latest.json');
  await upsert(env, latest);
  await upsert(env, { ...latest, source: 'streeteasy', sourceId: 'se1', baths: null, sqft: 650 });
  const l = listing(sql, 1);
  assert.equal(l.baths, 1);
  assert.equal(l.sqft, 650);
  assert.equal(count(sql), 1);           // same street and unit on two sites: one listing
});

test('apartments in one building without a unit stay separate', async () => {
  const { env, sql } = d1();
  const rows = fixture('zillow-latest.json').filter((r: any) => r.raw.isBuilding);
  assert.equal(rows.length, 2);
  for (const r of rows) assert.equal(await upsert(env, r), 'new');
  assert.equal(count(sql), 2);
  assert.deepEqual(sql.prepare('SELECT beds FROM listings ORDER BY id').all().map((x: any) => x.beds), [1, 2]);
  // a second site's unitless row at the same street is not assumed to be either of them
  await upsert(env, { ...rows[0], source: 'craigslist', sourceId: 'cl1' });
  assert.equal(count(sql), 3);
  // and re-seeing them maps back to the same listings
  for (const r of rows) assert.equal(await upsert(env, r), 'seen');
  assert.equal(count(sql), 3);
});

test('specs', () => {
  assert.deepEqual(specs({ beds: 1, baths: 1.5, sqft: 700 }), { beds: 1, baths: 1.5, sqft: 700 });
  assert.equal(specs({ beds: 1, baths: 2 }).baths, 2);
  assert.equal(specs({ beds: 1, baths: 2.5 }).baths, null);
  assert.equal(specs({ beds: 0, baths: 1 }).baths, 1);      // studio
  assert.equal(specs({ beds: 0, baths: 3 }).baths, null);
  assert.equal(specs({ beds: 3, baths: 3.5 }).baths, 3.5);
  assert.equal(specs({ beds: null, baths: 4 }).baths, 4);   // no beds to judge by
  assert.equal(specs({ beds: 2, baths: 0 }).baths, null);
  assert.equal(specs({ beds: 2, baths: 1.3 }).baths, null);
  assert.equal(specs({ beds: 2, baths: '1.5' }).baths, 1.5);
  assert.equal(specs({ beds: 40 }).beds, null);
  assert.equal(specs({ sqft: 12 }).sqft, null);
});

test('keyOf', () => {
  assert.equal(keyOf({ street: 'North 10th Street', unit: 'Apt 3S', source: 'x', sourceId: 1 }), 'n 10 st#3S');
  assert.equal(keyOf({ street: '47 W 84th St', unit: null, source: 'zillow', sourceId: 'b1-1br' }), 'zillow:b1-1br');
  assert.equal(keyOf({ street: null, unit: '2', source: 'zillow', sourceId: '9' }), 'zillow:9');
});
