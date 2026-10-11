// Greystar (greystar.com, Next.js). The market search page server-renders links to
// every property in the market (/<slug>/p_<id>); each property page's flight data
// (self.__next_f) holds `property` (address, lat/lon, floorplans with beds/baths,
// photos) and `propertyUnits` (unit number, sqft, price, available date).
// The market includes Westchester/Long Island/NJ, so slugs are filtered to NYC
// boroughs first and the property's own zip is checked after.
//
// About half the NYC buildings publish no units on greystar.com ("contact the community
// for pricing"). For those the building's own site is tried instead:
//   1. Jonah Digital sites (/floorplans/ embeds the unit JSON): plain HTTP;
//   2. else the RentCafe online-leasing page (securecafe.com, Cloudflare): browser only,
//      used when the company is flagged browser: true.
// cfg: { markets: [...], rentcafeBuildings?: ['The Brook'] (limit the browser fallback to these names;
//        each RentCafe page costs ~1 MB of residential proxy) }
import { makeRow, inNyc, date } from '../lib.js';
import { jonahBuilding } from './jonah.js';
import { securecafeRows, floorplansUrl } from './securecafe.js';

const NYC_SLUG = /-(new-york|brooklyn|queens|bronx|staten-island|long-island-city|astoria|flushing|jamaica|forest-hills|harlem)-ny$/;
const BASE = 'https://www.greystar.com';

function flight(html) {
    let s = '';
    for (const m of html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)) {
        try { s += JSON.parse(`"${m[1]}"`); } catch { /* skip */ }
    }
    return s;
}

function valueAfter(s, key) {
    const at = s.indexOf(key);
    if (at < 0) return null;
    try {
        const start = at + key.length;
        // raw_decode equivalent: find matching bracket
        const open = s[start], close = open === '[' ? ']' : '}';
        let depth = 0, inStr = false, esc = false;
        for (let i = start; i < s.length; i++) {
            const c = s[i];
            if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
            if (c === '"') inStr = true;
            else if (c === '[' || c === '{') depth++;
            else if ((c === ']' || c === '}') && --depth === 0) return JSON.parse(s.slice(start, i + 1));
        }
    } catch { /* fallthrough */ }
    return null;
}

export default async function greystar(cfg, { http, log, browser }) {
    const fallbacks = [];
    const paths = new Set();
    for (const market of cfg.markets ?? [`${BASE}/homes-to-rent/us/ny/new-york-city`]) {
        const html = await http.text(market);
        for (const m of html.matchAll(/href="(\/([a-z0-9-]+)\/p_\d+)"/g)) if (NYC_SLUG.test(m[2])) paths.add(m[1]);
    }
    log.info(`greystar: ${paths.size} NYC properties`);
    const rows = [];
    for (const path of paths) {
        const url = `${BASE}${path}`;
        try {
            const s = flight(await http.text(url));
            const prop = valueAfter(s.slice(s.indexOf('"property":{"id"')), '"property":');
            const units = valueAfter(s, '"propertyUnits":') ?? [];
            if (!prop?.location) { log.warning(`greystar ${path}: no property data`); continue; }
            const loc = prop.location;
            if (!inNyc({ zip: loc.postalCode, lat: loc.latitude, lon: loc.longitude })) continue;
            const plans = new Map((prop.floorplans ?? []).map((f) => [String(f.id), f]));
            const gallery = (prop.imageGallery ?? []).map((i) => i.url);
            for (const u of units) {
                const fp = plans.get(String(u.floorPlanId)) ?? {};
                rows.push(makeRow(cfg, {
                    sourceId: `${prop.id}-${u.unitId}`,
                    url,
                    street: loc.address,
                    unit: u.unitNumber,
                    neighbourhood: loc.greystarNeighborhood,
                    city: loc.city,
                    zip: loc.postalCode,
                    lat: loc.latitude, lon: loc.longitude,
                    price: u.minPrice ?? u.maxPrice,
                    beds: fp.bedroomCount ?? null,
                    baths: fp.bathroomCount ?? null,
                    sqft: u.area,
                    available: date(u.availableOn),
                    photos: [fp.imageUrl, ...gallery],
                    raw: { building: prop.name, propertyId: prop.id, floorPlan: u.floorPlanLabel, floor: u.floorShortLabel, maxPrice: u.maxPrice, leaseTerm: u.minBaseRentLeaseTerm },
                }));
            }
            log.info(`greystar ${prop.name}: ${units.length} units`);
            if (!units.length) {
                const site = s.match(/"communityWebsiteUrl":"([^"]*)"/)?.[1];
                const lease = s.match(/"leaseOnlineUrl":"([^"]*)"/)?.[1];
                fallbacks.push({
                    name: prop.name, propertyId: prop.id, greystarUrl: url,
                    site: site && !/greystar\.com/.test(site) ? site : null,
                    lease: lease && floorplansUrl(lease) ? lease : null,
                    street: loc.address, zip: loc.postalCode, city: loc.city, lat: loc.latitude, lon: loc.longitude, neighbourhood: loc.greystarNeighborhood,
                });
            }
        } catch (e) {
            log.warning(`greystar ${path}: ${e.message}`);
        }
    }

    // buildings whose units aren't on greystar.com
    const viaBrowser = [];
    for (const f of fallbacks) {
        const b = { name: f.name, street: f.street, zip: f.zip, city: f.city, lat: f.lat, lon: f.lon, neighbourhood: f.neighbourhood };
        if (f.site) {
            try {
                const r = await jonahBuilding(cfg, http, { ...b, url: f.site, sourcePrefix: String(f.propertyId) });
                log.info(`greystar ${f.name}: ${r.length} units from ${f.site}`);
                rows.push(...r);
                continue;
            } catch (e) {
                log.debug?.(`greystar ${f.name}: building site: ${e.message}`);
            }
        }
        const allowed = !cfg.rentcafeBuildings || cfg.rentcafeBuildings.includes(f.name);
        if (f.lease && browser && allowed) viaBrowser.push({ ...b, url: f.lease });
        else log.info(`greystar ${f.name}: no units published${f.lease ? ' (RentCafe needs browser)' : ''}`);
    }
    await Promise.all(viaBrowser.map(async (p) => {
        try {
            const r = await securecafeRows(cfg, browser, p);
            log.info(`greystar ${p.name}: ${r.length} rows from RentCafe`);
            rows.push(...r);
        } catch (e) {
            log.warning(`greystar ${p.name}: RentCafe: ${e.message}`);
        }
    }));
    return rows;
}
