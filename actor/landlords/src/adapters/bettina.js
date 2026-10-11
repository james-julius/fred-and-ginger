// Bettina Equities (bettinaequities.com): WordPress theme with its own JSON endpoint,
// /wp-content/themes/bettina/apartments_api.php -> { data: { results: [apartment posts
// with .meta], property: [building posts with .meta address/zip/lat/lon] } }.
// One request (robots.txt asks for Crawl-delay 10, so nothing else is fetched).
// Mapping follows the site's own availabilities.js renderer (meta.rent, meta.bedrooms,
// meta.baths, meta.neighborhood_, meta.property_obj, meta.portfolio_image, meta.availability).
// cfg: { base: 'https://www.bettinaequities.com' }
import { makeRow, date, absUrl, num } from '../lib.js';

const decode = (s) => String(s ?? '').replace(/&#8211;|&ndash;/g, '-').replace(/&#038;|&amp;/g, '&').replace(/&#8217;/g, "'");

export default async function bettina(cfg, { http }) {
    const base = cfg.base ?? 'https://www.bettinaequities.com';
    const d = await http.json(`${base}/wp-content/themes/bettina/apartments_api.php`);
    const props = {};
    for (const p of d?.data?.property ?? []) props[String(p.ID)] = p;
    return (d?.data?.results ?? [])
        .filter((a) => a.meta?.availability !== 'rented')
        .map((a) => {
            const m = a.meta ?? {};
            const pid = String(typeof m.property_obj === 'object' ? m.property_obj?.ID : m.property_obj ?? '');
            const p = props[pid]?.meta ?? {};
            const title = decode(a.post_title);
            const [street, unitPart] = title.split(/\s+[-–]\s+/);
            return makeRow(cfg, {
                sourceId: a.ID,
                url: absUrl(`/apartments/${a.post_name}`, base),
                street: p.prop_address || street,
                unit: m.unit || m.apartment_number || unitPart || null,
                neighbourhood: m.neighborhood_ || null,
                zip: p.prop_zip,
                city: p.prop_city,
                lat: p.latitude, lon: p.longitude,
                price: num(m.rent),
                beds: /studio/i.test(m.bedrooms) ? 0 : num(m.bedrooms),
                baths: num(m.baths),
                sqft: num(m.square_feet ?? m.sqft),
                available: date(m.available_date ?? m.date_available) ?? null,
                photos: [m.portfolio_image],
                listedAt: a.post_date_gmt ? `${a.post_date_gmt.replace(' ', 'T')}Z` : null,
                raw: { building: props[pid]?.post_title ?? null, appPending: m.app_pending === '1', openHouse: m.has_open_house === '1' },
            });
        });
}
