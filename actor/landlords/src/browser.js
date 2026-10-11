// Browser path for sites that need JS or sit behind a bot check (Cloudflare etc.).
//
// One keep-alive Crawlee PlaywrightCrawler serves page loads to any adapter that asks:
//   const res = await browser.page(url, { waitFor, capture, evaluate });
// Same setup as the StreetEasy actor: residential proxy, generated fingerprints,
// images/fonts/media blocked, concurrency 2, blocked sessions retired and retried.
// Only companies flagged `browser: true` in companies.js get this; it is created
// lazily, so runs without browser companies never launch Chrome.
import { Actor, log as apifyLog } from 'apify';
import { PlaywrightCrawler, RequestQueue } from 'crawlee';

// never needed for unit data, and the big bandwidth eaters on a residential proxy
const JUNK = /\.(m3u8|ts|mp4|webm|mov|m4s|woff2?|ttf|otf)(\?|$)|stream\.mux\.com|youtube\.com|ytimg\.com|vimeo|player\.|googletagmanager|google-analytics|doubleclick|facebook\.(net|com)|hotjar|clarity\.ms|tiktok|snapchat|pinterest|linkedin|twitter|bing\.com|maps\.googleapis\.com\/maps\/vt|maps\.gstatic|api\.mapbox\.com|tiles\.|matterport|userway|accessibe|intercom|livechat|drift|hubspot|calltrk|callrail|newrelic|nr-data|sentry|fullstory|segment\.(io|com)|optimizely|adroll|criteo|quantserve|yelp/i;

const CHALLENGE = /<title>Just a moment\.\.\.|Just a moment\.\.\. |Attention Required! \| Cloudflare|px-captcha|Access to this page has been denied|Pardon Our Interruption/i;

export async function makeBrowser({ log = apifyLog, proxyCountry = 'US', useProxy } = {}) {
    useProxy ??= Actor.isAtHome() || !!process.env.APIFY_PROXY_PASSWORD;
    const proxyConfiguration = useProxy
        ? await Actor.createProxyConfiguration({ groups: ['RESIDENTIAL'], countryCode: proxyCountry })
        : undefined;
    const pending = new Map();
    let seq = 0;
    let bytes = 0;
    const bytesByTag = {};
    const requestQueue = await RequestQueue.open(`browser-${Date.now()}`);

    const crawler = new PlaywrightCrawler({
        requestQueue,
        proxyConfiguration,
        keepAlive: true,
        useSessionPool: true,
        persistCookiesPerSession: true,
        // small pool, long-lived sessions: once a session has cleared a bot check its
        // cookies keep working, and every fresh session costs another challenge
        sessionPoolOptions: { maxPoolSize: 3, sessionOptions: { maxUsageCount: 60, maxErrorScore: 2 } },
        maxConcurrency: 2,
        maxRequestRetries: 4,
        navigationTimeoutSecs: 60,
        requestHandlerTimeoutSecs: 120,
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
        // service workers fetch outside page.route(), so they would bypass the resource blocking
        launchContext: { launchOptions: { args: ['--disable-blink-features=AutomationControlled'], serviceWorkers: 'block' } },
        preNavigationHooks: [
            async ({ page, request }, gotoOptions) => {
                gotoOptions.waitUntil = 'domcontentloaded';
                const job = pending.get(request.userData.id);
                if (job) job.captured = [];
                const block = job?.opts.block;
                await page.route('**/*', (route) => {
                    const req = route.request();
                    const t = req.resourceType();
                    if (['image', 'media', 'font'].includes(t)) return route.abort();
                    if (t === 'stylesheet' && !job?.opts.allowCss) return route.abort();
                    if (JUNK.test(req.url()) && !/challenges\.cloudflare\.com/.test(req.url())) return route.abort();
                    if (block && block.test(req.url())) return route.abort();
                    // allowOnly: whitelist (e.g. the site's own pages + /cdn-cgi/ for the CF check)
                    if (job?.opts.allowOnly && !job.opts.allowOnly.test(req.url()) && !req.isNavigationRequest()) return route.abort();
                    return route.continue();
                });
                // bytes over the wire (headers + encoded body), for proxy budgeting
                page.on('requestfinished', async (req) => {
                    try {
                        const z = await req.sizes();
                        const n = z.requestHeadersSize + z.requestBodySize + z.responseHeadersSize + z.responseBodySize;
                        bytes += n;
                        const tag = job?.opts.tag ?? '_';
                        bytesByTag[tag] = (bytesByTag[tag] ?? 0) + n;
                    } catch { /* ignore */ }
                });
                page.on('response', async (res) => {
                    if (!job?.opts.capture || !job.opts.capture.test(res.url())) return;
                    try {
                        const body = await res.text();
                        job.captured.push({ url: res.url(), status: res.status(), body });
                    } catch { /* body gone (redirect / navigation) */ }
                });
            },
        ],
        async requestHandler({ request, page, response, session }) {
            const job = pending.get(request.userData.id);
            if (!job) return;
            const { opts } = job;
            const status = response?.status() ?? 0;
            const challenged = async () => CHALLENGE.test(`${await page.title().catch(() => '')} ${(await page.content().catch(() => '')).slice(0, 6000)}`);
            // give a JS challenge (Cloudflare "Just a moment") a chance to clear itself
            let blocked = await challenged();
            const wasChallenge = blocked;
            for (let i = 0; blocked && i < 8; i++) {
                await page.waitForTimeout(2500);
                blocked = await challenged();
            }
            if (blocked || (!wasChallenge && [403, 429].includes(status))) {
                session?.retire();
                throw new Error(`blocked (${status}) on ${request.url}`);
            }
            if (typeof opts.waitFor === 'string') await page.waitForSelector(opts.waitFor, { timeout: opts.waitTimeout ?? 25000 }).catch(() => log.debug(`no ${opts.waitFor} on ${request.url}`));
            else if (typeof opts.waitFor === 'function') await opts.waitFor(page).catch((e) => log.debug(`waitFor: ${e.message}`));
            if (opts.settleMs ?? 1500) await page.waitForTimeout(opts.settleMs ?? 1500);
            const value = opts.evaluate ? await opts.evaluate(page) : undefined;
            const html = opts.html === false ? null : await page.content();
            pending.delete(request.userData.id);
            job.resolve({ status, url: page.url(), html, captured: job.captured, value });
        },
        failedRequestHandler({ request }, err) {
            const job = pending.get(request.userData.id);
            pending.delete(request.userData.id);
            job?.reject(new Error(`browser gave up on ${request.url}: ${err.message}`));
        },
    });
    const running = crawler.run().catch((e) => log.warning(`browser crawler stopped: ${e.message}`));

    return {
        get bytes() { return bytes; },
        get bytesByTag() { return bytesByTag; },
        async page(url, opts = {}) {
            const id = `${++seq}`;
            const p = new Promise((resolve, reject) => pending.set(id, { resolve, reject, opts, captured: [] }));
            await crawler.addRequests([{ url, uniqueKey: `${id}:${url}`, userData: { id } }]);
            return p;
        },
        async close() {
            await crawler.teardown();
            await running;
            await requestQueue.drop().catch(() => {});
        },
    };
}
