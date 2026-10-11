// What the city knows about a building, from NYC Open Data (no key needed).
// Same checks and scoring as nest/building.py; see that file for the dataset list.

const SODA = 'https://data.cityofnewyork.us/resource/';
const UA = 'nest (personal apartment search)';

async function q(dataset: string, p: Record<string, string>): Promise<any[]> {
  const u = new URL(SODA + dataset + '.json');
  for (const [k, v] of Object.entries(p)) u.searchParams.set(k, v);
  if (!u.searchParams.has('$limit')) u.searchParams.set('$limit', '5000');
  const r = await fetch(u, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${dataset}: ${r.status}`);
  return r.json();
}

const ago = (days: number) => new Date(Date.now() - days * 864e5).toISOString().slice(0, 10) + 'T00:00:00';
const PESTS = ['PESTS', 'MICE', 'ROACH', 'RAT', 'BED BUG', 'BEDBUG', 'VERMIN', 'RODENT'];

export async function facts(bbl: string, bin?: string | null) {
  const boro = bbl[0], block = String(+bbl.slice(1, 6)), lot = String(+bbl.slice(6, 10));
  const f: any = { bbl, bin };
  const [open, v3, comp, calls, bugs, evic, reg] = await Promise.all([
    q('wvxf-dwi5', { $where: `bbl='${bbl}' AND violationstatus='Open'`, $select: 'class, novdescription, inspectiondate', $order: 'inspectiondate DESC' }),
    q('wvxf-dwi5', { $where: `bbl='${bbl}' AND inspectiondate > '${ago(3 * 365)}'`, $select: 'class, count(*) AS n', $group: 'class' }),
    q('ygpa-z7cr', { $where: `bbl='${bbl}' AND received_date > '${ago(365)}'`, $select: 'major_category, minor_category, count(*) AS n', $group: 'major_category, minor_category' }),
    q('erm2-nwe9', { $where: `bbl='${bbl}' AND created_date > '${ago(365)}'`, $select: 'complaint_type, count(*) AS n', $group: 'complaint_type', $order: 'n DESC', $limit: '30' }),
    q('wz6d-d3jb', { $where: `bbl='${bbl}'`, $order: 'filing_date DESC', $limit: '1' }),
    q('6z8x-wfk4', { $where: `bbl='${bbl}' AND executed_date > '${ago(3 * 365)}' AND residential_commercial_ind='Residential'`, $select: 'count(*) AS n' }),
    q('tesw-yqqr', { $where: `boroid='${boro}' AND block='${block}' AND lot='${lot}'`, $order: 'lastregistrationdate DESC', $limit: '1' }),
  ]);
  f.open_violations = {} as Record<string, number>;
  for (const x of open) f.open_violations[x.class] = (f.open_violations[x.class] || 0) + 1;
  f.open_violation_examples = open.filter((x) => x.class === 'C').slice(0, 5).map((x) => String(x.novdescription || '').slice(0, 160));
  f.violations_3y = Object.fromEntries(v3.map((x) => [x.class, +x.n]));
  f.hpd_complaints_12m = {} as Record<string, number>;
  for (const x of comp) {
    const k = [x.major_category, x.minor_category].filter(Boolean).join(' / ');
    if (k) f.hpd_complaints_12m[k] = (f.hpd_complaints_12m[k] || 0) + +x.n;
  }
  f.calls_311_12m = Object.fromEntries(calls.map((x) => [x.complaint_type, +x.n]));
  if (bugs[0]) {
    f.units = Math.round(+bugs[0].of_dwelling_units || 0) || null;
    f.bedbugs_last_filing = { date: String(bugs[0].filing_date || '').slice(0, 10),
      infested_units: Math.round(+bugs[0].infested_dwelling_unit_count || 0) };
  }
  f.evictions_3y = evic[0] ? +evic[0].n : 0;
  if (bin) {
    const p = await q('ipu4-2q9a', { $where: `bin__='${bin}'`, $select: 'job_type, issuance_date', $order: 'issuance_date DESC', $limit: '200' });
    const cut = Date.now() - 365 * 864e5;
    f.permits_12m = {} as Record<string, number>;
    for (const x of p) {
      const m = /^(\d\d)\/(\d\d)\/(\d{4})/.exec(x.issuance_date || '');
      if (m && Date.UTC(+m[3], +m[1] - 1, +m[2]) >= cut) f.permits_12m[x.job_type] = (f.permits_12m[x.job_type] || 0) + 1;
    }
  }
  if (reg[0]) {
    const con = await q('feu5-w2e2', { $where: `registrationid='${reg[0].registrationid}'` });
    const who: Record<string, string> = {};
    for (const x of con) if (x.corporationname && !who[x.type]) who[x.type] = x.corporationname;
    f.owner = who.CorporateOwner || who.IndividualOwner || who.HeadOfficer || null;
    f.managing_agent = who.Agent || null;
  }
  return f;
}

export function score(f: any) {
  const size = Math.max(1, (f.units || 8) / 10);
  const flags: [number, string][] = [], good: string[] = [];
  let pts = 100;
  const hit = (n: number, per: number, cap: number, msg: string) => {
    if (n <= 0) return;
    const d = Math.min(cap, (n / size) * per);
    pts -= d; flags.push([d, msg]);
  };
  const ov = f.open_violations || {};
  hit(ov.C || 0, 4, 30, `${ov.C} open class C (immediately hazardous) violations`);
  hit(ov.B || 0, 1, 15, `${ov.B} open class B (hazardous) violations`);
  const hc: Record<string, number> = f.hpd_complaints_12m || {};
  const sum = (pred: (k: string) => boolean) => Object.entries(hc).reduce((a, [k, n]) => a + (pred(k.toUpperCase()) ? n : 0), 0);
  const heat = sum((k) => k.includes('HEAT'));
  const pests = sum((k) => PESTS.some((p) => k.includes(p)));
  const leaks = sum((k) => ['WATER LEAK', 'PLUMBING', 'MOLD'].some((p) => k.includes(p)));
  hit(heat, 3, 20, `${heat} heat / hot water complaints in the last year`);
  hit(pests, 3, 15, `${pests} pest complaints in the last year`);
  hit(leaks, 1.5, 10, `${leaks} leak / plumbing / mould complaints in the last year`);
  const noise = Object.entries(f.calls_311_12m || {}).reduce((a, [k, n]) => a + (k.toUpperCase().includes('NOISE') ? (n as number) : 0), 0);
  hit(noise, 0.7, 10, `${noise} noise complaints to 311 in the last year`);
  const bb = f.bedbugs_last_filing || {};
  if (bb.infested_units) { pts -= 10; flags.push([10, `bedbugs in ${bb.infested_units} unit(s) at the ${bb.date} filing`]); }
  hit(f.evictions_3y || 0, 3, 15, `${f.evictions_3y} evictions in 3 years`);
  const pm = f.permits_12m || {};
  if (pm.NB || pm.DM || pm.A1) { pts -= 5; flags.push([5, 'major construction permitted in the last year']); }
  if (!ov.C && !ov.B) good.push('no open serious violations');
  if (!heat) good.push('no heat complaints in the last year');
  if (!pests && !bb.infested_units) good.push('no pest or bedbug reports');
  flags.sort((a, b) => b[0] - a[0]);
  return { score: Math.max(0, Math.round(pts)), flags: flags.map((x) => x[1]), good };
}

export async function report(bbl: string, bin?: string | null) {
  const f = await facts(bbl, bin);
  return { ...score(f), facts: f, checked: new Date().toISOString().slice(0, 10) };
}

// address -> bbl / bin / lat-lon via NYC Planning's GeoSearch (free, no key)
export async function locate(street: string, zipOrArea?: string | null) {
  const text = `${street}${zipOrArea ? ', ' + zipOrArea : ''}, New York, NY`;
  const u = 'https://geosearch.planninglabs.nyc/v2/search?size=1&text=' + encodeURIComponent(text);
  const r = await fetch(u, { headers: { 'User-Agent': UA } });
  if (!r.ok) return null;
  const f = ((await r.json()) as any).features?.[0];
  const p = f?.properties, pad = p?.addendum?.pad;
  if (!pad?.bbl || (p.confidence ?? 1) < 0.6) return null;
  return { bbl: String(pad.bbl), bin: pad.bin ? String(pad.bin) : null, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
           neighbourhood: p.neighbourhood || null, borough: p.borough || null, zip: p.postalcode || null };
}
