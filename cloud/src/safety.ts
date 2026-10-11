// Area safety from NYPD complaint data (NYC Open Data): crimes reported within 300 m (about a
// 4-minute walk) over the latest 12 months the city has published. The NYPD posts quarterly, in
// two datasets: this year (5uac-w243) and earlier years (qgea-i56i). Counts are cached per
// ~100 m cell, and each place is ranked against every other rental spot we've checked, which is
// the comparison a renter wants (not the whole city, where parks and industrial land skew it).
// It's reported crime, not a guarantee, and Fred says so.
// Rape and sex crimes are left out: the NYPD masks where they happened (they cluster at a single
// point near a station house or transit office), so they'd make a block look worse than it is.

const SODA = 'https://data.cityofnewyork.us/resource/';
const CURRENT = '5uac-w243', HISTORIC = 'qgea-i56i';
export const RADIUS_M = 300;

const MASKED = new Set(['RAPE', 'SEX CRIMES']);
const VIOLENT = new Set(['MURDER & NON-NEGL. MANSLAUGHTER', 'ROBBERY', 'FELONY ASSAULT', 'KIDNAPPING & RELATED OFFENSES']);
const PROPERTY = new Set(['BURGLARY', 'GRAND LARCENY', 'GRAND LARCENY OF MOTOR VEHICLE', 'PETIT LARCENY', 'PETIT LARCENY OF MOTOR VEHICLE', 'THEFT-FRAUD', 'OTHER OFFENSES RELATED TO THEFT']);
// plain names for what people ask about
const PLAIN: Record<string, string> = {
  'FELONY ASSAULT': 'Serious assaults', ROBBERY: 'Robberies', BURGLARY: 'Burglaries', 'GRAND LARCENY': 'Thefts over $1,000',
  'PETIT LARCENY': 'Petty thefts', 'GRAND LARCENY OF MOTOR VEHICLE': 'Car thefts', 'HARRASSMENT 2': 'Harassment',
  'ASSAULT 3 & RELATED OFFENSES': 'Minor assaults', 'CRIMINAL MISCHIEF & RELATED OF': 'Vandalism', 'DANGEROUS DRUGS': 'Drug offenses',
  'DANGEROUS WEAPONS': 'Weapons offenses', 'MURDER & NON-NEGL. MANSLAUGHTER': 'Murders',
};

/** ~100 m grid: nearby listings share a cell */
export const cellOf = (lat: number, lon: number) => `${lat.toFixed(3)},${lon.toFixed(3)}`;

export type AreaReport = { from: string; to: string; top: { offense: string; count: number }[] };

async function soda(id: string, params: Record<string, string>) {
  const r = await fetch(SODA + id + '.json?' + new URLSearchParams(params), { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`NYPD ${id} ${r.status}`);
  return r.json<any[]>();
}

/** the latest 12 months the NYPD has published, e.g. 2025-07-01 → 2026-06-30 */
export async function window(db: D1Database) {
  const hit = await db.prepare(`SELECT v FROM meta WHERE k='safety:window'`).first<{ v: string }>();
  const w = hit && JSON.parse(hit.v);
  if (w && Date.now() - w.at < 86400_000) return w as { from: string; to: string };
  const [r] = await soda(CURRENT, { $select: 'max(cmplnt_fr_dt) AS d' });
  const to = String(r?.d ?? '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  const f = new Date(to + 'T00:00:00Z'); f.setUTCFullYear(f.getUTCFullYear() - 1); f.setUTCDate(f.getUTCDate() + 1);
  const next = { from: f.toISOString().slice(0, 10), to, at: Date.now() };
  await db.prepare(`INSERT OR REPLACE INTO meta (k, v) VALUES ('safety:window', ?)`).bind(JSON.stringify(next)).run();
  return next;
}

/** Count reported crime around one cell and store it. Two requests (this year and last). */
export async function checkCell(db: D1Database, cell: string, w: { from: string; to: string }) {
  const [lat, lon] = cell.split(',').map(Number);
  const where = (a: string, b: string) => `within_circle(lat_lon, ${lat}, ${lon}, ${RADIUS_M}) AND cmplnt_fr_dt between '${a}' and '${b}T23:59:59'`;
  const q = (a: string, b: string) => ({ $select: 'ofns_desc, count(*) AS n', $where: where(a, b), $group: 'ofns_desc', $limit: '200' });
  const yearStart = w.to.slice(0, 4) + '-01-01';
  const parts = await Promise.all([
    soda(CURRENT, q(w.from > yearStart ? w.from : yearStart, w.to)),
    w.from < yearStart ? soda(HISTORIC, q(w.from, `${Number(w.to.slice(0, 4)) - 1}-12-31`)) : Promise.resolve([]),
  ]);
  const by = new Map<string, number>();
  for (const r of parts.flat()) if (r.ofns_desc && !MASKED.has(r.ofns_desc)) by.set(r.ofns_desc, (by.get(r.ofns_desc) ?? 0) + Number(r.n));
  let violent = 0, property = 0, total = 0;
  for (const [o, n] of by) { total += n; if (VIOLENT.has(o)) violent += n; if (PROPERTY.has(o)) property += n; }
  const top = [...by].filter(([o]) => PLAIN[o]).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([o, n]) => ({ offense: PLAIN[o], count: n }));
  await db.prepare(`INSERT OR REPLACE INTO areas (cell, violent, property, total, report, fetched) VALUES (?,?,?,?,?,?)`)
    .bind(cell, violent, property, total, JSON.stringify({ from: w.from, to: w.to, top } satisfies AreaReport), Math.floor(Date.now() / 1000)).run();
}

/** Cron: check cells for active listings that have none yet. */
export async function checkAreas(db: D1Database, max = 10) {
  const due = await db.prepare(`SELECT DISTINCT printf('%.3f,%.3f', lat, lon) AS cell FROM listings
                                WHERE status='active' AND lat IS NOT NULL AND printf('%.3f,%.3f', lat, lon) NOT IN (SELECT cell FROM areas) LIMIT ?`).bind(max).all<{ cell: string }>();
  if (!due.results.length) return 0;
  const w = await window(db);
  for (const { cell } of due.results) { try { await checkCell(db, cell, w); } catch (e) { console.error('safety', cell, e); } }
  return due.results.length;
}

export type Safety = {
  level: 'much_lower' | 'lower' | 'typical' | 'higher' | 'much_higher';
  label: string;
  percentile: number;                 // share of checked rental spots with fewer violent crimes, 0-100
  violent: number; property: number; total: number;
  top: { offense: string; count: number }[];
  radiusMeters: number; from: string; to: string;
};

const LEVELS: [number, Safety['level'], string][] = [
  [20, 'much_lower', 'Much less crime than most places for rent'],
  [40, 'lower', 'Less crime than most places for rent'],
  [60, 'typical', 'About typical for NYC rentals'],
  [80, 'higher', 'More crime than most places for rent'],
  [101, 'much_higher', 'Much more crime than most places for rent'],
];

/** Every checked cell's violent count, sorted, for ranking. Fewer than 50 cells: too few to rank. */
export async function ranking(db: D1Database) {
  const r = await db.prepare('SELECT violent FROM areas ORDER BY violent').all<{ violent: number }>();
  return r.results.length >= 50 ? r.results.map((x) => x.violent) : null;
}

export async function safetyFor(db: D1Database, lat: number | null, lon: number | null, rank?: number[] | null): Promise<Safety | null> {
  if (lat == null || lon == null) return null;
  const a = await db.prepare('SELECT violent, property, total, report FROM areas WHERE cell=?').bind(cellOf(lat, lon)).first<any>();
  const ranks = rank === undefined ? await ranking(db) : rank;
  return a && ranks ? toSafety(a, ranks) : null;
}

export function toSafety(a: { violent: number; property: number; total: number; report: string }, ranks: number[]): Safety {
  // ties count half, so a block with the most common count lands mid-pack
  const below = ranks.filter((v) => v < a.violent).length, same = ranks.filter((v) => v === a.violent).length;
  const percentile = Math.round(((below + same / 2) / ranks.length) * 100);
  const [, level, label] = LEVELS.find(([p]) => percentile < p)!;
  const rep = JSON.parse(a.report) as AreaReport;
  return { level, label, percentile, violent: a.violent, property: a.property, total: a.total, top: rep.top, radiusMeters: RADIUS_M, from: rep.from, to: rep.to };
}
