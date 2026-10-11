// nest: StreetEasy rental search results -> dataset rows, one per listing.
//
// StreetEasy server-renders each results page with the listings embedded in the
// Next.js flight data (self.__next_f), under "listingData": {totalCount, pageInfo,
// edges: [{node: {...}}]}. We load the page in a real browser with a generated
// fingerprint, over a residential proxy, and read that object; no clicking, no
// detail pages. Images/fonts/media are blocked to keep proxy traffic small.
//
// A block (403, or the bot-check page) retires the session (new IP + fingerprint)
// and the request is retried.
import { Actor, log } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

await Actor.init();
const input = (await Actor.getInput()) ?? {};
const searches = (input.searches ?? []).map((s) => (typeof s === 'string' ? s : s.url)).filter(Boolean);
const maxPages = input.maxPages ?? 5;
const noFeePass = input.noFeePass ?? false;
const blockScripts = input.blockScripts ?? true;
if (!searches.length) throw new Error('no searches given');

const proxyConfiguration = await Actor.createProxyConfiguration({
    groups: ['RESIDENTIAL'],
    countryCode: input.proxyCountry || 'US',
});

// /for-rent/williamsburg/price:-4500|beds:1  ->  ...|no_fee:1
function withNoFee(u) {
    const url = new URL(u);
    const parts = url.pathname.split('/').filter(Boolean);           // ['for-rent', 'williamsburg', 'price:-4500|beds:1']
    if (parts.length >= 3 && parts[2].includes(':')) parts[2] = `${decodeURIComponent(parts[2])}|no_fee:1`;
    else parts.splice(2, 0, 'no_fee:1');
    url.pathname = '/' + parts.map((p) => p.split('|').map(encodeURIComponent).join('%7C')).join('/');
    return url.toString();
}

function withPage(u, n) {
    const url = new URL(u);
    if (n > 1) url.searchParams.set('page', String(n)); else url.searchParams.delete('page');
    return url.toString();
}

// the JSON object that starts at `from` (string-aware brace matching)
function objectAt(s, from) {
    let depth = 0, inStr = false, esc = false;
    for (let i = from; i < s.length; i++) {
        const c = s[i];
        if (inStr) {
            if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false;
            continue;
        }
        if (c === '"') inStr = true;
        else if (c === '{') depth++;
        else if (c === '}' && --depth === 0) return JSON.parse(s.slice(from, i + 1));
    }
    return null;
}

const requests = [];
for (const s of searches) {
    requests.push({ url: withPage(s, 1), userData: { search: s, noFee: false, page: 1 } });
    if (noFeePass) requests.push({ url: withNoFee(s), userData: { search: s, noFee: true, page: 1 } });
}

const seen = new Map();            // id -> row; the no-fee pass only flips noFee on rows we have

// one StreetEasy search node -> the shared nest row (actor/SCHEMA.md)
function toRow(n, noFee, search) {
    const unit = (n.unit || n.displayUnit || '').replace(/^#/, '').trim() || null;
    return {
        source: 'streeteasy', sourceId: String(n.id),
        url: n.urlPath ? `https://streeteasy.com${n.urlPath}` : null,
        street: n.street || null, unit, neighbourhood: n.areaName || null, borough: null, zip: n.zipCode || null,
        lat: n.geoPoint?.latitude ?? null, lon: n.geoPoint?.longitude ?? null,
        price: n.price ?? null, netEffective: n.netEffectivePrice || null,
        beds: n.bedroomCount ?? null, baths: (n.fullBathroomCount ?? 0) + 0.5 * (n.halfBathroomCount ?? 0) || null,
        sqft: n.livingAreaSize || null, noFee: noFee ? true : null, available: n.availableAt || null,
        photos: (n.photos ?? []).slice(0, 8).map((p) => p.url), agency: n.sourceGroupLabel || null,
        listedAt: null, scrapedAt: new Date().toISOString(),
        raw: { search, status: n.status, furnished: n.furnished, monthsFree: n.monthsFree, leaseTermMonths: n.leaseTermMonths,
               buildingType: n.buildingType, isNewDevelopment: n.isNewDevelopment, sourceType: n.sourceType,
               upcomingOpenHouse: n.upcomingOpenHouse, hasTour3d: n.hasTour3d, totalMonthlyPrice: n.totalMonthlyPrice },
    };
}
const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    useSessionPool: true,
    persistCookiesPerSession: true,
    sessionPoolOptions: { maxPoolSize: 20, sessionOptions: { maxUsageCount: 8 } },
    maxConcurrency: 2,
    maxRequestRetries: 8,
    navigationTimeoutSecs: 75,
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
    launchContext: { launchOptions: { args: ['--disable-blink-features=AutomationControlled'] } },
    preNavigationHooks: [
        async ({ page }) => {
            await page.route('**/*', (route) => {
                const t = route.request().resourceType();
                // the listings are in the HTML itself: nothing else needs to load (and it's ~10x less proxy traffic)
                if (blockScripts && t !== 'document') return route.abort();
                return ['image', 'media', 'font'].includes(t) ? route.abort() : route.continue();
            });
        },
    ],
    async requestHandler({ request, page, response, session, crawler: c }) {
        const status = response?.status() ?? 0;
        const html = await page.content();
        if (status === 403 || status === 429 || /px-captcha|Access to this page has been denied|press & hold/i.test(html)) {
            session?.retire();
            throw new Error(`blocked (${status}) on ${request.url}`);
        }
        // inline flight chunks: self.__next_f.push([1,"..."]); read from the HTML so no script has to run
        const flight = [...html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)].map((m) => JSON.parse(m[1])).join('');
        const at = flight.indexOf('"listingData":');
        if (at < 0) {
            session?.retire();
            throw new Error(`no listingData on ${request.url} (status ${status}, ${html.length} bytes)`);
        }
        const data = objectAt(flight, at + '"listingData":'.length);
        const { search, noFee, page: n } = request.userData;
        const nodes = (data?.edges ?? []).map(({ node }) => node);
        const criteria = data?.search?.criteria ?? '';
        if (noFee && !/fee/i.test(criteria)) {
            // StreetEasy dropped the filter (it echoes the criteria it applied): this pass proves nothing
            log.warning(`no-fee filter not applied (criteria: ${criteria}); leaving noFee unknown`);
            return;
        }
        for (const node of nodes) {
            const prev = seen.get(node.id);
            if (prev) { if (noFee) prev.noFee = true; continue; }
            seen.set(node.id, toRow(node, noFee, search));
        }
        log.info(`${noFee ? '[no fee] ' : ''}${search} p${n}: ${nodes.length} of ${data.totalCount}`);
        const pi = data.pageInfo ?? {};
        if (pi.hasNextPage && n < maxPages) {
            await c.addRequests([{ url: withPage(request.url, n + 1), userData: { search, noFee, page: n + 1 } }]);
        }
    },
    failedRequestHandler({ request }, err) {
        log.warning(`gave up on ${request.url}: ${err.message}`);
    },
});

await crawler.run(requests);
// listings seen in the main pass but not the no-fee pass: if the no-fee pass ran fully, they have a fee
const rows = [...seen.values()];
await Actor.pushData(rows);
log.info(`done: ${rows.length} listings, ${rows.filter((r) => r.noFee).length} no-fee`);
await Actor.exit();
