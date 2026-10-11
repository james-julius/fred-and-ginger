// nest: Nooklyn (nooklyn.com) rentals -> dataset rows, one per listing (see ../SCHEMA.md).
//
// nooklyn.com/rentals is a React app that loads everything from public JSON endpoints (no login):
//   GET  /api/v3/filters/regions.json            boroughs (regions) -> neighborhoods {id, name}
//   POST /api/v3/web/listings.search              {neighborhood_id_list, max_price (USD), bed_list, order, page, per_page}
//                                                 -> {total_count, page_count, listings: [...]}; prices are in CENTS
//   GET  /api/v3/web/listings.list?listing_ids[]= full records (unit, zip, baths, move_in_cost, description, ...), max 100 ids
//   GET  /api/v3/web/listings.images?listing_id=  all photos
//   GET  /api/v3/web/listings.price_history?listing_id=  first entry (old_price -1) = date the listing was created
// Nooklyn has no explicit fee flag; each listing has move_in_cost (e.g. ["First Month","Security"]).
// noFee = true when that list has no broker/fee item.
import { Actor, log } from 'apify';
import { gotScraping } from 'got-scraping';

await Actor.init();
const input = (await Actor.getInput()) ?? {};
const maxItems = input.maxItems ?? 100;
const fetchDetails = input.fetchDetails ?? true;
const BASE = 'https://nooklyn.com';

// on the platform: Apify proxy (datacenter by default); local runs go direct
const proxyConfiguration = Actor.isAtHome()
    ? await Actor.createProxyConfiguration(input.proxyGroups?.length ? { groups: input.proxyGroups, countryCode: 'US' } : {})
    : undefined;

let requests = 0;
async function api(path, { method = 'GET', json } = {}) {
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
        requests++;
        try {
            const res = await gotScraping({
                url: `${BASE}${path}`,
                method,
                json,
                proxyUrl: proxyConfiguration ? await proxyConfiguration.newUrl(`s${Math.floor(Math.random() * 1e6)}`) : undefined,
                headers: { accept: 'application/json', referer: `${BASE}/rentals`, origin: BASE },
                responseType: 'text',
                timeout: { request: 30000 },
                throwHttpErrors: false,
            });
            if (res.statusCode === 403 || /captcha|cf-chl/i.test(res.body.slice(0, 2000))) {
                throw Object.assign(new Error(`blocked (${res.statusCode}) on ${path}`), { blocked: true });
            }
            if (res.statusCode >= 400) throw new Error(`HTTP ${res.statusCode} on ${path}`);
            return JSON.parse(res.body);
        } catch (e) {
            lastErr = e;
            log.warning(`attempt ${attempt} ${method} ${path.slice(0, 80)}: ${e.message}`);
            await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
    }
    throw lastErr;
}

async function pool(items, n, fn) {
    const out = new Array(items.length);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
        while (i < items.length) { const k = i++; out[k] = await fn(items[k], k).catch((e) => { log.warning(e.message); return null; }); }
    }));
    return out;
}

const slugify = (s) => String(s ?? '').toLowerCase().replace(/['’.]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const abs = (u) => (!u ? null : u.startsWith('//') ? `https:${u}` : u.startsWith('/') ? `${BASE}${u}` : u);

// StreetEasy slug -> extra Nooklyn names (Nooklyn has some duplicates/variants).
const ALIASES = {
    'bedford-stuyvesant': ['Bed-Stuy', 'Bedford-Stuyvesant', 'Stuyvesant Heights'],
    'bed-stuy': ['Bed-Stuy', 'Bedford-Stuyvesant'],
    'prospect-lefferts-gardens': ['PLG: Prospect Lefferts Gardens', 'Prospect-Lefferts Gardens'],
    'plg': ['PLG: Prospect Lefferts Gardens', 'Prospect-Lefferts Gardens'],
    'hells-kitchen': ["Hell's Kitchen", 'Clinton'],
    'clinton': ["Hell's Kitchen", 'Clinton'],
    'flatiron': ['Flatiron', 'Flatiron District'],
    'gramercy-park': ['Gramercy Park', 'Gramercy'],
    'theater-district': ['Theater District', 'Theatre District'],
    'greenwood': ['Greenwood Heights'],
    'columbia-st-waterfront-district': ['Columbia St'],
    'navy-yard': ['Navy Yard', 'Brooklyn Navy Yard'],
    'ditmars-steinway': ['Ditmars Steinway'],
    'stuyvesant-town-peter-cooper-village': ['Stuyvesant Town'],
};

// ---------- neighbourhood mapping ----------
const { regions = [] } = await api('/api/v3/filters/regions.json');
const hoodBorough = new Map();   // neighborhood id -> borough name
const bySlug = new Map();        // slug -> Set(ids)
const byName = new Map();        // exact name -> id
for (const r of regions) {
    for (const n of r.neighborhoods ?? []) {
        hoodBorough.set(n.id, r.name);
        byName.set(n.name, n.id);
        const s = slugify(n.name);
        if (!bySlug.has(s)) bySlug.set(s, new Set());
        bySlug.get(s).add(n.id);
    }
}
const BORO_SLUG = { brooklyn: 'Brooklyn', queens: 'Queens', manhattan: 'Manhattan', bronx: 'Bronx', 'the-bronx': 'Bronx', 'staten-island': 'Staten Island' };
const wanted = (input.neighbourhoods ?? []).map((s) => slugify(s)).filter(Boolean);
const hoodIds = new Set();
const regionIds = new Set();
const unmatched = [];
for (const s of wanted) {
    const boro = BORO_SLUG[s] && regions.find((r) => r.name === BORO_SLUG[s]);
    if (boro) { regionIds.add(boro.id); continue; }
    const ids = new Set(bySlug.get(s) ?? []);
    for (const name of ALIASES[s] ?? []) if (byName.has(name)) ids.add(byName.get(name));
    if (!ids.size) { unmatched.push(s); continue; }
    ids.forEach((id) => hoodIds.add(id));
}
if (unmatched.length) log.warning(`no Nooklyn neighborhood for: ${unmatched.join(', ')}`);
if (wanted.length && !hoodIds.size && !regionIds.size) {
    log.warning('none of the neighbourhoods matched; nothing to search');
    await Actor.exit();
}
log.info(`neighborhood ids: ${[...hoodIds].join(',') || '-'}; region ids: ${[...regionIds].join(',') || '-'}`);

// ---------- search ----------
const minBeds = input.minBeds ?? null;
const body = {
    order: 'recently_created',
    per_page: 50,
    neighborhood_id_list: hoodIds.size ? [...hoodIds] : undefined,
    region_id_list: regionIds.size ? [...regionIds] : undefined,
    max_price: input.maxPrice || undefined,
    bed_list: minBeds != null && minBeds > 0 ? [0, 1, 2, 3, 4, 5].filter((b) => b >= Math.min(minBeds, 5)) : undefined,
};
const found = [];
for (let page = 1; page <= 20 && found.length < maxItems; page++) {
    const d = await api('/api/v3/web/listings.search', { method: 'POST', json: { ...body, page } });
    const list = d.listings ?? [];
    found.push(...list);
    log.info(`search page ${page}/${d.page_count ?? '?'}: ${list.length} listings (total ${d.total_count ?? '?'})`);
    if (!list.length || page >= (d.page_count ?? 1)) break;
}
const seen = new Set();
const ids = found.filter((l) => l.rental !== false && !seen.has(l.id) && seen.add(l.id)).map((l) => l.id);

// full records, 100 ids per call
const full = new Map();
for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const q = chunk.map((id) => `listing_ids%5B%5D=${id}`).join('&');
    const d = await api(`/api/v3/web/listings.list?${q}`);
    for (const l of d.listings ?? []) full.set(l.id, l);
}
const searchById = new Map(found.map((l) => [l.id, l]));

// ---------- map ----------
const ROOM_RX = /\b(room ?share|roommates?\b|room for rent|private (bed)?room (in|available)|rooms? available in|shared (apartment|apt|unit|house)|looking for a roommate|sublet a room)/i;
const FEE_RX = /fee|broker/i;

let items = ids.map((id) => {
    const l = { ...searchById.get(id), ...(full.get(id) ?? {}) };
    const price = l.price != null ? Math.round(l.price / 100) : null;
    const conc = (l.concessions ?? [])[0];
    const netEffective = conc?.net_effective_rent ? Math.round(conc.net_effective_rent) : null;
    const desc = l.description ?? '';
    const moveIn = Array.isArray(l.move_in_cost) ? l.move_in_cost : null;
    let noFee = null;
    if (moveIn) noFee = !moveIn.some((x) => FEE_RX.test(x));
    else if (/\bno[\s-]?(broker'?s?\s+)?fee\b/i.test(desc)) noFee = true;
    const roomText = `${l.short_address ?? ''} ${desc}`;
    const roomShare = !!((l.rooms_available ?? 0) > 0 || /room/i.test(l.market_as ?? '') || ROOM_RX.test(roomText));
    const addrParts = String(l.address ?? '').split(',').map((s) => s.trim());
    const boroFromAddr = ['Brooklyn', 'Queens', 'Manhattan', 'Bronx', 'Staten Island'].find((b) => addrParts.includes(b) || (b === 'Manhattan' && addrParts.includes('New York')));
    const street = l.address_line_one || (String(l.short_address ?? '').split(' - Unit:')[0] || addrParts[0]) || null;
    const unitRaw = l.unit ?? l.apartment ?? (String(l.short_address ?? '').match(/Unit:\s*(.+)$/) || [])[1] ?? null;
    const baths = l.full_baths != null ? l.full_baths + 0.5 * (l.half_baths ?? 0) : num(l.bathrooms);
    const img = l.image ?? {};
    return {
        id,
        url: abs(l.listing_url || l.url) ?? `${BASE}/listings/${l.slug ?? id}`,
        row: {
            source: 'nooklyn',
            sourceId: String(id),
            url: null,
            street,
            unit: unitRaw ? String(unitRaw).replace(/^(apt\.?|unit|#)\s*/i, '').trim() || null : null,
            neighbourhood: l.neighborhood?.name ?? null,
            borough: hoodBorough.get(l.neighborhood?.id) ?? boroFromAddr ?? null,
            zip: l.zip_code || (String(l.address ?? '').match(/\bNY (\d{5})\b/) || [])[1] || null,
            lat: num(l.latitude),
            lon: num(l.longitude),
            price,
            netEffective: netEffective && netEffective !== price ? netEffective : null,
            beds: num(l.bedrooms),
            baths,
            sqft: l.square_feet ? Math.round(l.square_feet) : null,
            noFee,
            available: l.date_available || null,
            photos: [img.xlarge || img.large || img.wide || img.medium].filter(Boolean),
            agency: 'Nooklyn',
            listedAt: null,
            scrapedAt: null,
            raw: {
                roomShare,
                moveInCost: moveIn,
                network: l.network ?? null,
                platformListing: l.platform_listing ?? null,
                marketAs: l.market_as ?? null,
                status: l.status ?? null,
                shortAddress: l.short_address ?? null,
                address: l.address ?? null,
                neighborhoodId: l.neighborhood?.id ?? null,
                buildingId: l.building_id ?? null,
                concessions: l.concessions?.length ? l.concessions : null,
                pets: l.pets ?? null,
                utilities: l.utilities ?? null,
                includedUtilities: l.included_utilities ?? null,
                amenities: l.amenities ?? null,
                subwayLines: l.subway_lines ?? null,
                station: l.station ?? null,
                incomeRestricted: l.income_restricted ?? null,
                featured: l.featured ?? null,
                contact: l.contact?.name ?? l.sales_team?.name ?? null,
                agentFirstName: l.creator?.first_name ?? null,
                description: desc ? desc.slice(0, 4000) : null,
                priceHistory: null,
            },
        },
    };
});

// filters the API might not apply exactly; keep a listing if gross OR net-effective fits the budget
items = items
    .filter(({ row }) => !input.maxPrice || row.price == null || row.price <= input.maxPrice || (row.netEffective != null && row.netEffective <= input.maxPrice))
    .filter(({ row }) => minBeds == null || row.beds == null || row.beds >= minBeds)
    .slice(0, maxItems);

// ---------- details: photos + posted date ----------
if (fetchDetails && items.length) {
    await pool(items, 3, async (it) => {
        const [imgs, hist] = await Promise.all([
            api(`/api/v3/web/listings.images?listing_id=${it.id}&active_only=true`).catch((e) => { if (e.blocked) throw e; return null; }),
            api(`/api/v3/web/listings.price_history?listing_id=${it.id}`).catch((e) => { if (e.blocked) throw e; return null; }),
        ]);
        const photos = (imgs?.images ?? []).map((im) => im.large || im.xwide || im.wide || im.original).filter((u) => u && !/\/assets\/logo\//.test(u));
        if (photos.length) it.row.photos = photos.slice(0, 8);
        const ph = hist?.priceHistory ?? [];
        if (ph.length) {
            const created = ph.find((p) => p.old_price === -1) ?? [...ph].sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
            it.row.listedAt = created?.date ? `${created.date}T00:00:00.000Z` : null;
            it.row.raw.priceHistory = ph.map((p) => ({ date: p.date, oldPrice: p.old_price > 0 ? p.old_price / 100 : null, newPrice: p.new_price / 100 }));
        }
    });
}

const scrapedAt = new Date().toISOString();
const rows = items.map(({ url, row }) => ({ ...row, url, scrapedAt }));
rows.sort((a, b) => (b.listedAt ?? '').localeCompare(a.listedAt ?? '') || Number(b.sourceId) - Number(a.sourceId));
await Actor.pushData(rows);
log.info(`done: ${rows.length} rows (${found.length} found, ${requests} API requests)`);
await Actor.exit();
