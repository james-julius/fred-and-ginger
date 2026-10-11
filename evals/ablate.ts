// Skill ablation: what each part of Fred's harness is worth, in checks passed, tokens, cost and time.
//
//   npm run ablate                         every harness on every case, then each skill taken out
//   npm run ablate -- --runs 2             twice each, to see what's noise
//   npm run ablate -- --skip-per-skill     only the harness comparison
//   npm run ablate -- --concurrency 8
//
// Harnesses: v2 (one long prompt, every tool), skills lazy (short core; Fred loads skills himself),
// skills routed (a keyword router preloads them, free), skills routed+gated (and a turn only sees
// the tools its skills need). Per skill: the routed harness with that skill gone, on the cases that
// lean on it, against the routed harness on the same cases.
// Needs `cd cloud && npx wrangler dev` with FRED_DEV=1, like evals/fred.ts.
import { cases, runSuite, save, summary, type Row } from './fred';
import { SKILLS } from '../cloud/src/agent/skills';

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const runs = Number(flag('runs') ?? 1), concurrency = Number(flag('concurrency') ?? 6);

const HARNESSES = [
  { label: 'v2: one prompt, all tools', harness: 'v2' },
  { label: 'skills: lazy', harness: 'skills', skills: 'lazy' },
  { label: 'skills: routed', harness: 'skills', skills: 'routed' },
  { label: 'skills: routed + gated tools', harness: 'skills', skills: 'routed,gated' },
];

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '-');
const line = (label: string, rows: Row[]) => {
  const s = summary(rows);
  return `| ${label} | ${s.clean}/${s.cases} | ${pct(s.checks, s.total)} | ${s.inputTokens.toLocaleString('en-US')} | ${pct(s.cachedTokens, s.inputTokens)} | ${s.outputTokens} | $${(s.cost / (s.cases || 1)).toFixed(4)} | ${(s.msMedian / 1000).toFixed(1)}s |`;
};
const HEAD = '| Harness | Clean cases | Checks | Input tokens / case | Cached | Output | Cost / case | Median turn |\n|---|---|---|---|---|---|---|---|';

const byHarness: Record<string, Row[]> = {};
for (const h of HARNESSES) {
  console.log(`\n== ${h.label}`);
  byHarness[h.label] = await runSuite({ harness: h.harness, skills: h.skills, runs, concurrency, quiet: true });
  console.log(line(h.label, byHarness[h.label]));
}
console.log(`\n${HEAD}\n${HARNESSES.map((h) => line(h.label, byHarness[h.label])).join('\n')}`);

// how often the router got it right: skills Fred still had to load himself, per case
const routed = byHarness['skills: routed'];
const missed = routed.filter((r) => (r.loaded ?? []).some((s) => !(r.routed ?? []).includes(s)));
console.log(`\nRouter: ${routed.length - missed.length}/${routed.length} routed cases needed no loadSkill step${missed.length ? `; missed: ${missed.map((r) => `${r.case} (+${(r.loaded ?? []).filter((s) => !(r.routed ?? []).includes(s)).join(',')})`).join('; ')}` : ''}`);

const perSkill: { skill: string; with: ReturnType<typeof summary>; without: ReturnType<typeof summary>; cases: string[] }[] = [];
if (!args.includes('--skip-per-skill')) {
  for (const skill of SKILLS) {
    const tagged = cases.filter((c) => c.skills?.includes(skill.id)).map((c) => c.name);
    if (!tagged.length) { console.log(`\n(${skill.id}: no case leans on it yet)`); continue; }
    const without = await runSuite({ harness: 'skills', skills: `routed,-${skill.id}`, only: (c) => tagged.includes(c.name), runs, concurrency, quiet: true });
    perSkill.push({ skill: skill.id, with: summary(routed.filter((r) => tagged.includes(r.case))), without: summary(without), cases: tagged });
  }
  console.log('\n| Skill | Cases | Checks with it | Checks without | Clean with | Clean without |\n|---|---|---|---|---|---|');
  for (const p of perSkill) console.log(`| ${p.skill} | ${p.cases.length} | ${pct(p.with.checks, p.with.total)} | ${pct(p.without.checks, p.without.total)} | ${p.with.clean}/${p.with.cases} | ${p.without.clean}/${p.without.cases} |`);
}

console.log(`\nresults: ${save('ablate', { runs, harnesses: Object.fromEntries(Object.entries(byHarness).map(([k, rows]) => [k, { summary: summary(rows), rows }])), perSkill })}`);
