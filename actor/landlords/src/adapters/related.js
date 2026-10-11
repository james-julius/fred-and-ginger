// Related Rentals (relatedrentals.com, Drupal). Server-rendered search results,
// 12 unit cards per page (?page=N), each card carrying data-* attributes for price,
// beds, baths and availability. Building addresses + coordinates come from the
// property-map JSON embedded in any building page (one extra request).
import { makeRow, absUrl, date, clean } from '../lib.js';

export default async function related(cfg, { http, log, limit }) {
    const base = cfg.baseUrl ?? 'https://www.relatedrentals.com';
    const city = cfg.city ?? 'New York City';

    // property title -> { address, lat, lon }
    const props = {};
    const bp = await http.text(absUrl(cfg.anyBuildingPath ?? '/apartment-rentals/new-york-city/chelsea/the-tate', base));
    for (const m of bp.matchAll(/\{"title":"((?:[^"\\]|\\.)*)","neighborhood":"\d+","description":"(?:[^"\\]|\\.)*","address":"((?:[^"\\]|\\.)*)"(?:[^{}]*?)"lat":(-?[\d.]+),"lon":(-?[\d.]+)/g)) {
        props[JSON.parse(`"${m[1]}"`)] = { address: JSON.parse(`"${m[2]}"`), lat: Number(m[3]), lon: Number(m[4]) };
    }
    log.info(`related: ${Object.keys(props).length} properties with addresses`);

    const rows = [];
    for (let page = 0; page < (cfg.maxPages ?? 20); page++) {
        const url = `${base}/search?${encodeURIComponent(`city[${city}]`)}=${encodeURIComponent(city)}${page ? `&page=${page}` : ''}`;
        const $ = await http.html(url);
        const cards = $('article.node--type-unit');
        cards.each((_, el) => {
            const a = $(el);
            if (a.attr('data-brand') !== city) return;
            const building = clean(a.find('.fg-unit-related__content-header strong').text());
            const p = props[building] ?? {};
            const addr = (p.address ?? '').match(/^(.*?),\s*([^,]*),\s*NY\s*(\d{5})/i);
            rows.push(makeRow(cfg, {
                sourceId: a.attr('data-api-id') ?? a.attr('data-nid'),
                url: absUrl(a.find('a').first().attr('href'), base),
                street: addr?.[1] ?? null,
                city: addr?.[2] ?? null,
                zip: addr?.[3] ?? null,
                neighbourhood: a.attr('data-category'),
                lat: p.lat, lon: p.lon,
                price: a.attr('data-price'),
                beds: Number(a.attr('data-dimension6')),
                baths: Number(a.attr('data-dimension7')),
                available: date(a.attr('data-dimension9')),
                photos: [absUrl(a.find('img').attr('src'), base)],
                raw: { building, title: clean(a.find('h3.title').text()), nid: a.attr('data-nid') },
            }));
        });
        if (!cards.length || !$('.pager__item--next').length || rows.length >= limit) break;
    }
    return rows;
}
