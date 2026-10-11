// Rockrose (rockrose.com): WordPress page /availabilities/ server-renders every
// available unit as a grid card (li.grid-item) with price, lat/lng, address, unit,
// size and a link to /listing/<slug>/. No available date or sqft on the site.
import { makeRow, beds as parseBeds, baths as parseBaths, num, clean, splitAddress, absUrl } from '../lib.js';

export default async function rockrose(cfg, { http }) {
    const base = cfg.url ?? 'https://rockrose.com/availabilities/';
    const $ = await http.html(base);
    const rows = [];
    $('li.grid-item[data-id]').each((_, el) => {
        const li = $(el);
        const addrSpans = li.find('.address-wrapper .address');
        const addrHtml = $(addrSpans[0]).html() ?? '';
        const addr = splitAddress(addrHtml.replace(/<br\s*\/?>/gi, ', ').replace(/<[^>]+>/g, ''));
        const unitTxt = clean($(addrSpans[1]).text());
        const size = clean(li.find('li.size').text()) ?? '';            // "Studio, 1 Bath" / "1 Bedroom, 1 Bath"
        const [sizeName] = size.split(',');
        const b = /studio/i.test(sizeName) ? 0 : parseBeds(sizeName);
        const link = li.find('a.save-availabilities-order').attr('href');
        const img = li.find('img').attr('data-src') ?? li.find('noscript img').attr('src');
        const promo = clean(li.find('li.advertisement').text());
        rows.push(makeRow(cfg, {
            sourceId: li.attr('data-id'),
            url: absUrl(link, base),
            street: addr.street,
            city: addr.city,
            zip: addr.zip,
            unit: unitTxt,
            neighbourhood: clean(li.find('.neighborhood').text()),
            lat: num(li.attr('data-lat')),
            lon: num(li.attr('data-lng')),
            price: num(li.attr('data-price')) ?? num(li.find('li.price').text()),
            beds: b,
            baths: parseBaths(size),
            photos: img ? [img.replace(/-thumb(\.\w+)$/, '$1')] : [],
            raw: { size, promo, building: li.find('img').attr('alt') ?? null, amenities: safeJson(li.attr('data-amenities')) },
        }));
    });
    return rows;
}

function safeJson(s) {
    try { return JSON.parse(s); } catch { return null; }
}
