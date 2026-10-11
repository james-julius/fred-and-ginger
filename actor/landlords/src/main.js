// nest: NYC landlord / management-company availability pages -> dataset rows.
//
// Adapters are per *platform* (src/adapters/<platform>.js); companies are config
// entries in src/companies.js: { slug, company, platform, ...platform options }.
// Most adapters are plain HTTP (JSON endpoints or server-rendered HTML parsed with
// cheerio): no browser, no proxy. Requests are serial per company and spaced out,
// and companies run a few at a time. Companies flagged `browser: true` (bot-checked
// or JS-only sites) also get a shared Playwright crawler over the residential proxy
// (src/browser.js); it is only launched when such a company is in the run.
import { Actor, log } from 'apify';
import { makeHttp } from './lib.js';
import { makeBrowser } from './browser.js';
import { COMPANIES } from './companies.js';

const ADAPTERS = {};
for (const p of new Set(COMPANIES.map((c) => c.platform))) {
    ADAPTERS[p] = (await import(`./adapters/${p}.js`)).default;
}

await Actor.init();
const input = (await Actor.getInput()) ?? {};
const only = (input.companies ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean);
const maxItems = input.maxItems ?? 0;                 // 0 = no cap
const maxPerCompany = input.maxPerCompany ?? 0;       // 0 = no cap
const concurrency = Math.max(1, Math.min(input.concurrency ?? 3, 6));
const delayMs = input.delayMs ?? 1500;
const ignoreIntervals = input.ignoreIntervals ?? false;
// Expensive (browser) companies can set minIntervalHours: between refreshes their last
// rows are replayed from this store, so every run still returns them.
const cache = await Actor.openKeyValueStore('nest-landlords-cache');

// datacenter proxy, only used for hosts that refuse direct connections from Apify
const dcProxy = Actor.isAtHome() ? await Actor.createProxyConfiguration({ groups: [input.datacenterProxyGroup || 'BUYPROXIES94952'] }).catch(() => null) : null;
const proxyUrl = dcProxy ? () => dcProxy.newUrl() : null;

const todo = COMPANIES.filter((c) => !c.disabled && (!only.length || only.includes(c.slug)));
log.info(`companies: ${todo.map((c) => c.slug).join(', ')}`);
// Chrome + residential proxy only for companies flagged browser: true
// (launched lazily on the first page request, so cached/replayed runs never start Chrome)
let browserReal = null;
const browserFor = (cfg) => ({
    async page(url, opts = {}) {
        browserReal ??= makeBrowser({ log });
        return (await browserReal).page(url, { ...opts, tag: cfg.slug });
    },
});

let pushed = 0;
const summary = {};
const seen = new Set();

async function runCompany(cfg) {
    const http = makeHttp({ delayMs, log, proxyUrl });
    const started = Date.now();
    try {
        const cacheKey = `rows-${cfg.slug}`;
        if (cfg.minIntervalHours && !ignoreIntervals) {
            const hit = await cache.getValue(cacheKey);
            if (hit && Date.now() - hit.at < cfg.minIntervalHours * 3600e3 && hit.rows?.length) {
                let rows = hit.rows.filter((r) => !seen.has(`${r.source}|${r.sourceId}`));
                if (maxPerCompany) rows = rows.slice(0, maxPerCompany);
                if (maxItems) rows = rows.slice(0, Math.max(0, maxItems - pushed));
                rows.forEach((r) => seen.add(`${r.source}|${r.sourceId}`));
                pushed += rows.length;
                if (rows.length) await Actor.pushData(rows);
                summary[cfg.slug] = { platform: cfg.platform, rows: rows.length, cachedFrom: new Date(hit.at).toISOString() };
                log.info(`${cfg.slug}: ${rows.length} rows replayed from ${new Date(hit.at).toISOString()}`);
                return;
            }
        }
        let rows = await ADAPTERS[cfg.platform](cfg, { http, log, limit: maxPerCompany || Infinity, browser: cfg.browser ? browserFor(cfg) : null });
        rows = rows.filter((r) => r && r.price > 0 && r.beds != null && !seen.has(`${r.source}|${r.sourceId}`));
        if (cfg.minIntervalHours && rows.length) await cache.setValue(cacheKey, { at: Date.now(), rows });
        if (maxPerCompany) rows = rows.slice(0, maxPerCompany);
        if (maxItems) rows = rows.slice(0, Math.max(0, maxItems - pushed));
        rows.forEach((r) => seen.add(`${r.source}|${r.sourceId}`));
        pushed += rows.length;
        if (rows.length) await Actor.pushData(rows);
        summary[cfg.slug] = { platform: cfg.platform, rows: rows.length, requests: http.count, secs: Math.round((Date.now() - started) / 1000) };
        log.info(`${cfg.slug} (${cfg.platform}): ${rows.length} rows, ${http.count} requests`);
    } catch (e) {
        summary[cfg.slug] = { platform: cfg.platform, rows: 0, requests: http.count, error: e.message };
        log.warning(`${cfg.slug} failed: ${e.stack || e.message}`);
    }
}

const queue = [...todo];
await Promise.all(Array.from({ length: concurrency }, async () => {
    while (queue.length) {
        if (maxItems && pushed >= maxItems) return;
        await runCompany(queue.shift());
    }
}));

if (browserReal) {
    const b = await browserReal;
    log.info(`browser: ~${Math.round(b.bytes / 1024)} KB over the wire`);
    summary._browserKB = Object.fromEntries(Object.entries(b.bytesByTag).map(([k, v]) => [k, Math.round(v / 1024)]));
    await b.close();
}
await Actor.setValue('SUMMARY', summary);
log.info(`done: ${pushed} rows`, summary);
await Actor.exit();
