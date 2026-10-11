// nest: Zillow NYC rental search results -> dataset rows in the nest SCHEMA.
//
// Zillow server-renders each search page with the results embedded in
// <script id="__NEXT_DATA__">, under props.pageProps.searchPageState.cat1
// (searchResults.listResults + searchList.totalPages). We load page 1 in a real browser
// with a generated fingerprint over a residential proxy and read that JSON; no clicking.
// Further pages come from the same JSON endpoint the page itself calls
// (PUT /async-create-search-page-state), fetched from inside the page so it carries the
// page's cookies; if that fails we navigate to the /N_p/ page URL instead.
//
// Scripts (by default), images, fonts, media, stylesheets and third-party hosts are blocked to keep proxy
// traffic small. A block (403, or the PerimeterX "press & hold" page) retires the
// session (new IP + fingerprint) and the request is retried.
import { Actor, log } from 'apify';
import { PlaywrightCrawler } from 'crawlee';
import { mapCard } from './map.js';

await Actor.init();
const input = (await Actor.getInput()) ?? {};
const searches = (input.searches ?? []).map((s) => (typeof s === 'string' ? s : s.url)).filter(Boolean);
const maxItems = input.maxItems ?? 200;
const maxPages = input.maxPages ?? 5;
const blockScripts = input.blockScripts ?? true;
if (!searches.length) throw new Error('no searches given');

const proxyConfiguration = await Actor.createProxyConfiguration({
    groups: ['RESIDENTIAL'],
    countryCode: input.proxyCountry || 'US',
});

const ALLOWED_HOST = /(^|\.)(zillow\.com|zillowstatic\.com|px-cdn\.net|px-cloud\.net|perimeterx\.net|pxchk\.net|px-client\.net)$/i;

function readSqs(url) {
    try {
        const s = new URL(url).searchParams.get('searchQueryState');
        return s ? JSON.parse(s) : {};
    } catch {
        return {};
    }
}

// /brooklyn-new-york-ny/rentals/?searchQueryState=...  ->  /brooklyn-new-york-ny/rentals/3_p/?... (currentPage 3)
function withPage(u, n) {
    const url = new URL(u);
    const parts = url.pathname.split('/').filter((p) => p && !/^\d+_p$/.test(p));
    if (n > 1) parts.push(`${n}_p`);
    url.pathname = `/${parts.join('/')}/`;
    const sqs = readSqs(u);
    if (Object.keys(sqs).length || n > 1) {
        sqs.pagination = n > 1 ? { currentPage: n } : {};
        url.searchParams.set('searchQueryState', JSON.stringify(sqs));
    }
    return url.toString();
}

let pushed = 0;
const seen = new Set();
let bytes = 0;
const stats = { pages: 0, apiPages: 0, blocked: 0 };

async function emit(cards, ctx) {
    const rows = [];
    for (const c of cards ?? []) {
        for (const r of mapCard(c, ctx)) {
            if (seen.has(r.sourceId)) continue;
            seen.add(r.sourceId);
            rows.push(r);
        }
    }
    const room = Math.max(0, maxItems - pushed);
    const out = rows.slice(0, room);
    if (out.length) await Actor.pushData(out);
    pushed += out.length;
    return out.length;
}

const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    useSessionPool: true,
    persistCookiesPerSession: true,
    sessionPoolOptions: { maxPoolSize: 20, sessionOptions: { maxUsageCount: 8 } },
    maxConcurrency: 2,
    maxRequestRetries: 8,
    navigationTimeoutSecs: 75,
    requestHandlerTimeoutSecs: 180,
    browserPoolOptions: {
        useFingerprints: true,
        fingerprintOptions: {
            fingerprintGeneratorOptions: {
                browsers: [{ name: 'chrome', minVersion: 120 }],
                devices: ['desktop'],
                operatingSystems: ['macos', 'windows'],
                locales: ['en-US'],
            },
        },
    },
    launchContext: { launchOptions: { args: ['--disable-blink-features=AutomationControlled'] } },
    preNavigationHooks: [
        async ({ page }, gotoOptions) => {
            gotoOptions.waitUntil = 'domcontentloaded';
            try {
                const cdp = await page.context().newCDPSession(page);
                await cdp.send('Network.enable');
                cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength || 0; });
            } catch { /* byte count is best effort */ }
            await page.route('**/*', (route) => {
                const req = route.request();
                const t = req.resourceType();
                if (['image', 'media', 'font', 'stylesheet'].includes(t)) return route.abort();
                if (blockScripts && t === 'script') return route.abort();
                let host = '';
                try { host = new URL(req.url()).hostname; } catch { /* ignore */ }
                if (!ALLOWED_HOST.test(host)) return route.abort();
                return route.continue();
            });
        },
    ],
    async requestHandler({ request, page, response, session }) {
        if (pushed >= maxItems) return;
        const status = response?.status() ?? 0;
        let text = null;
        try {
            await page.waitForSelector('#__NEXT_DATA__', { state: 'attached', timeout: 20000 });
            text = await page.$eval('#__NEXT_DATA__', (e) => e.textContent);
        } catch { /* handled below */ }
        if (!text) {
            const html = await page.content();
            const blocked = status === 403 || status === 429 || /px-captcha|Access to this page has been denied|press & hold/i.test(html);
            if (blocked) stats.blocked++;
            session?.retire();
            throw new Error(`${blocked ? 'blocked' : 'no __NEXT_DATA__'} (status ${status}, ${html.length} bytes) on ${request.url}`);
        }
        const sps = JSON.parse(text)?.props?.pageProps?.searchPageState;
        const cat = sps?.cat1;
        if (!cat?.searchResults) {
            session?.retire();
            throw new Error(`no searchPageState.cat1 on ${request.url} (status ${status})`);
        }
        stats.pages++;
        const { search, page: n } = request.userData;
        const totalCount = cat.searchList?.totalResultCount ?? null;
        const totalPages = Math.min(cat.searchList?.totalPages ?? 1, maxPages);
        const got = await emit(cat.searchResults.listResults, { search, page: n, totalCount });
        log.info(`${search} p${n}: ${got} rows (${cat.searchResults.listResults?.length ?? 0} cards of ${totalCount}, ${totalPages} pages)`);

        // further pages via the page's own JSON endpoint
        const queryState = sps.queryState ?? readSqs(request.url);
        for (let p = n + 1; p <= totalPages && pushed < maxItems; p++) {
            const res = await page.evaluate(async ({ qs, p }) => {
                try {
                    const r = await fetch('/async-create-search-page-state', {
                        method: 'PUT',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({
                            searchQueryState: { ...qs, pagination: { currentPage: p } },
                            wants: { cat1: ['listResults'], cat2: ['total'] },
                            requestId: p + 1,
                            isDebugRequest: false,
                        }),
                    });
                    if (!r.ok) return { error: `HTTP ${r.status}` };
                    const j = await r.json();
                    return { listResults: j?.cat1?.searchResults?.listResults ?? null, total: j?.cat1?.searchList?.totalResultCount };
                } catch (e) {
                    return { error: String(e) };
                }
            }, { qs: queryState, p }).catch((e) => ({ error: String(e) }));
            if (!res?.listResults) {
                log.warning(`API page ${p} failed (${res?.error ?? 'no listResults'}); falling back to page navigation`);
                await crawler.addRequests([{ url: withPage(search, p), uniqueKey: `${search}#${p}`, userData: { search, page: p } }]);
                break;
            }
            stats.apiPages++;
            const g = await emit(res.listResults, { search, page: p, totalCount });
            log.info(`${search} p${p} (api): ${g} rows (${res.listResults.length} cards)`);
            if (!res.listResults.length) break;
            await page.waitForTimeout(1500 + Math.random() * 2000);
        }
    },
    failedRequestHandler({ request }, err) {
        log.warning(`gave up on ${request.url}: ${err.message}`);
    },
});

await crawler.run(searches.map((s) => ({ url: withPage(s, 1), uniqueKey: `${s}#1`, userData: { search: s, page: 1 } })));
log.info(`done: ${pushed} rows, ${stats.pages} pages loaded, ${stats.apiPages} api pages, ${stats.blocked} blocks, ~${(bytes / 1e6).toFixed(2)} MB transferred`);
await Actor.setValue('STATS', { pushed, ...stats, bytes });
await Actor.exit();
