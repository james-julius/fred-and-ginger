// Douglaston Development: each building has its own marketing site (no shared portal).
// Two layouts are handled:
//  - "avblock" (WordPress theme used by 3eleven, OHM, One North Fourth, Level BK):
//    .av_block cards with data-worth (rent), data-dates (MMDDYYYY or YYYYMMDD),
//    <strong>unit</strong>, "Available Now|date", "2 Bedrooms", "1 Bathroom", "538 SF".
//  - "mnstable" (AtlanticBK, MNS-fed): a <table> of Unit | Bed/Bath | Net Price*, with
//    data-aptid on the floor-plan link. Prices are net effective; the site gives no gross.
//
// cfg.buildings: [{ name, url, layout, street, zip, neighbourhood, borough?, lat?, lon? }]
import { makeRow, num, int, date, clean, absUrl, beds as parseBeds } from '../lib.js';

function dataDate(s) {
    const d = String(s ?? '').replace(/\D/g, '');
    if (d.length !== 8) return null;
    // YYYYMMDD if it starts with 20xx, else MMDDYYYY
    const iso = d.startsWith('20') ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : `${d.slice(4, 8)}-${d.slice(0, 2)}-${d.slice(2, 4)}`;
    return date(iso);
}

function avblock($, b, cfg) {
    const rows = [];
    $('.av_block').each((_, el) => {
        const card = $(el);
        const unitName = clean(card.find('.left_av strong').first().text());
        if (!unitName) return;
        const right = clean(card.find('.right_av').text()) ?? '';
        const left = clean(card.find('.left_av').text()) ?? '';
        const link = card.find('a.av_img').attr('href') ?? card.find('.bottom_btns a').first().attr('href');
        const img = (card.find('.inside_img').attr('style') ?? '').match(/url\(['"]?([^'")]+)/)?.[1];
        const availTxt = left.match(/available\s+(now|[\d/]+|\w+ \d+)/i)?.[1];
        rows.push(makeRow(cfg, {
            sourceId: `${new URL(b.url).hostname}:${unitName}`,
            url: absUrl(link, b.url) ?? b.url,
            street: b.street, unit: unitName, neighbourhood: b.neighbourhood, borough: b.borough, zip: b.zip, lat: b.lat, lon: b.lon,
            price: num(card.attr('data-worth')) ?? num(left.match(/\$[\d,]+/)?.[0]),
            beds: /studio/i.test(right) ? 0 : parseBeds(right),
            baths: num(right.match(/([\d.]+)\s*Bathroom/i)?.[1]),
            sqft: int(right.match(/([\d,]+)\s*SF/i)?.[1]),
            available: (availTxt ? date(availTxt) : null) ?? dataDate(card.attr('data-dates')),
            photos: img ? [img] : [],
            raw: { building: b.name, featured: card.attr('data-featured') === '1' },
        }));
    });
    return rows;
}

function mnstable($, b, cfg) {
    const rows = [];
    $('section.availability table tbody tr, table tbody tr').each((_, el) => {
        const tds = $(el).find('td');
        if (tds.length < 3) return;
        const unitName = clean($(tds[0]).text());
        const [bd, ba] = (clean($(tds[1]).text()) ?? '').split('/').map((x) => num(x));
        const fp = $(el).find('[data-aptid]').first();
        if (!unitName || bd == null) return;
        rows.push(makeRow(cfg, {
            sourceId: `${new URL(b.url).hostname}:${fp.attr('data-aptid') ?? unitName}`,
            url: b.url,
            street: b.street, unit: unitName, neighbourhood: b.neighbourhood, borough: b.borough, zip: b.zip, lat: b.lat, lon: b.lon,
            price: num($(tds[2]).text()),
            beds: bd,
            baths: ba ?? null,
            photos: fp.attr('data-floorplanimage') ? [absUrl(fp.attr('data-floorplanimage'), b.url)] : [],
            raw: { building: b.name, priceIsNetEffective: true, floorplan: fp.attr('data-floorplandocument') ?? null },
        }));
    });
    return rows;
}

export default async function douglaston(cfg, { http, log }) {
    const rows = [];
    for (const b of cfg.buildings ?? []) {
        try {
            const $ = await http.html(b.url);
            rows.push(...(b.layout === 'mnstable' ? mnstable($, b, cfg) : avblock($, b, cfg)));
        } catch (e) {
            log.warning?.(`douglaston ${b.name}: ${e.message}`);
        }
    }
    return rows;
}
