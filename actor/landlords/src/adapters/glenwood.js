// Glenwood Management (glenwoodnyc.com, WordPress). The "See all apartments"
// search (/search-result/?bedroom=-1) server-renders every available unit as a card:
// building, neighbourhood, listing id, beds, baths, price, photo. Street addresses
// come from each building page's schema.org ApartmentComplex block (one request per
// building). Unit number, sqft and move-in date aren't published.
import { makeRow, absUrl, clean, int, num } from '../lib.js';

const BRONX = /riverdale/i;

export default async function glenwood(cfg, { http, log, limit }) {
    const base = cfg.baseUrl ?? 'https://www.glenwoodnyc.com';
    const $ = await http.html(`${base}/search-result/?bedroom=-1&nhood=&price=`);
    const cards = [];
    $('.featured-card').each((_, el) => {
        const c = $(el);
        const href = c.find('a[href*="listing-detail"]').attr('href');
        const lid = href?.match(/lid=(\d+)/)?.[1];
        if (!lid) return;
        const field = (label) => {
            const col = c.find('.details .col').filter((__, x) => $(x).find('p').first().text().trim().toLowerCase() === label);
            return clean(col.find('span').first().text());
        };
        const priceText = c.text().match(/Monthly Price\s*\$\s*([\d,]+)/i)?.[1];
        const bLink = c.find('.the-title a').first();
        cards.push({
            lid,
            url: absUrl(href.replace(/&sr=yes/, ''), base),
            building: clean(bLink.text()),
            buildingUrl: absUrl(bLink.attr('href'), base),
            neighbourhood: clean(c.find('.product-area span').first().text()),
            beds: num(field('bedrooms')),
            baths: num(field('bathrooms')),
            price: int(priceText),
            photo: c.find('img[data-src]').attr('data-src') ?? c.find('noscript img').attr('src'),
        });
    });
    log.info(`glenwood: ${cards.length} cards`);
    // some cards leave the building link's href empty: borrow it from a sibling card
    const byName = Object.fromEntries(cards.filter((c) => c.buildingUrl).map((c) => [c.building, c.buildingUrl]));
    for (const c of cards) c.buildingUrl ??= byName[c.building] ?? null;

    const addr = {};
    for (const u of new Set(cards.map((c) => c.buildingUrl).filter(Boolean))) {
        try {
            const html = await http.text(u.endsWith('/') ? u : `${u}/`);
            const at = html.search(/"@type":\s*"apartmentComplex"/i);
            const block = at >= 0 ? html.slice(at, at + 800) : '';
            const street = block.match(/"streetAddress":\s*"([^"]+)"/)?.[1];
            if (street) addr[u] = { street, zip: block.match(/"postalCode":\s*"(\d{5})/)?.[1] ?? null };
            else log.warning(`glenwood: no address on ${u}`);
        } catch (e) {
            log.warning(`glenwood: building ${u}: ${e.message}`);
        }
    }

    return cards.slice(0, limit).map((c) => makeRow(cfg, {
        sourceId: c.lid,
        url: c.url,
        street: addr[c.buildingUrl]?.street ?? null,
        zip: addr[c.buildingUrl]?.zip ?? null,
        neighbourhood: c.neighbourhood,
        borough: BRONX.test(c.neighbourhood ?? '') ? 'Bronx' : 'Manhattan',
        price: c.price,
        beds: c.beds,
        baths: c.baths,
        photos: [c.photo ? encodeURI(c.photo) : null],
        raw: { building: c.building, buildingUrl: c.buildingUrl },
    }));
}
