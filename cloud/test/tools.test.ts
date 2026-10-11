// Fred's paid lookups are cached: the same web question within a week doesn't call Nimble again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { researchWeb } from '../src/agent/tools';
import { d1 } from './d1';

test('the same web question within a week is answered from the cache', async () => {
  const { env, sql } = d1();
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return Response.json({ results: [{ title: 'Openigloo: 118 Java St', url: 'https://x', description: 'Great super' }] }); }) as any;
  const ctx = { requestContext: { get: (k: string) => (k === 'env' ? { ...env, ME: 'james', NIMBLE_API_KEY: 'k' } : undefined) } };
  const run = (query: string) => (researchWeb as any).execute({ query }, ctx);

  const a = await run('118 Java St Brooklyn tenant reviews');
  assert.equal(calls, 1);
  assert.equal(a.results[0].title, 'Openigloo: 118 Java St');
  const b = await run('118 java st, Brooklyn  tenant reviews!');      // same question, other spelling
  assert.equal(calls, 1);
  assert.equal(b.cachedDaysAgo, 0);
  await run('Java St Greenpoint noise');                                // a different question pays
  assert.equal(calls, 2);
  // a week later it's fetched fresh
  sql.prepare(`UPDATE meta SET v=json_set(v, '$.at', json_extract(v, '$.at') - 8*86400) WHERE k LIKE 'web:%'`).run();
  await run('118 Java St Brooklyn tenant reviews');
  assert.equal(calls, 3);
});
