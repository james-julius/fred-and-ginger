// Fred's on-demand crawls: what each site is asked for, and that a site isn't re-run for the same
// search too soon. Apify is stubbed; the database is SQLite built from the migrations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crawl, critKey, ingestBatch, SOURCES } from '../src/ingest';
import { d1 } from './d1';

const W = { areas: ['williamsburg'], maxRent: 4500, minBeds: 1 };

function apify(rows: any[] = []) {
  const calls: { url: string; body: any }[] = [];
  globalThis.fetch = (async (u: any, init?: any) => {
    const url = String(u);
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    if (url.includes('/runs')) return Response.json({ data: { id: `run${calls.length}` } });
    if (url.includes('/datasets/')) return Response.json(rows);
    return Response.json({});
  }) as any;
  return calls;
}

test('zillow searches the neighbourhood, not the whole borough', () => {
  const i = SOURCES.zillow.input(W);
  assert.equal(i.searches.length, 1);
  assert.match(i.searches[0], /^https:\/\/www\.zillow\.com\/williamsburg-new-york-ny\/rentals\/\?searchQueryState=/);
  const sqs = JSON.parse(decodeURIComponent(i.searches[0].split('searchQueryState=')[1]));
  assert.deepEqual(sqs.filterState.mp, { max: 4500 });
  assert.deepEqual(sqs.filterState.beds, { min: 1 });
  assert.equal(SOURCES.zillow.input({ areas: ['East Williamsburg', 'astoria'] }).searches[0].split('/')[3], 'east-williamsburg-new-york-ny');
  assert.equal(SOURCES.zillow.input({ maxRent: 4000 }).searches.length, 3);   // no area: the three boroughs
});

test('craigslist searches the right borough for posts naming the area', () => {
  assert.deepEqual(SOURCES.craigslist.input(W).subareas, ['brk']);
  assert.equal(SOURCES.craigslist.input(W).query, 'williamsburg');
  const i = SOURCES.craigslist.input({ areas: ['astoria', 'east-village', 'bushwick'] });
  assert.deepEqual(i.subareas, ['que', 'mnh', 'brk']);
  assert.equal(i.query, 'astoria | east village | bushwick');
});

test('a site is not re-run for the same search within the window', async () => {
  const { env, sql } = d1(), calls = apify();
  const a = await crawl(env, 'https://x', W, ['streeteasy', 'zillow']);
  assert.deepEqual(a.map((r) => r.started), [true, true]);
  assert.equal(calls.filter((c) => c.url.includes('/runs')).length, 2);
  assert.match(calls[1].url, /nest-zillow\/runs\?webhooks=/);
  assert.equal(calls[1].body.searches.length, 1);

  const b = await crawl(env, 'https://x', W, ['zillow', 'craigslist']);
  assert.equal(b[0].started, undefined);
  assert.equal(b[0].checkedMinsAgo, 0);
  assert.equal(b[1].started, true);

  // a different search is a different check
  const c = await crawl(env, 'https://x', { ...W, areas: ['greenpoint'] }, ['zillow']);
  assert.equal(c[0].started, true);

  // a failed run doesn't count, and an old one has expired
  sql.prepare(`UPDATE runs SET status='FAILED' WHERE source='streeteasy'`).run();
  sql.prepare(`UPDATE runs SET started=started-5*3600 WHERE source='craigslist'`).run();
  const d = await crawl(env, 'https://x', W, ['streeteasy', 'craigslist', 'nope']);
  assert.deepEqual(d.map((r) => r.started ?? r.error), [true, true, 'unknown site']);
  assert.equal((sql.prepare('SELECT count(*) n FROM runs WHERE criteria=?').get(critKey(W)) as any).n, 5);
});

test("a finished run keeps only rows that fit the search it was for", async () => {
  const { env, sql } = d1();
  const row = (id: string, price: number, beds: number) => ({ source: 'landlords', sourceId: id, street: `${id} Main St`, unit: '1', price, beds });
  apify([row('a', 4000, 1), row('b', 6000, 2), row('c', 3000, 0)]);
  sql.prepare(`INSERT INTO runs (id, source, status, started, finished, dataset, ingested, items, added, criteria) VALUES ('r','landlords','INGESTING',1,1,'ds',0,0,0,?)`).run(critKey(W));
  const r = await ingestBatch(env);
  assert.deepEqual(r, { run: 'r', rows: 3, added: 1, done: true });
  assert.deepEqual(sql.prepare('SELECT street FROM listings').all().map((x: any) => x.street), ['a Main St']);
  assert.equal((sql.prepare(`SELECT status FROM runs WHERE id='r'`).get() as any).status, 'SUCCEEDED');
});
