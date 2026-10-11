// nest: Zumper (also powers PadMapper) NYC rental search -> dataset rows, one per listing.
//
// Zumper's search pages sit behind a Fastly JS challenge, so plain HTTP gets a
// "Client Challenge" page. We open ONE search page in a real browser (fingerprint +
// residential proxy) to pass the challenge, then page through Zumper's own JSON
// endpoint from inside that page with fetch():
//   POST /api/svc/inventory/v1/listables/maplist/search
//   {url: "new-york-ny", neighborhood: "williamsburg", price: {min, max},
//    bedrooms: {min, max}, limit: 50, offset, sorts: "newest", ...}
// The app's JS bundles (cloudfront), maps, ads and trackers are blocked: the
// challenge script and the API live on www.zumper.com, so that is all we load.
//
// For searchUrls we read the query the server rendered into
// window.__PRELOADED_STATE__.currentSearch.listables.query and page that instead.
import { Actor, log } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

await Actor.init();
const input = (await Actor.getInput()) ?? {};
const maxItems = input.maxItems ?? 100;
const debug = !!input.debug;
const PAGE = 50;
const API = '/api/svc/inventory/v1/listables/maplist/search';

const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and').replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Zumper treats the boroughs as their own "cities" (the Bronx is "the-bronx-ny").
const BOROUGH_CITY = {
    manhattan: 'manhattan-ny', brooklyn: 'brooklyn-ny', queens: 'queens-ny',
    bronx: 'the-bronx-ny', 'the bronx': 'the-bronx-ny', 'staten island': 'staten-island-ny',
};

// what the user asked for -> list of {label, query | pageUrl}
function buildSearches() {
    const urls = (input.searchUrls ?? []).filter(Boolean);
    if (urls.length) return urls.map((u) => ({ label: u, pageUrl: u }));
    const filters = {
        price: { min: null, max: input.maxPrice ?? null },
        bedrooms: { min: input.minBeds ?? null, max: null },
    };
    const hoods = (input.neighbourhoods ?? []).filter(Boolean);
    if (hoods.length) {
        return hoods.map((h) => ({ label: h, query: { url: 'new-york-ny', neighborhood: slug(h), ...filters } }));
    }
    const b = (input.borough || '').toLowerCase();
    if (b && !BOROUGH_CITY[b]) throw new Error(`unknown borough "${input.borough}"`);
    return [{ label: input.borough || 'NYC', query: { url: BOROUGH_CITY[b] ?? 'new-york-ny', ...filters } }];
}

// a page URL a person would see for this query (also our landing page)
function pageUrlFor(q) {
    const parts = ['apartments-for-rent', q.url];
    if (q.neighborhood) parts.push(q.neighborhood);
    if (q.bedrooms?.min) parts.push(`${q.bedrooms.min}+beds`);
    if (q.price?.max) parts.push(`under-${q.price.max}`);
    return `https://www.zumper.com/${parts.join('/')}`;
}

function boroughFromZip(zip) {
    const z = parseInt(zip, 10);
    if (!z) return null;
    if (z >= 10001 && z <= 10299) return 'Manhattan';
    if (z >= 10301 && z <= 10314) return 'Staten Island';
    if (z >= 10451 && z <= 10475) return 'Bronx';
    if (z >= 11201 && z <= 11256) return 'Brooklyn';
    if ((z >= 11001 && z <= 11109) || (z >= 11351 && z <= 11697)) return 'Queens';
    return null;
}

const sane = (n) => (Number.isFinite(n) && n > 0 && n < 100000 ? Math.round(n) : null);

function toRow(x, search) {
    const isBuilding = String(x.url ?? '').startsWith('/apartment-buildings') || (x.floorplan_count ?? 1) > 1;
    // "16 Judge St #4W", "475 Grand Street ##3B/1"
    const m = String(x.address ?? '').match(/^(.*?)\s*#+\s*(.+)$/);
    const street = (m ? m[1] : x.address ?? '').trim() || null;
    const unit = isBuilding ? null : (m ? m[2].trim() : null);
    const bath = Array.isArray(x.min_all_bathrooms) && x.min_all_bathrooms.length
        ? x.min_all_bathrooms[0] + 0.5 * (x.min_all_bathrooms[1] ?? 0)
        : x.min_bathrooms ?? null;
    const sqft = x.min_square_feet === x.max_square_feet ? sane(x.min_square_feet) : null;
    const zip = x.zipcode ?? null;
    return {
        source: 'zumper',
        sourceId: isBuilding && x.building_id ? `b${x.building_id}` : String(x.listing_id),
        url: x.url ? `https://www.zumper.com${x.url}` : null,
        street,
        unit,
        neighbourhood: x.neighborhood_name ?? null,
        borough: boroughFromZip(zip) ?? search.borough ?? null,
        zip,
        lat: x.lat ?? null,
        lon: x.lng ?? null,
        price: x.min_price ?? null,
        netEffective: null,
        beds: x.min_bedrooms ?? null,
        baths: bath,
        sqft,
        // leasing_fee: 0 = no broker fee, 1 = broker fee, null = not stated
        noFee: x.leasing_fee === 0 ? true : x.leasing_fee === 1 ? false : null,
        available: x.date_available ?? null,
        photos: (x.image_ids ?? []).slice(0, 8).map((id) => `https://img.zumpercdn.com/${id}/1280x960`),
        agency: x.brokerage_name || x.agent_name || null,
        listedAt: x.listed_on ? new Date(x.listed_on * 1000).toISOString() : null,
        scrapedAt: new Date().toISOString(),
        raw: { ...x, isBuilding, search: search.label },
    };
}

const searches = buildSearches();
const proxyConfiguration = await Actor.createProxyConfiguration({
    groups: ['RESIDENTIAL'],
    countryCode: input.proxyCountry || 'US',
});

const seen = new Set();
let pushed = 0;

const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    useSessionPool: true,
    persistCookiesPerSession: true,
    sessionPoolOptions: { maxPoolSize: 10, sessionOptions: { maxUsageCount: 5 } },
    maxConcurrency: 1,
    maxRequestRetries: 6,
    navigationTimeoutSecs: 75,
    requestHandlerTimeoutSecs: 300,
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
        async ({ page, request }) => {
            const appJs = !!request.userData.appJs;
            await page.route('**/*', (route) => {
                const r = route.request();
                const host = new URL(r.url()).hostname;
                const ok = host === 'www.zumper.com' || host === 'zumper.com' || (appJs && host.endsWith('cloudfront.net'));
                const t = r.resourceType();
                const heavy = ['image', 'media', 'font'].includes(t) || (t === 'stylesheet' && !r.url().includes('/_fs-ch-'));
                return ok && !heavy ? route.continue() : route.abort();
            });
        },
    ],
    async requestHandler({ request, page, response, session }) {
        const status = response?.status() ?? 0;
        // the challenge page reloads itself into the real page once solved
        await page.waitForFunction(() => !!window.__PRELOADED_STATE__, null, { timeout: 45000 }).catch(() => {});
        const title = await page.title();
        const state = await page.evaluate(() => {
            const cs = window.__PRELOADED_STATE__?.currentSearch?.listables;
            return cs ? { query: cs.query, matching: cs.matching } : null;
        });
        if (!state) {
            session?.retire();
            throw new Error(`no search state on ${request.url} (status ${status}, title "${title}")`);
        }
        log.info(`landed on ${page.url()} (${title})`);

        const callApi = (body) => page.evaluate(async ({ api, body }) => {
            const res = await fetch(api, {
                method: 'POST', credentials: 'include',
                headers: { 'content-type': 'application/json', accept: 'application/json' },
                body: JSON.stringify(body),
            });
            const text = await res.text();
            try { return { status: res.status, data: JSON.parse(text) }; } catch { return { status: res.status, text: text.slice(0, 300) }; }
        }, { api: API, body });

        const todo = request.userData.pageUrl ? [{ ...request.userData, query: state.query }] : searches;
        for (const s of todo) {
            if (pushed >= maxItems) break;
            const base = { ...s.query };
            delete base.nearby; delete base.limit; delete base.offset; delete base.countListings;
            const search = { label: s.label, borough: input.borough || null };
            let offset = 0;
            let matching = null;
            while (pushed < maxItems) {
                const body = {
                    ...base,
                    propertyTypes: base.propertyTypes ?? { exclude: [16, 17] },
                    external: true,
                    descriptionLength: 580,
                    limit: PAGE,
                    offset,
                    sorts: 'newest',
                };
                const r = await callApi(body);
                if (debug) await Actor.setValue(`api-${slug(s.label)}-${offset}`, { body, ...r });
                if (r.status !== 200 || !r.data) {
                    if (!request.userData.appJs) request.userData.appJs = true; // retry with the app's JS loaded
                    session?.retire();
                    throw new Error(`API ${r.status} for ${s.label}: ${r.text ?? ''}`);
                }
                matching = r.data.matching;
                const list = r.data.listables ?? [];
                const rows = [];
                for (const x of list) {
                    const row = toRow(x, search);
                    if (seen.has(row.sourceId)) continue;
                    if (input.noFeeOnly && row.noFee !== true) continue; // Zumper has no no-fee API filter
                    seen.add(row.sourceId);
                    rows.push(row);
                    if (pushed + rows.length >= maxItems) break;
                }
                await Actor.pushData(rows);
                pushed += rows.length;
                log.info(`${s.label} offset ${offset}: ${list.length} listables (${rows.length} new) of ${matching}`);
                offset += PAGE;
                if (list.length < PAGE || offset >= (matching ?? 0)) break;
                await page.waitForTimeout(700 + Math.random() * 800);
            }
        }
    },
    failedRequestHandler({ request }, err) {
        log.warning(`gave up on ${request.url}: ${err.message}`);
    },
});

const requests = searches[0].pageUrl
    ? searches.map((s) => ({ url: s.pageUrl, uniqueKey: s.pageUrl, userData: { label: s.label, pageUrl: s.pageUrl } }))
    : [{ url: pageUrlFor(searches[0].query), userData: {} }];
await crawler.run(requests);
log.info(`done: ${pushed} rows`);
await Actor.exit();
