// Fred's skills: the router picks the obvious ones for free, loadSkill gets the rest, and in the
// gated harness no tool is ever out of reach (each belongs to the core or to a skill).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_TOOLS, SKILLS, loadSkill, route, skillIndex, toolsFor } from '../src/agent/skills';
import { tools } from '../src/agent/tools';

const r = (said: string, placeOpen = false, off: string[] = []) => route(said, { placeOpen }, new Set(off));

test('every tool belongs to the core or a skill, and every named tool exists', () => {
  const all = Object.keys(tools), reachable = new Set([...CORE_TOOLS, ...SKILLS.flatMap((s) => s.tools)]);
  assert.deepEqual(all.filter((t) => !reachable.has(t)), []);
  assert.deepEqual([...reachable].filter((t) => t !== 'loadSkill' && !all.includes(t)), []);
});

test('the router picks the obvious skills, and nothing for a plain search', () => {
  assert.deepEqual(r('2 bed in Brooklyn under $4k'), []);
  assert.deepEqual(r('Nothing in Harlem please'), []);   // "please" isn't a lease
  assert.ok(!r('He wants money before I see it').includes('memory'));
  assert.deepEqual(r('Is this one any good?', true), ['places']);
  assert.ok(r('Can you set up a tour this Saturday at 11am?').includes('tours'));
  assert.ok(r('The agent wants a $300 application fee, is that legal?').includes('rights'));
  assert.ok(r('He wants me to Zelle the deposit before I see it').includes('scams'));
  assert.ok(r('Email me when something new comes in').includes('alerts'));
  assert.ok(r('A washer/dryer is a dealbreaker').includes('preferences'));
  assert.ok(r('Like I said last time, no walk-ups').includes('memory'));
  // an ablated skill is never routed
  assert.deepEqual(r('Is this one any good?', true, ['places']), []);
});

test('gated turns see the core tools plus their skills tools', () => {
  const t = toolsFor(['tours']);
  assert.ok(CORE_TOOLS.every((x) => t.includes(x)));
  assert.ok(['requestTour', 'listTours', 'updateTour'].every((x) => t.includes(x)));
  assert.ok(!t.includes('setAlerts'));
});

test('loadSkill returns each skill once, refuses ablated or unknown ones', async () => {
  const loaded = new Set<string>(['places']), off = new Set(['scams']);
  const ctx = { requestContext: { get: (k: string) => (k === 'skills' ? loaded : k === 'skillsOff' ? off : undefined) } } as any;
  const res: any = await loadSkill.execute!({ ids: ['rights', 'places', 'scams', 'nope'] } as any, ctx);
  assert.match(res.skills, /## rights/);
  assert.doesNotMatch(res.skills, /## places/);
  assert.deepEqual(res.alreadyLoaded, ['places']);
  assert.deepEqual(res.unknown, ['scams', 'nope']);
  assert.ok(loaded.has('rights'));
});

test('the skill index is one short line per skill', () => {
  const lines = skillIndex(new Set()).split('\n');
  assert.equal(lines.length, SKILLS.length);
  assert.ok(lines.every((l) => l.length < 140), lines.find((l) => l.length >= 140));
  assert.doesNotMatch(skillIndex(new Set(['scams'])), /scams/);
});
