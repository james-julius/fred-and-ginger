// Stonehenge NYC (stonehengenyc.com, Webflow CMS + Finsweet filters). /apartments
// server-renders every available unit as a card with neighbourhood, building, unit,
// street, beds, baths, sqft and rent. Move-in dates aren't published.
import { makeRow, absUrl, clean, int, num, boroughFromCity } from '../lib.js';

export default async function stonehenge(cfg, { http, log, limit }) {
    const base = cfg.baseUrl ?? 'https://www.stonehengenyc.com';
    const $ = await http.html(`${base}/apartments`);
    const rows = [];
    const seen = new Set();
    $('.apt-card-collection-item').each((_, el) => {
        const c = $(el);
        const href = c.find('a[href^="/apartments/"]').first().attr('href');
        if (!href || seen.has(href)) return;
        seen.add(href);
        const f = (name) => clean(c.find(`[fs-cmsfilter-field="${name}"]`).first().text());
        const hood = f('Neighborhood');
        const h4 = c.find('.container-medium h4');
        const sqftEl = c.find('.amenities-container').filter((__, x) => /ft²/.test($(x).text())).find('[fs-cmsfilter-field]').first();
        const bedText = f('Bedroom');
        rows.push(makeRow(cfg, {
            sourceId: href.split('/').pop(),
            url: absUrl(href, base),
            street: clean(c.find('.container-medium').next('.cards-text').text()) ?? clean(c.find('.cards-text').eq(1).text()),
            unit: clean(h4.eq(1).text()),
            neighbourhood: hood,
            borough: boroughFromCity(hood) ?? 'Manhattan',
            price: int(f('Price')),
            beds: /studio/i.test(bedText ?? '') ? 0 : num(bedText),
            baths: num(f('Bathroom')),
            sqft: int(sqftEl.text()),
            photos: [c.find('img.image--full').attr('src')],
            raw: { building: clean(h4.eq(0).text()), furnished: f('Furnished') === 'true', title: c.find('a[title]').attr('title') },
        }));
    });
    log.info(`stonehenge: ${rows.length} units`);
    return rows.slice(0, limit);
}
