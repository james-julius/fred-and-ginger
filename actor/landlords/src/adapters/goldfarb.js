// Goldfarb Properties (goldfarbproperties.com, "LOGIC Business Cloud" CMS): /rentals is
// server-rendered with every available unit as an <li class="listing-tile"> carrying
// data-region / data-beds / data-baths / data-price / data-available-now, the address
// line "330 West 58th Street, Apt. 14L" and a unit URL. One request.
// cfg: { base: 'https://goldfarbproperties.com' }
import { cheerio, makeRow, date, absUrl, num, clean } from '../lib.js';

const REGION_BOROUGH = { manhattan: 'Manhattan', 'the-bronx': 'Bronx', bronx: 'Bronx', rockaway: 'Queens', queens: 'Queens', brooklyn: 'Brooklyn', 'staten-island': 'Staten Island' };

export default async function goldfarb(cfg, { http }) {
    const base = cfg.base ?? 'https://goldfarbproperties.com';
    const $ = cheerio.load(await http.text(`${base}/rentals`));
    const rows = [];
    $('li.listing-tile').each((_, el) => {
        const li = $(el);
        const borough = REGION_BOROUGH[li.attr('data-region')];
        if (!borough) return;                                   // Westchester / Irvington
        const href = li.find('a.listing-tile__card-link').attr('href');
        const addr = clean(li.find('.property-address').text()) ?? '';
        const [street, apt] = addr.split(/,\s*(?:Apt\.?|Unit|#)\s*/i);
        const spoiler = li.find('.spoiler--top');
        rows.push(makeRow(cfg, {
            sourceId: href?.split('/').pop(),
            url: absUrl(href, base),
            street,
            unit: apt,
            neighbourhood: clean(spoiler.text()),
            borough,
            price: num(li.attr('data-price')),
            beds: num(li.attr('data-beds')),
            baths: num(li.attr('data-baths')),
            available: li.attr('data-available-now') === '1' ? date('now') : null,
            photos: [absUrl(li.find('img').attr('src'), base)],
            raw: {
                building: clean(spoiler.attr('data-building-name')), buildingId: spoiler.attr('data-building-id'),
                incentive: li.attr('data-incentive') === '1', openHouse: li.attr('data-openhouse') === '1',
                selfTour: li.find('a[id^=selftour]').attr('href') ?? null,
                amenities: li.attr('data-amenities')?.split(/\s+/) ?? [],
            },
        }));
    });
    return rows;
}
