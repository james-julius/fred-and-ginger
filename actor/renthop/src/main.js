// nest: RentHop NYC rental search -> dataset rows, one per listing.
//
// RentHop is behind Cloudflare (plain HTTP gets "Just a moment..."), so we load the
// server-rendered search pages in a real browser (fingerprint + residential proxy)
// and parse the listing cards (id, lat/lon, address, hoods, zip, price, No Fee
// badge, beds/baths, manager, "posted X ago").
//
// The cards lack agency, photos, move-in date and RentHop's "Listing Quality"
// breakdown, so (unless fetchDetails is off) each listing's detail page is fetched
// with fetch() from inside the already-cleared search page: same cookies, HTML only,
// no extra navigation. Results are sorted by RentHop's quality score (HopScore), so
// a listing's position in the results is its HopScore rank (raw.hopscoreRank).
//
// Everything except renthop.com and the Cloudflare challenge is blocked, as are
// images, fonts and media.
//
// Photos: photos.renthop.com challenges any page that isn't RentHop, so our app can't
// show them. Unless savePhotos is off, each listing's photos are opened once in a tab of
// the cleared browser and kept in the named store nest-renthop-photos (key photoKey(url)),
// which the nest Worker copies to R2. Photos already in the store are skipped, so the
// shared proxy only carries new ones.
import { Actor, log } from 'apify';
import { PlaywrightCrawler } from 'crawlee';
import * as cheerio from 'cheerio';

await Actor.init();
const input = (await Actor.getInput()) ?? {};
const maxItems = input.maxItems ?? 100;
const fetchDetails = input.fetchDetails ?? true;
const noFeeOnly = !!input.noFeeOnly;
const debug = !!input.debug;
const savePhotos = input.savePhotos ?? true;
const photoStore = savePhotos ? await Actor.openKeyValueStore('nest-renthop-photos') : null;
// must match photoKey() in cloud/src/photos.ts
const photoKey = (u) => `renthop-${new URL(u).pathname.split('/').pop().replace(/\.[a-z]+$/i, '')}`.replace(/[^a-zA-Z0-9!_.'()-]/g, '-').slice(0, 250);
let photosSaved = 0;

/** Open each photo not yet in the store in a tab of this (cleared) browser and keep it. */
async function keepPhotos(page, urls) {
    let tab = null;
    try {
        for (const u of urls) {
            const key = photoKey(u);
            if (await photoStore.recordExists(key)) continue;
            tab ??= await page.context().newPage();
            const res = await tab.goto(u, { timeout: 30000 }).catch(() => null);
            const type = res?.headers()['content-type'] ?? '';
            if (!res || res.status() !== 200 || !type.startsWith('image/')) { log.warning(`photo ${u}: ${res?.status() ?? 'no response'} ${type}`); continue; }
            await photoStore.setValue(key, await res.body(), { contentType: type });
            photosSaved += 1;
        }
    } finally { await tab?.close().catch(() => {}); }
}

const BOROUGHS = ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island'];
const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and').replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function searchUrl(area) {
    const u = new URL(`https://www.renthop.com/apartments-for-rent/${area}`);
    if (input.maxPrice) u.searchParams.set('max_price', String(input.maxPrice));
    if (input.minBeds != null && input.minBeds > 0) {
        const beds = [];
        for (let b = Math.min(input.minBeds, 4); b <= 4; b++) beds.push(b); // 4 = 4+
        u.searchParams.set('bedrooms', beds.join(','));
    }
    u.searchParams.set('sort', 'hopscore');
    return u.toString();
}

function buildSearches() {
    const urls = (input.searchUrls ?? []).filter(Boolean);
    if (urls.length) return urls.map((u) => ({ label: u, url: u, anyPath: true }));
    const hoods = (input.neighbourhoods ?? []).filter(Boolean);
    if (hoods.length) return hoods.map((h) => ({ label: h, url: searchUrl(`${slug(h)}-new-york-ny`) }));
    if (input.borough) return [{ label: input.borough, url: searchUrl(`${slug(input.borough)}-new-york-ny`) }];
    return [{ label: 'NYC', url: searchUrl('new-york-ny') }];
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

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const money = (s) => { const m = String(s ?? '').replace(/,/g, '').match(/\$\s*(\d+)/); return m ? parseInt(m[1], 10) : null; };

// "Last 30 min", "Last hour", "3 hours ago", "1 day ago", "2 weeks ago" -> ISO (approximate)
function agoToIso(txt, now = Date.now()) {
    const t = clean(txt).toLowerCase();
    if (!t) return null;
    const MIN = 60e3, H = 60 * MIN, D = 24 * H;
    let m;
    if ((m = t.match(/last\s+(\d+)\s*min/))) return new Date(now - +m[1] * MIN).toISOString();
    if (/last hour/.test(t)) return new Date(now - H).toISOString();
    if (/just now|today/.test(t)) return new Date(now).toISOString();
    if ((m = t.match(/(\d+)\s*(min|minute|hour|day|week|month)s?\s+ago/))) {
        const unit = { min: MIN, minute: MIN, hour: H, day: D, week: 7 * D, month: 30 * D }[m[2]];
        return new Date(now - +m[1] * unit).toISOString();
    }
    return null;
}

const nyToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function moveInToIso(txt) {
    const t = clean(txt);
    if (!t) return null;
    if (/immediate|now|today/i.test(t)) return nyToday();
    let m;
    const pad = (n) => String(n).padStart(2, '0');
    if ((m = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/))) {
        const y = m[3].length === 2 ? `20${m[3]}` : m[3];
        return `${y}-${pad(m[1])}-${pad(m[2])}`;
    }
    if ((m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/i))) {
        const mo = MONTHS.indexOf(m[1].toLowerCase()) + 1;
        const now = new Date();
        let y = m[3] ? +m[3] : now.getFullYear();
        if (!m[3] && mo < now.getMonth() + 1 - 1) y += 1; // "Jan 5" seen in December
        return `${y}-${pad(mo)}-${pad(m[2])}`;
    }
    return null;
}

function parseCards(html) {
    const $ = cheerio.load(html);
    const cards = [];
    $('div.search-listing[listing_id]').each((_, el) => {
        const c = $(el);
        const id = c.attr('listing_id');
        const title = c.find(`#listing-${id}-title`);
        const href = title.attr('href') ?? '';
        const url = href ? (() => { const u = new URL(href, 'https://www.renthop.com'); u.search = ''; return u.toString(); })() : null;
        const addr = clean(title.text()); // "18 King Street, Apt 15"
        const am = addr.match(/^(.*?),\s*(?:Apt\.?|Unit|#)\s*(.+)$/i);
        const hoods = clean(c.find(`#listing-${id}-neighborhoods`).text()).split(',').map((s) => s.trim()).filter(Boolean);
        const zip = clean(c.find('.search-info-title .font-size-9').first().text()) || null;
        const info = c.find(`#listing-${id}-info`);
        const badges = info.find('.d-block > div').map((_, d) => clean($(d).text())).get().filter(Boolean);
        const text = clean(c.text());
        const byDiv = c.find('div').filter((_, d) => /^By\s/.test(clean($(d).text()))).last();
        const manager = clean(byDiv.find('a').first().text()) || null;
        const posted = clean(byDiv.text()).replace(/^By\s.*?,\s*/, '') || null;
        const bedM = text.match(/(Studio|(\d+)\s*Bed)/i);
        const flexM = text.match(/Flex\s*(\d+)/i);
        const bathM = text.match(/(\d+(?:\.\d+)?)\s*Bath/i);
        const netM = text.match(/\$([\d,]+)\s*net\s*effective/i);
        const sqftM = text.match(/([\d,]{3,5})\s*Sq\.?\s*ft/i);
        cards.push({
            id,
            url,
            street: am ? am[1].trim() : addr || null,
            unit: am ? am[2].trim() : null,
            hoods,
            zip,
            lat: parseFloat(c.attr('latitude')) || null,
            lon: parseFloat(c.attr('longitude')) || null,
            price: money(info.find(`#listing-${id}-price`).text()),
            netEffective: netM ? parseInt(netM[1].replace(/,/g, ''), 10) : null,
            badges,
            noFee: badges.some((b) => /^no fee$/i.test(b)),
            featured: c.find('.featured-tag').length > 0,
            suggested: c.find('.suggested-tag').length > 0 || /from_suggested/.test(href),
            manager,
            managerUrl: byDiv.find('a').first().attr('href') ?? null,
            posted,
            beds: bedM ? (/studio/i.test(bedM[1]) ? 0 : parseInt(bedM[2], 10)) : null,
            flexBeds: flexM ? parseInt(flexM[1], 10) : null,
            baths: bathM ? parseFloat(bathM[1]) : null,
            sqft: sqftM ? parseInt(sqftM[1].replace(/,/g, ''), 10) : null,
            thumb: c.find('img.search-thumb').attr('src') ?? null,
        });
    });
    const next = $('a.next-page').attr('href');
    const total = (clean($('title').text()).match(/([\d,]+)\s+Rentals/) ?? [])[1];
    return { cards, next: next ? new URL(next, 'https://www.renthop.com').toString() : null, total: total ? +total.replace(/,/g, '') : null };
}

function parseDetail(html) {
    const $ = cheerio.load(html);
    const out = {};
    // <h1><a href="/building/...">18 King Street</a> #15</h1>
    const h1 = $('h1').first();
    if (h1.length) {
        const h = clean(h1.text());
        const m = h.match(/^(.*?)\s*#\s*(.+)$/);
        out.street = clean(h1.find('a').first().text()) || (m ? m[1] : h) || null;
        out.unit = m ? m[2].trim() : null;
    }
    const by = $('div').filter((_, d) => /^Listing by\s/.test(clean($(d).text()))).last();
    if (by.length) {
        const t = clean(by.text()).replace(/^Listing by\s*/, '');
        const name = clean(by.find('a').first().text());
        const rest = clean(t.slice(name.length).replace(/^,\s*/, ''));
        out.manager = name || null;
        out.company = rest || null;
    }
    const posted = $('div').filter((_, d) => /^Posted\s/.test(clean($(d).text()))).last();
    if (posted.length) {
        const t = clean(posted.text()); // "Posted 1 day ago, Immediate Move-In"
        out.postedText = t;
        const m = t.match(/^Posted\s+(.*?)(?:,\s*(.*))?$/);
        if (m) { out.posted = m[1]; out.moveIn = m[2] ?? null; }
    }
    const photos = [];
    for (const m of html.matchAll(/https:\/\/photos\.renthop\.com\/p\/s\/1024x1024\/[^"'\s)]+/g)) if (!photos.includes(m[0])) photos.push(m[0]);
    out.photos = photos;
    // LISTING QUALITY table: ▲ (positive) / ▼ (negative) rows
    const qHead = $('div').filter((_, d) => clean($(d).text()) === 'LISTING QUALITY').last();
    const qTable = qHead.nextAll('table').first();
    const positive = [], negative = [];
    qTable.find('tr').each((_, tr) => {
        const tds = $(tr).find('td');
        const mark = clean($(tds[0]).text());
        const txt = clean($(tds[1]).text());
        if (!txt) return;
        if (mark.includes('▲')) positive.push(txt); else if (mark.includes('▼')) negative.push(txt);
    });
    out.quality = { positive, negative };
    const aHead = $('div').filter((_, d) => clean($(d).text()) === 'AMENITIES').last();
    out.amenities = aHead.nextAll('div').find('.col-6').map((_, d) => clean($(d).text())).get().filter(Boolean);
    const body = clean($('body').text());
    const cmp = body.match(/This apartment's rent is [^.]*?(?:\.\d+)?%[^.]*?\$[\d,]+[^.]*\./);
    out.priceComparison = cmp ? cmp[0] : null;
    // square footage only from this listing's own header block (h1 .. DESCRIPTION) and amenities,
    // not the whole page (similar listings / building stats also mention sq ft)
    const top = body.slice(Math.max(0, body.indexOf(clean(h1.text()))), body.indexOf('DESCRIPTION') > 0 ? body.indexOf('DESCRIPTION') : undefined);
    const sq = `${top} ${out.amenities.join(' ')}`.match(/([\d,]{3,5})\s*(?:sq\.?\s*ft|sqft|square feet|ft²)/i);
    const sqN = sq ? parseInt(sq[1].replace(/,/g, ''), 10) : null;
    out.sqft = sqN && sqN >= 100 && sqN <= 10000 ? sqN : null;
    try {
        const ld = JSON.parse($('script[type="application/ld+json"]').first().html() ?? '[]');
        const ent = (Array.isArray(ld) ? ld : [ld]).find((x) => x['@type'] === 'ItemPage')?.mainEntity;
        if (ent) {
            out.description = ent.description ?? null;
            out.ldAddress = ent.address ?? null;
            if (ent.address?.streetAddress) out.street = clean(ent.address.streetAddress);
        }
    } catch { /* ignore */ }
    return out;
}

function toRow(c, d, rank, search) {
    const hoods = c.hoods;
    const last = hoods[hoods.length - 1];
    const borough = BOROUGHS.includes(last) ? last : boroughFromZip(c.zip);
    const sqft = d?.sqft || c.sqft || null;
    return {
        source: 'renthop',
        sourceId: String(c.id),
        url: c.url,
        street: d?.street || c.street,
        unit: d?.street ? d.unit : c.unit,
        neighbourhood: hoods[0] ?? null,
        borough,
        zip: c.zip,
        lat: c.lat,
        lon: c.lon,
        price: c.price,
        netEffective: c.netEffective,
        beds: c.beds,
        baths: c.baths,
        sqft,
        noFee: c.noFee, // RentHop badges every no-fee listing; no badge = fee (or not marked)
        available: d ? moveInToIso(d.moveIn) : null,
        photos: d?.photos?.length ? d.photos.slice(0, 8) : (c.thumb ? [c.thumb] : []),
        agency: d?.company || d?.manager || c.manager || null,
        listedAt: agoToIso(d?.posted ?? c.posted),
        scrapedAt: new Date().toISOString(),
        raw: {
            hopscoreRank: rank,
            quality: d?.quality ?? null,
            qualityNet: d?.quality ? d.quality.positive.length - d.quality.negative.length : null,
            badges: c.badges,
            exclusive: c.badges.some((b) => /exclusive/i.test(b)),
            featured: c.featured,
            suggested: c.suggested,
            flexBeds: c.flexBeds,
            hoods,
            manager: d?.manager ?? c.manager,
            managerUrl: c.managerUrl,
            postedText: c.posted,
            moveInText: d?.moveIn ?? null,
            amenities: d?.amenities ?? null,
            priceComparison: d?.priceComparison ?? null,
            description: d?.description ?? null,
            search: search.label,
        },
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
    sessionPoolOptions: { maxPoolSize: 10, sessionOptions: { maxUsageCount: 10 } },
    maxConcurrency: 1,
    maxRequestRetries: 6,
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
        async ({ page }) => {
            await page.route('**/*', (route) => {
                const r = route.request();
                const host = new URL(r.url()).hostname;
                const ok = /(^|\.)renthop\.com$/.test(host) || host === 'challenges.cloudflare.com';
                const heavy = ['image', 'media', 'font'].includes(r.resourceType());
                return ok && !heavy ? route.continue() : route.abort();
            });
        },
    ],
    async requestHandler({ request, page, response, session, crawler: c }) {
        if (pushed >= maxItems) return;
        const status = response?.status() ?? 0;
        // Cloudflare's interstitial replaces itself with the real page once solved
        await page.waitForSelector('#search-results-list, div.search-listing', { timeout: 45000 }).catch(() => {});
        const html = await page.content();
        if (status === 403 || status === 429 || /<title>Just a moment|cf-chl|challenge-platform\/h\/[a-z]\/orchestrate/i.test(html.slice(0, 5000))) {
            session?.retire();
            throw new Error(`blocked (${status}) on ${request.url}`);
        }
        if (debug) await Actor.setValue(`html-${request.userData.page}-${slug(request.userData.label)}`.slice(0, 250), html, { contentType: 'text/html' });
        const { label, page: n, rankBase } = request.userData;
        const wanted = new URL(request.userData.searchUrl).pathname;
        if (!request.userData.anyPath && new URL(page.url()).pathname !== wanted) {
            log.warning(`${label}: RentHop redirected ${wanted} -> ${new URL(page.url()).pathname}; check the neighbourhood name. Skipping.`);
            return;
        }
        const { cards, next, total } = parseCards(html);
        if (!cards.length && !/search-results-list/.test(html)) {
            session?.retire();
            throw new Error(`no results list on ${request.url} (status ${status})`);
        }
        log.info(`${label} p${n}: ${cards.length} cards (${total ?? '?'} total)`);

        let rank = rankBase;
        for (const card of cards) {
            rank += 1;
            if (pushed >= maxItems) break;
            if (seen.has(card.id)) continue;
            seen.add(card.id);
            if (noFeeOnly && !card.noFee) continue;
            let detail = null;
            if (fetchDetails && card.url) {
                const r = await page.evaluate(async (u) => {
                    try {
                        const res = await fetch(u, { credentials: 'include', headers: { accept: 'text/html' } });
                        return { status: res.status, html: await res.text() };
                    } catch (e) { return { status: 0, html: '', error: String(e) }; }
                }, card.url);
                if (debug) await Actor.setValue(`detail-${card.id}`, r.html, { contentType: 'text/html' });
                if (r.status === 200 && !/<title>Just a moment/i.test(r.html.slice(0, 3000))) detail = parseDetail(r.html);
                else log.warning(`detail ${card.url}: status ${r.status}`);
                await page.waitForTimeout(400 + Math.random() * 600);
            }
            if (photoStore && detail?.photos?.length) await keepPhotos(page, detail.photos.slice(0, 8));
            await Actor.pushData(toRow(card, detail, rank, { label }));
            pushed += 1;
        }
        if (next && pushed < maxItems && cards.length) {
            await c.addRequests([{ url: next, userData: { ...request.userData, page: n + 1, rankBase: rank } }]);
        }
    },
    failedRequestHandler({ request }, err) {
        log.warning(`gave up on ${request.url}: ${err.message}`);
    },
});

await crawler.run(searches.map((s) => ({ url: s.url, userData: { label: s.label, searchUrl: s.url, anyPath: !!s.anyPath, page: 1, rankBase: 0 } })));
log.info(`done: ${pushed} rows, ${photosSaved} photos saved`);
await Actor.exit();
