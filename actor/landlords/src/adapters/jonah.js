// Jonah Digital building sites (a web agency used by Greystar and Rose Associates).
// Their /floorplans/ page server-renders the whole floor-plan app state as JSON in
// <script id="jd-fp-data-script-app">: `units` (number, beds, baths, sqft, rent,
// available date, floor plan image) and `floorplans`. The page's schema.org block
// gives the address. Plain HTTP, one request per building.
//
// cfg: { buildings: [{ name, url, street?, zip?, neighbourhood?, borough? }] }
import { makeRow, int, num, date, inNyc } from '../lib.js';

export function jonahData(html) {
    const m = html.match(/<script type="application\/json" id="jd-fp-data-script-app">([\s\S]*?)<\/script>/);
    return m ? JSON.parse(m[1]) : null;
}

export function jonahAddress(html) {
    const g = (k) => html.match(new RegExp(`"${k}"\\s*:\\s*"([^"]+)"`))?.[1] ?? null;
    return { street: g('streetAddress'), zip: g('postalCode')?.slice(0, 5) ?? null, city: g('addressLocality'), lat: num(g('latitude')), lon: num(g('longitude')) };
}

// one row per unit; `b` supplies building-level fields (street, zip, lat/lon, name, sourcePrefix)
export function jonahRows(cfg, b, data, pageUrl) {
    const origin = new URL(pageUrl).origin;
    const plans = new Map((data.floorplans ?? []).map((f) => [f.id, f]));
    return (data.units ?? []).map((u) => {
        const fp = plans.get(u.floorplan_id) ?? {};
        const pe = u.price_entity ?? {};
        const avail = /now|immediate/i.test(u.available_display ?? '') ? date('now')
            : u.available_date ? date(new Date(Number(u.available_date) * 1000).toISOString()) : null;
        return makeRow(cfg, {
            sourceId: `${b.sourcePrefix ?? new URL(origin).hostname}-${u.id_value ?? u.id}`,
            url: u.permalink ? new URL(u.permalink, origin).toString() : pageUrl,
            street: b.street,
            unit: u.apartment_number,
            neighbourhood: b.neighbourhood ?? null,
            borough: b.borough ?? undefined,
            zip: b.zip,
            city: b.city,
            lat: b.lat, lon: b.lon,
            price: int(u.rent_min) || pe.priceLow,
            beds: /studio/i.test(String(u.bedrooms ?? '')) ? 0 : num(u.bedrooms),
            baths: num(u.bathrooms),
            sqft: int(u.square_feet),
            available: avail,
            photos: [u.thumbnail?.src, fp.thumbnail?.src].filter((s) => s && !/\.svg$/i.test(s)),
            raw: {
                building: b.name, floorPlan: u.floorplan_title, baseRent: int(pe.adjusted?.low_no_fees),
                rentMax: int(u.rent_max), leaseTerm: pe.term ?? null, specials: (u.specials ?? []).map((s) => s.title ?? s).filter(Boolean),
                floorPlanImage: u.thumbnail?.src ?? null,
            },
        });
    }).filter((r) => r.price > 0);
}

export async function jonahBuilding(cfg, http, b) {
    const url = new URL(b.floorplansPath ?? '/floorplans/', b.url).toString();
    const html = await http.text(url);
    const data = jonahData(html);
    if (!data) throw new Error(`no jd-fp data on ${url}`);
    const a = jonahAddress(html);
    const bb = { ...a, ...Object.fromEntries(Object.entries(b).filter(([, v]) => v != null)) };
    return jonahRows(cfg, bb, data, url);
}

export default async function jonah(cfg, { http, log }) {
    const rows = [];
    for (const b of cfg.buildings ?? []) {
        try {
            const r = (await jonahBuilding(cfg, http, b)).filter((x) => inNyc({ zip: x.zip, lat: x.lat, lon: x.lon }));
            log.info(`jonah ${b.name}: ${r.length} units`);
            rows.push(...r);
        } catch (e) {
            log.warning(`jonah ${b.name}: ${e.message}`);
        }
    }
    return rows;
}
