// Manhattan Skyline (manhattanskyline.com): Laravel + Vue site with its own JSON API.
// GET /api/units?page=N returns paginated units (rentals, sales, commercial) with the
// building embedded. Building names like "Saranac" aren't addresses, so each such
// building page is fetched once for its <address> line ("95 Worth Street , New York, NY 10013").
// cfg: { base: 'https://manhattanskyline.com' }
import { makeRow, date, splitAddress, clean, boroughFromZip } from '../lib.js';

const stripTags = (s) => clean(String(s ?? '').replace(/<[^>]+>/g, ''));
const isStreet = (s) => /^\d/.test(s ?? '');

export default async function manhattanskyline(cfg, { http, log, limit }) {
    const base = cfg.base ?? 'https://manhattanskyline.com';
    const units = [];
    for (let p = 1; p <= 20; p++) {
        const d = await http.json(`${base}/api/units?page=${p}`);
        const pg = d.units ?? {};
        units.push(...(pg.data ?? []));
        if (!pg.next_page_url || units.length >= limit) break;
    }
    const rentals = units.filter((u) => u.is_rental && u.is_residential !== false && !u.is_sale);

    const addr = {};
    for (const u of rentals) {
        const b = u.building ?? {};
        if (b.id in addr) continue;
        const name = stripTags(b.name);
        if (isStreet(name)) { addr[b.id] = { street: name }; continue; }
        try {
            const h = await http.text(b.url);
            const line = h.match(/<address[^>]*>\s*([^<]+)/)?.[1];
            addr[b.id] = line ? splitAddress(line.replace(/\s+,/g, ',')) : {};
        } catch (e) {
            log.warning?.(`manhattanskyline ${b.url}: ${e.message}`);
            addr[b.id] = {};
        }
    }

    return rentals.map((u) => {
        const b = u.building ?? {};
        const a = addr[b.id] ?? {};
        const imgs = [...(u.images ?? []), ...(u.card_images ?? [])].map((i) => i.gallery || i.src);
        return makeRow(cfg, {
            sourceId: u.slug,
            url: u.url,
            street: a.street ?? stripTags(b.name),
            unit: u.number,
            neighbourhood: b.neighborhood?.name,
            borough: boroughFromZip(a.zip) ?? (b.neighborhood?.region_residential ? 'Manhattan' : null),
            zip: a.zip,
            lat: b.address?.latLng?.lat, lon: b.address?.latLng?.lng,
            price: u.price,
            beds: u.bedrooms,
            baths: u.bathrooms,
            sqft: u.square_footage,
            available: date(u.available_on),
            photos: [...new Set(imgs)],
            raw: {
                building: stripTags(b.name), buildingGroup: b.address?.display_name ?? null, highlight: u.highlight,
                concessionMonthsFree: u.concession_months_free ?? b.concession_months_free ?? null,
                concessionLeaseTerm: u.concession_lease_term ?? b.concession_lease_term ?? null,
                incentives: u.incentives?.length ? u.incentives : null, tour3d: u.three_d_tour_url,
            },
        });
    });
}
