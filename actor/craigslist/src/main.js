// nest: Craigslist New York apartments (apa) -> dataset rows, one per listing (see ../SCHEMA.md).
//
// The search page loads its results from a JSON API:
//   https://sapi.craigslist.org/web/v8/postings/search/full?batch=<areaId>-0-360-0-0&searchPath=<subarea>/apa&...
// Items there are positional arrays; ids/dates are offsets against data.decode.min*, and
// the variable middle part is a list of [code, ...values] tuples (images, beds/sqft, slug).
// If the API fails we fall back to the server-rendered search HTML (static <li> list).
//
// Detail pages are opened only for listings not seen before (cache in a named key-value
// store) to fill baths/address/availability/photos and to run the scam checks on the body.
import { Actor, log } from 'apify';
import { CheerioCrawler } from 'crawlee';

await Actor.init();
const input = (await Actor.getInput()) ?? {};
const AREA_ID = 3;           // newyork
const HOST = 'newyork';
const subareas = (input.subareas?.length ? input.subareas : ['']).map((s) => String(s).trim().toLowerCase());
const maxItems = input.maxItems ?? 100;
const fetchDetails = input.fetchDetails ?? true;
const minPrice = input.minPrice ?? 500;

const proxyConfiguration = await Actor.createProxyConfiguration(
    input.proxyGroups?.length ? { groups: input.proxyGroups, countryCode: 'US' } : {},
);

const BOROUGH = { mnh: 'Manhattan', brk: 'Brooklyn', que: 'Queens', brx: 'Bronx', stn: 'Staten Island' };
// Rent below which a real NYC listing is very unlikely, by borough and beds (studio, 1, 2, 3+).
// Roughly half of the 2026 median asking rent; used for the "price_far_below_norm" flag.
const FLOOR = {
    Manhattan: [1500, 1900, 2400, 3000],
    Brooklyn: [1300, 1600, 2000, 2500],
    Queens: [1200, 1400, 1700, 2100],
    Bronx: [1000, 1200, 1500, 1800],
    'Staten Island': [900, 1100, 1400, 1700],
    null: [1000, 1200, 1500, 1800],
};

// ---------- debug mode: dump raw responses and stop ----------
if (input.debugUrls?.length) {
    const kv = await Actor.openKeyValueStore();
    const crawler = new CheerioCrawler({
        proxyConfiguration,
        maxConcurrency: 2,
        maxRequestRetries: 2,
        additionalMimeTypes: ['application/json', 'text/plain'],
        ignoreHttpErrorStatusCodes: [403, 404, 410, 429],
        async requestHandler({ request, response, body }) {
            const key = `debug-${request.userData.i}`;
            await kv.setValue(key, String(body), { contentType: 'text/plain; charset=utf-8' });
            await kv.setValue(`${key}-meta`, { url: request.url, status: response.statusCode, headers: response.headers, bytes: String(body).length });
            log.info(`${key}: ${response.statusCode} ${String(body).length}B ${request.url}`);
        },
    });
    await crawler.run(input.debugUrls.map((url, i) => ({ url, userData: { i }, uniqueKey: `${i}-${url}` })));
    await Actor.exit();
}

// ---------- helpers ----------
const qs = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
const filters = {
    max_price: input.maxPrice, min_price: minPrice || undefined,
    min_bedrooms: input.minBedrooms, max_bedrooms: input.maxBedrooms, query: input.query,
};
const apiUrl = (sub) => `https://sapi.craigslist.org/web/v8/postings/search/full?${qs({
    batch: `${AREA_ID}-0-360-0-0`, cc: 'US', lang: 'en', searchPath: sub ? `${sub}/apa` : 'apa', ...filters,
})}`;
const htmlUrl = (sub) => `https://${HOST}.craigslist.org/search/${sub ? `${sub}/` : ''}apa?${qs(filters)}`;

const int = (s) => { const n = parseInt(String(s ?? '').replace(/[^0-9]/g, ''), 10); return Number.isFinite(n) ? n : null; };
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const imgUrl = (id) => (id ? `https://images.craigslist.org/${String(id).replace(/^\d+:/, '')}_600x450.jpg` : null);
const idFromUrl = (u) => (String(u).match(/\/(\d{8,})\.html/) || [])[1] ?? null;

function bedsFromText(t) {
    if (!t) return null;
    if (/\bstudio\b/i.test(t)) return 0;
    const m = String(t).match(/(\d+(?:\.\d)?)\s*(?:br|bd|bed|bedroom)s?\b/i);
    return m ? Number(m[1]) : null;
}
function bathsFromText(t) {
    const m = String(t ?? '').match(/(\d+(?:\.\d)?)\s*(?:ba|bath|bathroom)s?\b/i);
    return m ? Number(m[1]) : null;
}

// One API item -> partial row. Layout (observed Oct 2026, apiVersion 8):
// [idOffset, postedOffset, categoryId, price, "locIdx:descIdx[:nbhIdx]~lat~lon", "<hash>",
//  ...[code, ...vals] tuples and the title string in no fixed order]
// codes: 4 = images ("3:<imgid>"), 5 = [beds, sqft], 6 = url slug, 10 = "$3,375", 13 = view id, 2 = ?
function decodeItem(item, decode) {
    const out = { raw: { apiItem: item } };
    out.postingId = String((decode.minPostingId ?? 0) + Number(item[0]));
    out.listedAt = decode.minPostedDate != null ? new Date((decode.minPostedDate + Number(item[1])) * 1000).toISOString() : null;
    out.price = typeof item[3] === 'number' && item[3] > 0 ? Math.round(item[3]) : null;
    out.title = item.slice(6).filter((e) => typeof e === 'string').pop() ?? null;
    const [locKey, lat, lon] = String(item[4] ?? '').split('~');
    out.lat = num(lat); out.lon = num(lon);
    const [locIdx, descIdx, nbhIdx] = (locKey ?? '').split(':').map((x) => parseInt(x, 10));
    const L = decode.locations?.[locIdx];
    if (Array.isArray(L)) out.subarea = L[2] ?? null;
    const N = decode.neighborhoods?.[nbhIdx];
    const D = decode.locationDescriptions?.[descIdx];
    out.neighbourhood = typeof N === 'string' ? N : (typeof D === 'string' ? D.trim() : null);
    if (typeof D === 'string') out.raw.locationText = D;
    for (const el of item.slice(5)) {
        if (!Array.isArray(el)) continue;
        const [code, ...vals] = el;
        if (code === 4) out.photos = vals.filter((v) => typeof v === 'string').slice(0, 8).map(imgUrl);
        else if (code === 5) { out.beds = num(vals[0]); out.sqft = num(vals[1]) || null; }
        else if (code === 6) out.slug = vals[0];
        else if (code === 13) out.viewId = vals[0];
        else if (code === 10 && out.price == null) out.price = int(vals[0]);
    }
    out.url = out.viewId && out.slug
        ? `https://www.craigslist.org/view/d/${out.slug}/${out.viewId}`
        : `https://${HOST}.craigslist.org/${out.subarea || 'mnh'}/apa/d/${out.slug || 'x'}/${out.postingId}.html`;
    out.key = out.viewId || out.postingId;
    return out;
}

// Fallback: server-rendered search page. Links are www.craigslist.org/view/d/<slug>/<viewId>
// (no posting id); beds/baths/lat/lon come from the ld+json list, matched by title.
function parseSearchHtml($, sub) {
    const ldByName = new Map();
    try {
        const j = JSON.parse($('#ld_searchpage_results').text() || 'null');
        for (const e of j?.itemListElement ?? []) { const it = e.item ?? e; if (it?.name) ldByName.set(it.name.trim(), it); }
    } catch { /* ignore */ }
    const rows = [];
    $('li.cl-static-search-result').each((_, li) => {
        const url = $(li).find('a').first().attr('href');
        const viewId = (String(url).match(/\/view\/d\/[^/]+\/([A-Za-z0-9]+)/) || [])[1] ?? null;
        const legacyId = idFromUrl(url);
        if (!viewId && !legacyId) return;
        const title = ($(li).attr('title') || $(li).find('.title').first().text()).trim();
        const L = ldByName.get(title);
        rows.push({
            key: viewId || legacyId, viewId, postingId: legacyId, url, title,
            price: int($(li).find('.price').first().text()),
            neighbourhood: $(li).find('.location').first().text().trim() || null,
            beds: num(L?.numberOfBedrooms), baths: num(L?.numberOfBathroomsTotal),
            lat: num(L?.latitude), lon: num(L?.longitude),
            zip: L?.address?.postalCode || null,
            photos: [], subarea: sub || null, listedAt: null,
            raw: { ld: L ?? null },
        });
    });
    return rows;
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function availableDate(t) {
    const s = String(t ?? '').toLowerCase();
    const now = new Date();
    if (/available now/.test(s)) return now.toISOString().slice(0, 10);
    const m = s.match(/available\s+([a-z]{3})[a-z]*\s+(\d{1,2})/);
    if (!m || MONTHS[m[1]] == null) return null;
    let y = now.getUTCFullYear();
    if (MONTHS[m[1]] < now.getUTCMonth() - 2) y++;   // "available feb 1" seen in October = next year
    return new Date(Date.UTC(y, MONTHS[m[1]], Number(m[2]))).toISOString().slice(0, 10);
}

function parseDetail($, body) {
    const d = {};
    try {
        const j = JSON.parse($('#ld_posting_data').text() || 'null');
        if (j) {
            d.beds = num(j.numberOfBedrooms); d.baths = num(j.numberOfBathroomsTotal);
            d.lat = num(j.latitude); d.lon = num(j.longitude);
            d.streetAddress = j.address?.streetAddress || null; d.zip = j.address?.postalCode || null;
            d.locality = j.address?.addressLocality || null;
            d.petsAllowed = j.petsAllowed ?? null;
        }
    } catch { /* ignore */ }
    const map = $('#map');
    if (d.lat == null) d.lat = num(map.attr('data-latitude'));
    if (d.lon == null) d.lon = num(map.attr('data-longitude'));
    d.mapAccuracy = num(map.attr('data-accuracy'));
    d.mapAddress = $('div.mapaddress').first().text().trim() || null;
    d.price = int($('.postingtitletext .price, span.price').first().text());
    d.postingId = (String(body).match(/post id:\s*(\d{6,})/) || [])[1] ?? null;
    const attrs = [];
    $('.attrgroup .attr').each((_, s) => { const t = $(s).text().replace(/\s+/g, ' ').trim(); if (t) attrs.push(t); });
    d.attrs = [...new Set(attrs)];
    const housing = `${d.attrs.join(' | ')} ${$('.housing').first().text()}`;
    if (d.beds == null) d.beds = bedsFromText(housing);
    d.baths = bathsFromText(housing) ?? d.baths;   // ld+json rounds 1.5 baths to 2; "2BR / 1.5Ba" doesn't
    const ft = housing.match(/(\d{3,5})\s*ft/);
    if (ft) d.sqft = Number(ft[1]);
    d.available = availableDate(housing);
    d.listedAt = $('.postinginfos time.date, time.date').first().attr('datetime') || null;
    const m = String(body).match(/var imgList = (\[.*?\]);/);
    if (m) { try { d.photos = JSON.parse(m[1]).slice(0, 8).map((x) => x.url); } catch { /* ignore */ } }
    $('#postingbody .print-information').remove();
    d.body = $('#postingbody').text().replace(/\n{3,}/g, '\n\n').trim();
    return d;
}

// "45 Chester St. #3" -> {street: "45 Chester St.", unit: "3"}; "581 Ocean Pkwy, Brooklyn, NY, 11218" -> street only.
// Only addresses that start with a house number count; "West 149th st" / "X near Y" are cross streets.
function splitAddress(a) {
    let s = String(a ?? '').split(',')[0].replace(/\s+/g, ' ').trim();
    if (!/^\d+[a-z]?(-\d+)?\s+\S/i.test(s) || /\bnear\b|&|\band\b/i.test(s)) return { street: null, unit: null };
    let unit = null;
    const m = s.match(/\s+(?:#|apt\.?|apartment|unit|suite|ste\.?)\s*([a-z0-9-]+)$/i)
        || s.match(/(?:st|street|ave|avenue|rd|road|pl|place|blvd|pkwy|parkway|dr|drive|ln|lane|ct|court|ter|terrace|way|sq)\.?\s+(\d{1,2}[a-z]?|[a-z]\d{0,2}|ph[a-z0-9]*)$/i);
    if (m) { unit = m[1].toUpperCase(); s = s.slice(0, s.length - m[0].length + (m[0].length - m[0].trimStart().length)).trim(); }
    if (m && !/^\s*(#|apt|apartment|unit|suite|ste)/i.test(m[0])) s = `${s} ${m[0].trim().split(/\s+/)[0]}`.trim();
    if (unit && s.split(' ').length < 3) return splitAddressNoUnit(a);   // "123 Avenue A"
    return { street: s.replace(/[.,]$/, '') || null, unit };
}
function splitAddressNoUnit(a) {
    return { street: String(a).split(',')[0].replace(/\s+/g, ' ').trim().replace(/[.,]$/, ''), unit: null };
}

// Very rough borough boxes, to catch "mnh" posts that are really in Yonkers / NJ.
const BOX = {
    Manhattan: [40.68, 40.88, -74.03, -73.90], Brooklyn: [40.56, 40.74, -74.05, -73.83],
    Queens: [40.53, 40.81, -73.97, -73.69], Bronx: [40.78, 40.92, -73.94, -73.74],
    'Staten Island': [40.49, 40.66, -74.26, -74.04],
};
const inBox = (b, lat, lon) => lat >= b[0] && lat <= b[1] && lon >= b[2] && lon <= b[3];

function scamFlags(row, body) {
    const flags = [];
    const floor = (FLOOR[row.borough] ?? FLOOR.null)[Math.min(3, Math.max(0, Math.floor(row.beds ?? 1)))];
    if (row.price != null && row.price < floor) flags.push('price_far_below_norm');
    const t = `${row.title ?? ''}\n${body ?? ''}`.toLowerCase();
    if (/\bwire\b|western union|moneygram|zelle|cash ?app|venmo|gift ?card|bitcoin|crypto/.test(t)) flags.push('wire_or_p2p_payment');
    if (/(deposit|pay|send).{0,40}(before|prior to|first).{0,30}(view|viewing|showing|see|keys?)|(can'?t|cannot|unable to) (show|meet)|keys? (will be )?(mailed|shipped|sent)|airbnb (will|to) (handle|process)/.test(t)) flags.push('deposit_before_viewing');
    if (/out of (the )?(country|state|town)|overseas|abroad|missionary|deployed|relocated to|working in (africa|europe|uk|canada)/.test(t)) flags.push('owner_away');
    if (/\+(?!1\b)\d{1,3}[\s-]?\d{2,}|whats ?app/.test(t)) flags.push('foreign_or_whatsapp_contact');
    if (/\brooms? (4|for) rent\b|\broom ?share\b|\bshared (apartment|apt)\b|\broommates?\b/.test(t)) flags.push('room_or_share');
    if (/(gmail|yahoo|hotmail|outlook)\s*(dot|\.)\s*com|\[\s*at\s*\]|\(at\)/.test(t)) flags.push('email_in_body');
    return flags;
}

// ---------- cache of detail data (so each listing's page is fetched once) ----------
const cacheStore = await Actor.openKeyValueStore('nest-craigslist-cache');
const CACHE_KEY = 'details-v1';   // bump when parseDetail changes so cached pages are re-parsed
const cache = (await cacheStore.getValue(CACHE_KEY)) ?? {};

// ---------- crawl ----------
const found = new Map();      // key (view id) -> partial row
let via = 'api';

const crawler = new CheerioCrawler({
    proxyConfiguration,
    useSessionPool: true,
    persistCookiesPerSession: true,
    sessionPoolOptions: { maxPoolSize: 10, sessionOptions: { maxUsageCount: 30 } },
    maxConcurrency: 3,
    maxRequestRetries: 6,
    requestHandlerTimeoutSecs: 60,
    additionalMimeTypes: ['application/json', 'text/plain'],
    preNavigationHooks: [async ({ request }) => {
        if (request.userData.label === 'API') {
            request.headers = { ...request.headers, Origin: `https://${HOST}.craigslist.org`, Referer: `https://${HOST}.craigslist.org/`, Accept: 'application/json, */*' };
        }
    }],
    async requestHandler({ request, $, json, body, session }) {
        const { label, sub } = request.userData;
        if (label === 'API') {
            const data = (json ?? JSON.parse(String(body))).data;
            if (!Array.isArray(data?.items)) throw new Error(`no items in API response: ${String(body).slice(0, 200)}`);
            const decode = data.decode || {};
            let n = 0, bad = 0;
            for (const it of data.items) {
                try {
                    const r = decodeItem(it, decode);
                    if (!r.subarea && sub) r.subarea = sub;
                    if (!found.has(r.key)) { found.set(r.key, r); n++; }
                } catch (e) { bad++; log.debug(`decode failed: ${e.message}`); }
            }
            if (data.items.length && bad === data.items.length) throw new Error('could not decode any API item (format changed?)');
            log.info(`API ${sub || 'all'}: ${data.items.length} items (${n} new), total ${data.totalResultCount ?? '?'}`);
        } else if (label === 'HTML') {
            const rows = parseSearchHtml($, sub);
            if (!rows.length && !/no results|nothing found/i.test(String(body))) { session?.retire(); throw new Error(`no results in HTML (${String(body).length}B)`); }
            for (const r of rows) if (!found.has(r.key)) found.set(r.key, r);
            log.info(`HTML ${sub || 'all'}: ${rows.length} items`);
        } else if (label === 'DETAIL') {
            const gone = /This posting has been (deleted|flagged|removed)|This posting has expired/i.test(String(body));
            cache[request.userData.key] = gone ? { gone: true, at: new Date().toISOString() } : { ...parseDetail($, body), at: new Date().toISOString() };
        }
    },
    async failedRequestHandler({ request }, err) {
        log.warning(`gave up on ${request.url}: ${err.message}`);
        if (request.userData.label === 'API') {
            via = 'html';
            await crawler.addRequests([{ url: htmlUrl(request.userData.sub), userData: { label: 'HTML', sub: request.userData.sub } }]);
        }
    },
});

if (input.useHtml) via = 'html';
await crawler.run(subareas.map((sub) => (input.useHtml
    ? { url: htmlUrl(sub), userData: { label: 'HTML', sub } }
    : { url: apiUrl(sub), userData: { label: 'API', sub } })));

// apply filters the API may have ignored, newest first, then cap
let items = [...found.values()]
    .filter((r) => r.price == null || ((!input.maxPrice || r.price <= input.maxPrice) && r.price >= minPrice))
    .filter((r) => input.minBedrooms == null || r.beds == null || r.beds >= input.minBedrooms)
    .filter((r) => input.maxBedrooms == null || r.beds == null || r.beds <= input.maxBedrooms)
    .sort((a, b) => (b.listedAt ?? '').localeCompare(a.listedAt ?? '') || Number(b.postingId ?? 0) - Number(a.postingId ?? 0))
    .slice(0, maxItems);

let detailFetched = 0;
if (fetchDetails) {
    const need = items.filter((r) => !cache[r.key]);
    detailFetched = need.length;
    log.info(`details: ${need.length} new of ${items.length} (rest cached)`);
    if (need.length) await crawler.run(need.map((r) => ({ url: r.url, uniqueKey: `detail-${r.key}`, userData: { label: 'DETAIL', key: r.key } })));
    const keys = Object.keys(cache);   // keep the cache bounded: drop the oldest-fetched
    if (keys.length > 5000) keys.sort((a, b) => String(cache[a].at).localeCompare(String(cache[b].at))).slice(0, keys.length - 5000).forEach((k) => delete cache[k]);
    await cacheStore.setValue(CACHE_KEY, cache);
}

const scrapedAt = new Date().toISOString();
const rows = [];
for (const r of items) {
    const d = cache[r.key] ?? {};
    if (d.gone) continue;
    const lat = r.lat ?? d.lat ?? null, lon = r.lon ?? d.lon ?? null;
    let borough = BOROUGH[r.subarea] ?? null;
    const flags = [];
    if (borough && lat != null && !inBox(BOX[borough], lat, lon)) { flags.push('map_pin_outside_borough'); borough = null; }
    const text = `${r.title ?? ''} ${d.body ?? ''}`;
    const { street, unit } = [d.streetAddress, d.mapAddress].map(splitAddress).find((x) => x.street) ?? { street: null, unit: null };
    const row = {
        source: 'craigslist',
        sourceId: r.postingId ?? d.postingId ?? r.key,
        url: r.url,
        street,
        unit,
        neighbourhood: r.neighbourhood || null,
        borough,
        zip: r.zip || d.zip || null,
        lat, lon,
        price: r.price ?? d.price ?? null,
        netEffective: null,
        beds: r.beds ?? d.beds ?? bedsFromText(r.title),
        baths: d.baths ?? r.baths ?? null,
        sqft: r.sqft || d.sqft || null,
        noFee: /\bno[\s-]?(broker'?s?\s+)?fee\b/i.test(text) ? true : (/\bbroker'?s? fee\b|\bfee applies\b|\b(one|1) month'?s? fee\b/i.test(text) ? false : null),
        available: d.available ?? null,
        photos: (r.photos?.length ? r.photos : d.photos ?? []).slice(0, 8),
        agency: null,
        listedAt: r.listedAt ?? (d.listedAt ? new Date(d.listedAt).toISOString() : null),
        scrapedAt,
        raw: {
            title: r.title ?? null,
            subarea: r.subarea ?? null,
            viewId: r.viewId ?? null,
            mapAddress: d.mapAddress ?? null,
            mapAccuracy: d.mapAccuracy ?? null,
            attrs: d.attrs ?? null,
            petsAllowed: d.petsAllowed ?? null,
            body: d.body ? d.body.slice(0, 4000) : null,
            detailFetched: !!cache[r.key],
            via,
            ...r.raw,
            flags,
        },
    };
    row.raw.flags.push(...scamFlags(row, d.body));
    rows.push(row);
}
await Actor.pushData(rows);
log.info(`done: ${rows.length} rows (${found.size} found, ${detailFetched} detail pages fetched)`);
await Actor.exit();
