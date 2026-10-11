import * as Sentry from '@sentry/cloudflare';
// nest: the shared apartment hunt for James and Erin.
//   /login            sign in (one password each, set as Worker secrets)
//   /api/*            listings, votes, notes, searches, runs
//   /hooks/apify      Apify calls this when a crawler run finishes
//   cron              every 2 min ingest + geocode + building checks. Crawls run when Fred asks (agent/crawl.ts)
import { Env, enrich, finishRun, ingestBatch, startRuns, SOURCES } from './ingest';
import { report } from './building';
import { v2 } from './v2';
import { sendDueAlerts } from './alerts';
import { refreshFacts } from './facts';
import { checkAreas } from './safety';
import { photosOf, savePhotos, servePhoto } from './photos';

const USERS = ['james', 'erin'] as const;
const NAMES: Record<string, string> = { james: 'James', erin: 'Erin' };
const DAY = 86400;

// ── sessions: user.expiry.hmac in an HttpOnly cookie ───────────────────
const enc = new TextEncoder();
async function hmac(key: string, msg: string) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function same(a: string, b: string) {          // constant-time compare
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function sessionUser(req: Request, env: Env): Promise<string | null> {
  const c = /(?:^|;\s*)nest_s=([^;]+)/.exec(req.headers.get('Cookie') || '')?.[1];
  if (!c) return null;
  const [u, exp, sig] = decodeURIComponent(c).split('.');
  if (!u || !exp || !sig || +exp < Date.now() / 1000) return null;
  // local dev only (FRED_DEV in .dev.vars): eval_<id> users, so eval cases run side by side without sharing data
  const known = (USERS as readonly string[]).includes(u) || (env.FRED_DEV === '1' && /^eval_[a-z0-9]{4,16}$/.test(u));
  return same(sig, await hmac(env.SESSION_KEY, `${u}.${exp}`)) && known ? u : null;
}
async function cookieFor(u: string, env: Env) {
  const exp = Math.floor(Date.now() / 1000) + 90 * DAY;
  const v = `${u}.${exp}.${await hmac(env.SESSION_KEY, `${u}.${exp}`)}`;
  return `nest_s=${encodeURIComponent(v)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${90 * DAY}`;
}

const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const LOGIN = (msg = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fred &amp; Ginger</title><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>:root{--bg:#f6f3ee;--ink:#1d1b18;--soft:#6f6a62;--line:#e2ddd4;--accent:#c4552d}
@media (prefers-color-scheme:dark){:root{--bg:#141311;--ink:#f1ede6;--soft:#a39d93;--line:#2c2a26}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px Inter,system-ui,sans-serif;padding:16px}
form{width:100%;max-width:340px;display:flex;flex-direction:column;gap:14px}h1{font:600 44px Fraunces,serif;margin:0 0 4px;letter-spacing:-.02em;line-height:1.05}h1 i{color:var(--accent);font-weight:500}
p{margin:0 0 10px;color:var(--soft)}.who{display:grid;grid-template-columns:1fr 1fr;gap:8px}.who label{border:1px solid var(--line);border-radius:12px;padding:12px;text-align:center;cursor:pointer;font-weight:500}
.who input{display:none}.who input:checked+span{color:var(--accent)}.who label:has(input:checked){border-color:var(--accent)}
input[type=password]{height:48px;border-radius:12px;border:1px solid var(--line);background:transparent;color:inherit;font:inherit;padding:0 14px}
button{height:48px;border:0;border-radius:12px;background:var(--ink);color:var(--bg);font:600 15px Inter,sans-serif;cursor:pointer}.err{color:var(--accent);min-height:1.2em}</style></head>
<body><form method="post" action="/login"><h1>Fred <i>&amp;</i> Ginger</h1><p>Finding our place in New York.</p>
<div class="who"><label><input type="radio" name="user" value="james" required><span>James</span></label><label><input type="radio" name="user" value="erin"><span>Erin</span></label></div>
<input type="password" name="password" placeholder="Password" autocomplete="current-password" required><button>Sign in</button><div class="err">${msg}</div></form></body></html>`;

async function login(req: Request, env: Env) {
  const ip = req.headers.get('CF-Connecting-IP') || '?';
  const t = Math.floor(Date.now() / 1000);
  const fails = await env.DB.prepare('SELECT count(*) AS n FROM login_fail WHERE ip=? AND at>?').bind(ip, t - 3600).first<any>();
  const html = (m: string, s = 200) => new Response(LOGIN(m), { status: s, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  if ((fails?.n || 0) >= 10) return html('Too many tries. Wait an hour.', 429);
  const f = await req.formData();
  const u = String(f.get('user') || ''), p = String(f.get('password') || '');
  const want = u === 'james' ? env.PASSWORD_JAMES : u === 'erin' ? env.PASSWORD_ERIN : undefined;
  if (!want || !p || !same(await hmac(env.SESSION_KEY, p), await hmac(env.SESSION_KEY, want))) {
    await env.DB.prepare('INSERT INTO login_fail VALUES (?,?)').bind(ip, t).run();
    return html(want ? 'Wrong password.' : 'That login isn’t set up yet.', 401);
  }
  return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': await cookieFor(u, env) } });
}

// ── API ────────────────────────────────────────────────────────────────
async function listings(env: Env, me: string, q: URLSearchParams) {
  const other = me === 'james' ? 'erin' : 'james';
  const view = q.get('view') || 'new';
  const countsOnly = view === 'none';
  const where = [`l.status='active'`], args: any[] = [];
  if (q.get('maxPrice')) { where.push('l.price <= ?'); args.push(+q.get('maxPrice')!); }
  if (q.get('minBeds')) { where.push('l.beds >= ?'); args.push(+q.get('minBeds')!); }
  const area = q.get('area') || '';
  if (area && area !== '*') { where.push('l.neighbourhood = ?'); args.push(area); }
  else if (!area) {
    // default: our saved neighbourhoods ("east-village" matches "East Village"; "williamsburg" also "East Williamsburg")
    const c = await env.DB.prepare('SELECT criteria FROM searches WHERE enabled=1 LIMIT 1').first<any>();
    const areas: string[] = c ? JSON.parse(c.criteria).areas || [] : [];
    if (areas.length) {
      where.push('(' + areas.map(() => 'lower(l.neighbourhood) LIKE ?').join(' OR ') + ')');
      args.push(...areas.map((a) => '%' + a.toLowerCase().replace(/-/g, ' ') + '%'));
    }
  }
  if (q.get('minScore')) { where.push('COALESCE(b.score, 100) >= ?'); args.push(+q.get('minScore')!); }
  const scope = [...where];          // filters without the view, for the tab counts
  const mv = 'mv.vote', ov = 'ov.vote';
  if (view === 'new') where.push(`(${mv} IS NULL OR ${mv}=0)`);
  else if (view === 'liked') where.push(`${mv}=1`);
  else if (view === 'both') where.push(`${mv}=1 AND ${ov}=1`);
  else if (view === 'theirs') where.push(`${ov}=1 AND (${mv} IS NULL OR ${mv}=0)`);
  else if (view === 'passed') where.push(`${mv}=-1`);
  const order = ({ price: 'l.price ASC', score: 'COALESCE(b.score, -1) DESC, l.first_seen DESC', ppsf: 'CASE WHEN l.sqft>0 THEN l.price*1.0/l.sqft ELSE 1e9 END ASC' } as any)[q.get('sort') || ''] || 'l.first_seen DESC';
  const rows = countsOnly ? { results: [] as any[] } : await env.DB.prepare(
    `SELECT l.*, b.score AS bscore, b.report AS breport, mv.vote AS my_vote, mv.note AS my_note, ov.vote AS their_vote, ov.note AS their_note
     FROM listings l LEFT JOIN buildings b ON b.bbl=l.bbl
     LEFT JOIN votes mv ON mv.listing_id=l.id AND mv.user='${me}' LEFT JOIN votes ov ON ov.listing_id=l.id AND ov.user='${other}'
     WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 300`).bind(...args).all<any>();
  const ids = rows.results.map((r) => r.id);
  const sights = ids.length ? await env.DB.prepare(`SELECT listing_id, source, url, price, json_extract(raw, '$.flags') AS flags, json_extract(raw, '$.exclusive') AS excl, json_extract(raw, '$.comingSoon') AS soon FROM sightings WHERE listing_id IN (${ids.join(',')})`).all<any>() : { results: [] };
  const by: Record<number, any[]> = {};
  for (const s of sights.results) (by[s.listing_id] ||= []).push({ source: s.source, url: s.url, price: s.price, flags: s.flags ? JSON.parse(s.flags) : [], exclusive: !!s.excl, comingSoon: !!s.soon });
  const counts = await env.DB.prepare(
    `SELECT sum(CASE WHEN mv.vote IS NULL OR mv.vote=0 THEN 1 ELSE 0 END) AS new, sum(mv.vote=1) AS liked, sum(mv.vote=1 AND ov.vote=1) AS both,
            sum(ov.vote=1 AND (mv.vote IS NULL OR mv.vote=0)) AS theirs, sum(mv.vote=-1) AS passed
     FROM listings l LEFT JOIN buildings b ON b.bbl=l.bbl LEFT JOIN votes mv ON mv.listing_id=l.id AND mv.user='${me}' LEFT JOIN votes ov ON ov.listing_id=l.id AND ov.user='${other}'
     WHERE ${scope.join(' AND ')}`).bind(...args).first<any>();
  return {
    me, other, names: NAMES, counts,
    listings: rows.results.map((r) => {
      const rep = r.breport ? JSON.parse(r.breport) : null;
      delete r.breport;
      return { ...r, photos: photosOf(r.photos), price_history: JSON.parse(r.price_history || '[]'), open_house: JSON.parse(r.open_house || 'null'),
               building: rep ? { score: rep.score, flags: rep.flags.slice(0, 4), good: rep.good, owner: rep.facts?.owner, agent: rep.facts?.managing_agent, units: rep.facts?.units } : null,
               sources: by[r.id] || [] };
    }),
  };
}

async function api(req: Request, env: Env, me: string, url: URL) {
  const p = url.pathname, db = env.DB;
  if (p === '/api/me') return json({ user: me, name: NAMES[me] });
  if (p === '/api/listings') return json(await listings(env, me, url.searchParams));
  if (p === '/api/vote' && req.method === 'POST') {
    const b: any = await req.json();
    await db.prepare(`INSERT INTO votes (listing_id, user, vote, note, updated) VALUES (?,?,?,?,?)
                      ON CONFLICT (listing_id, user) DO UPDATE SET vote=COALESCE(excluded.vote, vote), note=COALESCE(excluded.note, note), updated=excluded.updated`)
      .bind(+b.id, me, b.vote ?? null, b.note ?? null, Math.floor(Date.now() / 1000)).run();
    return json({ ok: true });
  }
  if (p === '/api/areas') {
    const r = await db.prepare(`SELECT neighbourhood AS name, count(*) AS n FROM listings WHERE status='active' AND neighbourhood IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`).all();
    return json(r.results);
  }
  if (p === '/api/searches') {
    if (req.method === 'POST') {
      const b: any = await req.json();
      await db.prepare('DELETE FROM searches').run();
      await db.prepare('INSERT INTO searches (name, criteria, enabled, updated) VALUES (?,?,1,?)')
        .bind('ours', JSON.stringify({ maxRent: +b.maxRent || undefined, minBeds: b.minBeds === '' ? undefined : +b.minBeds, areas: (b.areas || []).filter(Boolean) }), Math.floor(Date.now() / 1000)).run();
    }
    const r = await db.prepare('SELECT criteria FROM searches WHERE enabled=1 LIMIT 1').first<any>();
    return json({ criteria: r ? JSON.parse(r.criteria) : null, sources: Object.keys(SOURCES) });
  }
  if (p === '/api/runs') {
    if (req.method === 'POST') return json({ started: await startRuns(env, url.origin, url.searchParams.get('only')?.split(',')) });
    const r = await db.prepare('SELECT * FROM runs ORDER BY started DESC LIMIT 30').all();
    const tot = await db.prepare(`SELECT count(*) AS listings, sum(status='active') AS active FROM listings`).first();
    const blds = await db.prepare(`SELECT count(*) AS n FROM buildings`).first<any>();
    return json({ runs: r.results, totals: { ...tot, buildings: blds?.n } });
  }
  if (p === '/api/tick' && req.method === 'POST') {
    const t0 = Date.now();
    try {
      const b = await ingestBatch(env);
      const e = await enrich(env, b ? 12 : 20, b ? 2 : 3);
      return json({ ingest: b, enrich: e, ms: Date.now() - t0 });
    } catch (err: any) { return json({ error: String(err?.stack || err) }, 500); }
  }
  const bm = /^\/api\/building\/(\d{10})$/.exec(p);
  if (bm) {
    const r = await db.prepare('SELECT report FROM buildings WHERE bbl=?').bind(bm[1]).first<any>();
    return json(r ? JSON.parse(r.report) : await report(bm[1]));
  }
  return json({ error: 'not found' }, 404);
}

const handler = {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/hooks/apify' && req.method === 'POST') {
      if (!env.HOOK_SECRET || !same(url.searchParams.get('key') || '', env.HOOK_SECRET)) return new Response('no', { status: 403 });
      const b: any = await req.json().catch(() => ({}));
      const id = b?.resource?.id;
      // read the rows now, so a crawl Fred started lands in a minute or two; the cron reads the rest
      if (id) ctx.waitUntil(finishRun(env, id).then(async () => { for (let i = 0; i < 2 && (await ingestBatch(env))?.done === false; i++); }));
      return json({ ok: true });
    }
    // listing photos from sites that block other pages from showing them (src/photos.ts); public for alert emails
    if (url.pathname === '/api/photo' && req.method === 'GET') return servePhoto(req, env);
    if (url.pathname === '/login') {
      if (req.method === 'POST') return login(req, env);
      return new Response(LOGIN(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    if (url.pathname === '/logout') return new Response(null, { status: 303, headers: { Location: '/login', 'Set-Cookie': 'nest_s=; Path=/; Max-Age=0' } });
    const me = await sessionUser(req, env);
    if (!me) return url.pathname.startsWith('/api/') && url.pathname !== '/api/docs' ? json({ error: 'signed out' }, 401) : Response.redirect(url.origin + '/login', 303);
    Sentry.setUser({ id: me });
    if (url.pathname.startsWith('/api/')) {
      // the new Fred API first; paths it doesn't know go to the old routes below
      const res = await v2.fetch(req, { ...env, ME: me }, ctx);
      return res.headers.get('X-Fred-Route') === 'none' ? api(req, env, me, url) : res;
    }
    // fredandginger.* serves the new app (web/, the fred-web Worker); nest.* keeps the old grid
    if (env.WEB && url.hostname.startsWith('fredandginger.')) return env.WEB.fetch(req);
    return env.ASSETS.fetch(req);
  },
  async scheduled(ev: ScheduledController, env: Env, ctx: ExecutionContext) {
    // The */5 trigger never fires on its own (Oct 11: no odd-minute runs at all, though Cloudflare
    // lists the schedule), so a */2 run on a multiple of 10 minutes does the 5-minute work too.
    const minute = new Date(ev.scheduledTime).getUTCMinutes();
    const fiveMinute = ev.cron === '*/5 * * * *' || minute % 5 === 0;
    await env.DB.prepare(`INSERT OR REPLACE INTO meta VALUES (?, ?)`).bind(fiveMinute ? 'cron:*/5 * * * *' : 'cron:*/2 * * * *', `${new Date().toISOString()} (label ${ev.cron}, minute ${minute})`).run();
    // Jobs run after the handler returns, so Sentry's wrapper can't see their errors: each job's error
    // is reported here, once, and also marks its monitor run failed. The monitors flag missing or late runs.
    const job = (name: string, run: () => Promise<unknown>) => run().catch((e) => { Sentry.captureException(e, { tags: { job: name } }); throw e; });
    const monitored = (slug: string, cron: string, jobs: () => (Promise<unknown> | null)[]) => ctx.waitUntil(
      Sentry.withMonitor(slug, async () => {
        const failed = (await Promise.allSettled(jobs().filter(Boolean))).filter((r) => r.status === 'rejected');
        if (failed.length) throw new Error(`${failed.length} job(s) failed in ${slug}`);
      }, { schedule: { type: 'crontab', value: cron }, checkinMargin: 3, maxRuntime: 10, timezone: 'UTC' })
        .catch(() => {})   // already reported per job
        .finally(() => Sentry.flush(2000)));
    monitored('nest-every-2-min', '*/2 * * * *', () => [
      // strong-fit email alerts on every run: each place is claimed before sending, so overlap is safe (src/alerts.ts)
      job('alerts', () => sendDueAlerts(env).then((r) => { if (r.some((x) => x.sent || x.error)) console.log('alerts', JSON.stringify(r)); })),
      // ~50 outbound requests per invocation: one dataset page, then geocodes, then building checks.
      // Skipped on 10-minute runs, which spend their request budget on the jobs below.
      fiveMinute ? null : job('ingest', async () => {
        const b = await ingestBatch(env); await enrich(env, b ? 12 : 20, b ? 2 : 3);
        // pets, laundry, outdoor space…: D1 reads only, so a big batch fits
        const due = await env.DB.prepare('SELECT id FROM listings WHERE facts IS NULL LIMIT 200').all<{ id: number }>();
        await refreshFacts(env.DB, due.results.map((r) => r.id));
      }),
    ]);
    // area safety (two NYPD queries per ~100 m cell) and RentHop photos copied to R2 (they 403 on our pages; src/photos.ts)
    if (fiveMinute) monitored('nest-every-10-min', '*/10 * * * *', () => [job('area-safety', () => checkAreas(env.DB, 20)), job('photos', () => savePhotos(env))]);
  },
} satisfies ExportedHandler<Env>;

// Errors, traces and logs go to Sentry (no cookies, headers or bodies). The DSN is in wrangler
// vars (SENTRY_DSN), so local dev reports too, as environment "development". Cron runs are sampled
// lightly: they fire every 2 and 5 minutes and would drown out requests.
export default Sentry.withSentry((env: Env) => ({
  dsn: env.SENTRY_DSN,
  release: env.CF_VERSION_METADATA?.id,
  environment: env.FRED_DEV === '1' ? 'development' : 'production',
  tracesSampler: ({ name }) => (/^\S+ \* \* \* \*$|scheduled|cron/i.test(name ?? '') ? 0.05 : 1.0),
  // the session cookie, chat messages and verification codes travel in cookies, headers and bodies: keep them out
  dataCollection: { cookies: false, httpHeaders: false, httpBodies: [] },
  debug: env.SENTRY_DEBUG === '1',   // logs what the SDK sends; set in .dev.vars to check delivery
}), handler);
