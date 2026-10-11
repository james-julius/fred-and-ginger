// nest: Compass NYC rental search results -> dataset rows in the nest SCHEMA.
//
// compass.com sits behind an AWS WAF JavaScript challenge (plain HTTP gets a 202 challenge
// page), so we open one real browser page over a residential proxy, let the challenge
// script set its token cookie, and then call Compass's own endpoints from inside that page:
//
//   POST /for-rent/search/<seoId>/<filters>/   -> JSON {lolResults: {data, totalItems}, geospatial, ...}
//        (page 1; <filters> = price.max=4500/beds.min=1). An unknown seoId answers with a
//        tiny JSON without lolResults, which is how StreetEasy slugs get resolved: we try
//        "<slug>-manhattan-ny", "<slug>-brooklyn-ny", ... until one answers.
//   GET  /for-rent/<seoId>/<filters>/start=41/ -> HTML with the same object embedded as
//        `global.uc = {...}` (sharedReactAppProps.initialResults); the JSON endpoint
//        ignores every pagination parameter we tried, so pages 2+ come from the HTML.
//   GET  <listing pageLink>                    -> HTML with window.__INITIAL_DATA__ (agent,
//        dates, no-fee, photos). Fetched for exclusive / coming-soon rows by default.
//
// Compass's own bundle (ucfe-assets), images, fonts, media, stylesheets and third-party hosts are
// blocked. A block (403/429, WAF captcha) retires the session (new IP + fingerprint) and the
// request is retried; rows already pushed are not pushed again.
import { Actor, log } from 'apify';
import { PlaywrightCrawler } from 'crawlee';
import { mapListing, flags } from './map.js';

await Actor.init();
const input = (await Actor.getInput()) ?? {};
const neighbourhoods = (input.neighbourhoods ?? []).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
const borough = input.borough ? String(input.borough).trim() : null;
const maxPrice = input.maxPrice ?? null;
const minBeds = input.minBeds ?? null;
const maxItems = input.maxItems ?? 100;
const maxPages = input.maxPages ?? 3;
const detailMode = input.details ?? 'exclusives';     // 'exclusives' | 'all' | 'none'

const proxyConfiguration = await Actor.createProxyConfiguration({
    groups: ['RESIDENTIAL'],
    countryCode: input.proxyCountry || 'US',
});

const BOROUGHS = { manhattan: 'Manhattan', brooklyn: 'Brooklyn', queens: 'Queens', bronx: 'Bronx', 'the-bronx': 'Bronx', 'staten-island': 'Staten Island' };
const boroughSlug = (b) => {
    const s = String(b || '').toLowerCase().replace(/^the\s+/, '').replace(/\s+/g, '-');
    return BOROUGHS[s] ? s.replace(/^the-/, '') : null;
};
// StreetEasy slug -> Compass slug stem, where they differ
const ALIASES = {
    'bed-stuy': 'bedford-stuyvesant',
    les: 'lower-east-side',
    fidi: 'financial-district',
    uws: 'upper-west-side',
    ues: 'upper-east-side',
    lic: 'long-island-city',
    'hells-kitchen': 'hell-s-kitchen',
    flatiron: 'flatiron-district',
};

const filterPath = [
    maxPrice ? `price.max=${Math.round(maxPrice)}` : null,
    minBeds != null && minBeds > 0 ? `beds.min=${minBeds}` : null,
].filter(Boolean).join('/');

function candidatesFor(slug) {
    if (/-ny$/.test(slug)) return [slug];
    const stem = ALIASES[slug] ?? slug;
    const order = ['manhattan', 'brooklyn', 'queens', 'bronx', 'staten-island'];
    const hint = boroughSlug(borough);
    if (hint) order.sort((a, b) => (a === hint ? -1 : b === hint ? 1 : 0));
    const out = order.map((b) => `${stem}-${b}-ny`);
    if (stem !== slug) out.push(...order.map((b) => `${slug}-${b}-ny`));
    return out;
}

// what to search: one entry per neighbourhood, else the borough, else all of NYC
const searches = neighbourhoods.length
    ? neighbourhoods.map((n) => ({ input: n, candidates: candidatesFor(n) }))
    : [{ input: borough || 'new-york', candidates: [boroughSlug(borough) ? `${boroughSlug(borough)}-ny` : 'new-york-ny'] }];

const seen = new Set();
let pushed = 0;
let bytes = 0;
const stats = { blocked: 0, searchCalls: 0, htmlPages: 0, details: 0, detailFailures: 0, resolved: {}, unresolved: [], totals: {} };

const searchPath = (seoId) => `/for-rent/search/${seoId}/${filterPath ? `${filterPath}/` : ''}`;
const pagePath = (seoId, start) => `/for-rent/${seoId}/${filterPath ? `${filterPath}/` : ''}${start ? `start=${start}/` : ''}`;

// runs in the page
async function postSearch(page, path) {
    return page.evaluate(async (p) => {
        const r = await fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        const t = await r.text();
        let j = null;
        try { j = JSON.parse(t); } catch { /* html or challenge */ }
        return {
            status: r.status,
            size: t.length,
            lol: j?.lolResults ? { data: (j.lolResults.data ?? []).map((d) => d.listing).filter(Boolean), totalItems: j.lolResults.totalItems } : null,
            locations: j?.geospatial?.locations?.map((l) => ({ id: l.id, name: l.name, seoId: l.seoId, type: l.type })) ?? null,
            challenge: !j && /awsWafCookieDomainList|gokuProps|captcha/i.test(t),
        };
    }, path);
}

async function getHtmlPage(page, path) {
    return page.evaluate(async (p) => {
        const r = await fetch(p);
        const t = await r.text();
        const a = t.indexOf('global.uc=');
        let lol = null;
        if (a >= 0) {
            const e = t.indexOf(';})(this);</script>', a);
            try {
                const uc = JSON.parse(t.slice(a + 'global.uc='.length, e));
                const lr = uc?.sharedReactAppProps?.initialResults?.lolResults;
                if (lr) lol = { data: (lr.data ?? []).map((d) => d.listing).filter(Boolean), totalItems: lr.totalItems };
            } catch { /* handled by caller */ }
        }
        return { status: r.status, size: t.length, lol, challenge: !lol && /awsWafCookieDomainList|gokuProps|captcha/i.test(t) };
    }, path);
}

async function getDetail(page, path) {
    return page.evaluate(async (p) => {
        const r = await fetch(p);
        const t = await r.text();
        const m = t.match(/window\.__INITIAL_DATA__\s*=\s*/);
        if (!m) return { status: r.status, size: t.length, listing: null, challenge: /awsWafCookieDomainList|gokuProps|captcha/i.test(t) };
        const a = m.index + m[0].length;
        const e = t.indexOf('</script>', a);
        try {
            const d = JSON.parse(t.slice(a, e).trim().replace(/;$/, ''));
            const L = d?.props?.listingRelation?.listing;
            if (!L) return { status: r.status, size: t.length, listing: null };
            const keep = ['listingIdSHA', 'location', 'size', 'status', 'localizedStatus', 'price', 'date', 'rentalInfo', 'detailedInfo',
                'media', 'fullContacts', 'isOffMLS', 'badges', 'listOfficeGroup', 'buildingInfo', 'mlsStatus'];
            const out = {};
            for (const k of keep) if (L[k] !== undefined) out[k] = L[k];
            if (out.location) delete out.location.transitStations;
            return { status: r.status, size: t.length, listing: out };
        } catch (err) {
            return { status: r.status, size: t.length, listing: null, error: String(err) };
        }
    }, path);
}

class Blocked extends Error {}
const pause = (page) => page.waitForTimeout(800 + Math.random() * 1200);

// gathered cards per search (survives a retry with a fresh session)
const gathered = new Map();   // input -> { seoId, cards: [], total, pagesDone }

const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    useSessionPool: true,
    persistCookiesPerSession: true,
    sessionPoolOptions: { maxPoolSize: 10, sessionOptions: { maxUsageCount: 5 } },
    maxConcurrency: 1,
    maxRequestRetries: 5,
    navigationTimeoutSecs: 75,
    requestHandlerTimeoutSecs: 600,
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
                let host = '', path = '';
                try { ({ hostname: host, pathname: path } = new URL(req.url())); } catch { /* ignore */ }
                if (!/(^|\.)(compass\.com|awswaf\.com)$/i.test(host)) return route.abort();   // the WAF challenge lives on *.awswaf.com
                if (t === 'script' && /^\/ucfe-assets\//.test(path)) return route.abort();     // the search app itself isn't needed
                return route.continue();
            });
        },
    ],
    async requestHandler({ page, response, session }) {
        const status = response?.status() ?? 0;
        // first response is the 202 challenge; its script solves it and reloads the page
        const ok = await page.waitForFunction(() => document.documentElement.innerHTML.includes('global.uc='), null, { timeout: 45000 })
            .then(() => true).catch(() => false);
        if (!ok) {
            const html = await page.content().catch(() => '');
            stats.blocked++;
            session?.retire();
            throw new Blocked(`challenge not passed (status ${status}, ${html.length} bytes${/captcha/i.test(html) ? ', captcha' : ''})`);
        }
        log.info(`WAF challenge passed (${(bytes / 1e6).toFixed(2)} MB so far)`);

        const check = (res, what) => {
            if (res.challenge || res.status === 403 || res.status === 429 || res.status === 405) {
                stats.blocked++;
                session?.retire();
                throw new Blocked(`blocked on ${what} (status ${res.status})`);
            }
        };

        // 1. resolve each search + page 1
        for (const s of searches) {
            if (gathered.has(s.input)) continue;
            let found = null;
            for (const seoId of s.candidates) {
                const res = await postSearch(page, searchPath(seoId));
                stats.searchCalls++;
                check(res, seoId);
                if (res.lol) { found = { seoId, res }; break; }
                await pause(page);
            }
            if (!found) {
                log.warning(`no Compass location for "${s.input}" (tried ${s.candidates.join(', ')})`);
                stats.unresolved.push(s.input);
                gathered.set(s.input, { seoId: null, cards: [], total: 0, pagesDone: 0 });
                continue;
            }
            const loc = found.res.locations?.[0];
            stats.resolved[s.input] = found.seoId;
            stats.totals[s.input] = found.res.lol.totalItems;
            gathered.set(s.input, { seoId: found.seoId, name: loc?.name, cards: found.res.lol.data.map((c) => ({ c, page: 1 })), total: found.res.lol.totalItems, pagesDone: 1, perPage: found.res.lol.data.length || 41 });
            log.info(`${s.input} -> ${found.seoId}: ${found.res.lol.totalItems} rentals, page 1 has ${found.res.lol.data.length}`);
            await pause(page);
        }

        // 2. more pages while a search could still contribute (each search gets an equal share of
        //    maxItems), or while its share isn't yet filled with coming-soon/exclusive listings
        const live = [...gathered.values()].filter((g) => g.seoId);
        const share = Math.ceil(maxItems / Math.max(1, live.length));
        const priority = (g) => g.cards.filter(({ c }) => { const f = flags(c); return f.exclusive || f.comingSoon; }).length;
        for (const g of live) {
            while (g.pagesDone < maxPages && g.cards.length < g.total && (g.cards.length < share || priority(g) < share)) {
                const start = g.pagesDone * g.perPage;
                const res = await getHtmlPage(page, pagePath(g.seoId, start));
                stats.htmlPages++;
                check(res, `${g.seoId} start=${start}`);
                if (!res.lol?.data?.length) { log.warning(`${g.seoId} start=${start}: no results (status ${res.status})`); break; }
                g.pagesDone++;
                g.cards.push(...res.lol.data.map((c) => ({ c, page: g.pagesDone })));
                log.info(`${g.seoId} page ${g.pagesDone}: +${res.lol.data.length} (${g.cards.length}/${g.total})`);
                await pause(page);
            }
        }

        // 3. pick rows: coming soon, then exclusives, then the rest; round-robin across searches
        const rank = (c) => { const f = flags(c); return f.comingSoon ? 0 : f.exclusive ? 1 : 2; };
        const queues = live.map((g) => g.cards
            .filter(({ c }) => c?.listingIdSHA)
            .map((x, i) => ({ ...x, g, i }))
            .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i));
        const picked = [];
        const pickedIds = new Set();
        for (let r = 0; picked.length + pushed < maxItems; r++) {
            let any = false;
            for (const q of queues) {
                const x = q[r];
                if (!x) continue;
                any = true;
                const id = String(x.c.listingIdSHA);
                if (seen.has(id) || pickedIds.has(id)) continue;
                pickedIds.add(id);
                picked.push(x);
                if (picked.length + pushed >= maxItems) break;
            }
            if (!any) break;
        }

        // 4. details + push
        for (const x of picked) {
            const id = String(x.c.listingIdSHA);
            if (seen.has(id)) continue;
            const f = flags(x.c);
            const needs = detailMode === 'all' || (detailMode === 'exclusives' && (f.exclusive || f.comingSoon))
                || x.c.clusterSummary?.bedrooms == null || !x.c.clusterSummary?.priceRange?.length;
            let detail = null;
            if (needs && detailMode !== 'none' && x.c.pageLink) {
                const res = await getDetail(page, x.c.pageLink);
                stats.details++;
                check(res, `detail ${x.c.pageLink}`);
                detail = res.listing;
                if (!detail) { stats.detailFailures++; log.warning(`detail failed for ${x.c.pageLink} (${res.status}${res.error ? `, ${res.error}` : ''})`); }
                await pause(page);
            }
            const row = mapListing(x.c, detail, { search: x.g.seoId, page: x.page, borough: null });
            if (row.price == null || row.beds == null) { log.warning(`skipping ${id}: no price/beds`); seen.add(id); continue; }
            if (maxPrice && row.price > maxPrice) { seen.add(id); continue; }
            if (minBeds != null && row.beds < minBeds) { seen.add(id); continue; }
            seen.add(id);
            await Actor.pushData(row);
            pushed++;
        }
    },
    failedRequestHandler({ request }, err) {
        log.warning(`gave up on ${request.url}: ${err.message}`);
    },
});

// any Compass page works to pass the WAF challenge; this one is also a sanity check that search pages render
await crawler.run([{ url: `https://www.compass.com${pagePath(searches[0].candidates[0].replace(/^.*-(manhattan|brooklyn|queens|bronx|staten-island)-ny$/, '$1-ny'), 0)}` }]);
log.info(`done: ${pushed} rows, ${stats.searchCalls} search calls, ${stats.htmlPages} extra pages, ${stats.details} detail pages, ${stats.blocked} blocks, ~${(bytes / 1e6).toFixed(2)} MB transferred`);
await Actor.setValue('STATS', { pushed, ...stats, bytes });
await Actor.exit();
