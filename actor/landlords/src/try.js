// Local dev helper (not used on Apify): node src/try.js <slug | config JSON> [n]
// Runs one company's adapter and prints the row count, a sample row and field coverage.
import { makeHttp } from './lib.js';
import { makeBrowser } from './browser.js';
import { COMPANIES } from './companies.js';
const [slug, n = '2'] = process.argv.slice(2);
const cfg = slug.startsWith('{') ? JSON.parse(slug) : COMPANIES.find((c) => c.slug === slug);
if (!cfg) throw new Error(`no company ${slug}`);
const log = { info: console.log, warning: console.warn, debug() {} };
const adapter = (await import(`./adapters/${cfg.platform}.js`)).default;
const http = makeHttp({ delayMs: 2000, log });
const t = Date.now();
const browser = cfg.browser ? await makeBrowser({ log }) : null;
const rows = await adapter(cfg, { http, log, limit: Infinity, browser });
if (browser) { console.log(`browser bytes ~${Math.round(browser.bytes / 1024)} KB`); await browser.close(); }
console.log(`${slug}: ${rows.length} rows, ${http.count} requests, ${Math.round((Date.now() - t) / 1000)}s`);
for (const r of rows.slice(0, Number(n))) console.log(JSON.stringify({ ...r, raw: undefined }));
const keys = ['street', 'unit', 'neighbourhood', 'borough', 'zip', 'lat', 'price', 'netEffective', 'beds', 'baths', 'sqft', 'noFee', 'available', 'photos', 'url'];
console.log('coverage', Object.fromEntries(keys.map((k) => [k, rows.filter((r) => (Array.isArray(r[k]) ? r[k].length : r[k] != null)).length])));
