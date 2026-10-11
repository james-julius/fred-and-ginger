// SightMap (Engrain) interactive unit maps. A building page embeds
// https://sightmap.com/embed/<embedId>; that page names a JSON endpoint
// /app/api/v1/<key>/sightmaps/<id> listing every available unit with price, sqft,
// available date and floor plan (beds/baths/image). SightMap carries no address,
// so each property supplies its own.
//
// cfg: { properties: [{ name, street, zip, neighbourhood?, lat?, lon?, url,
//                       embed?: '40vlmderple' | page?: 'https://building-site/with/embed' }] }
import { makeRow, date } from '../lib.js';

export async function findEmbed(http, pageUrl) {
    const res = await http.request(pageUrl);
    const ids = [...res.text.matchAll(/sightmap\.com\/(?:app\/)?embed\/([a-z0-9]{8,})/gi)].map((m) => m[1]);
    return { embed: ids[0] ?? null, html: res.text, url: res.url };
}

export async function sightmapData(http, embed) {
    const page = await http.text(`https://sightmap.com/embed/${embed}`);
    const api = page.match(/https:\/\/sightmap\.com\/app\/api\/v1\/[a-z0-9]+\/sightmaps\/\d+/i)?.[0];
    if (!api) throw new Error(`sightmap ${embed}: no api url in embed page`);
    return (await http.json(api)).data;
}

// SightMap units -> schema rows for one property
export function sightmapRows(cfg, prop, data) {
    const plans = new Map((data.floor_plans ?? []).map((f) => [f.id, f]));
    return (data.units ?? []).map((u) => {
        const fp = plans.get(u.floor_plan_id) ?? {};
        const price = u.price ?? null;
        const total = Array.isArray(u.total_price) ? u.total_price[0] : null;
        return makeRow(cfg, {
            sourceId: `sightmap-${u.id}`,
            url: prop.url ?? null,
            street: prop.street,
            unit: String(u.unit_number ?? u.label ?? '').replace(/^0-/, '') || null,
            neighbourhood: prop.neighbourhood,
            zip: prop.zip,
            lat: prop.lat, lon: prop.lon,
            price,
            beds: fp.bedroom_count ?? null,
            baths: fp.bathroom_count ?? null,
            sqft: u.area,
            available: date(u.available_on),
            photos: [fp.image_url, u.view_image_url].filter(Boolean),
            raw: {
                building: prop.name ?? data.asset?.name, sightmapUnitId: u.id, unitNumber: u.unit_number, floorPlan: fp.name,
                totalMonthly: total, specials: u.specials_description || null,
                affordable: !!u.affordable_housing_info?.is_affordable_housing_unit,
            },
        });
    }).filter((r) => r.price > 0);
}

export default async function sightmap(cfg, { http, log }) {
    const rows = [];
    for (const prop of cfg.properties ?? []) {
        try {
            const embed = prop.embed ?? (await findEmbed(http, prop.page ?? prop.url)).embed;
            if (!embed) { log.warning(`sightmap ${prop.name}: no embed found`); continue; }
            const data = await sightmapData(http, embed);
            const r = sightmapRows(cfg, prop, data);
            log.info(`sightmap ${prop.name}: ${r.length} units`);
            rows.push(...r);
        } catch (e) {
            log.warning(`sightmap ${prop.name}: ${e.message}`);
        }
    }
    return rows;
}
