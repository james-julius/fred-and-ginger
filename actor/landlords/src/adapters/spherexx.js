// Spherexx property sites (used by LeFrak: kingsqueensapts.com, lefrakcity.com, gatewayny.com).
// The availability page loads its unit list from POST /ajax/getunitlist.asp, which returns
// HTML rows (div.unit-list-item) whose aria-label carries everything:
//   "Residence 10D in Canada on 97-20 57th Avenue, 3 Bedrooms 2 Bathrooms, 1,280 square feet, $3,600, Available Now"
// data-base-price is the rent; data-total-price adds mandatory monthly fees (kept in raw).
//
// cfg.sites: [{ url, borough?, neighbourhood?, noFee? }]  (url = site origin)
import { cheerio, makeRow, num, int, date, clean, absUrl } from '../lib.js';

const LABEL = /^(.*?) in (.*?) on (.*?), (Studio|[\d.]+ Bedrooms?)\s+([\d.]+) Bathrooms?,\s*([\d,]+) square feet,\s*\$([\d,]+),\s*(.*)$/i;
// The URL path (/queens/, /brooklyn/) follows the site section, not the building, so borough
// comes from the neighbourhood name.
const HOOD_BOROUGH = {
    Queens: ['rego park', 'forest hills', 'kew gardens', 'richmond hill', 'sunnyside', 'astoria', 'long island city', 'lic', 'corona', 'elmhurst', 'flushing', 'jackson heights', 'woodside', 'jamaica', 'briarwood', 'fresh meadows', 'bayside'],
    Brooklyn: ['clinton hill', 'fort greene', 'park slope', 'sunset park', 'kensington', 'midwood', 'sheepshead bay', 'flatbush', 'bay ridge', 'downtown brooklyn', 'williamsburg', 'greenpoint', 'crown heights', 'prospect heights', 'brooklyn heights', 'bushwick', 'bed-stuy', 'bedford-stuyvesant', 'ditmas park', 'boerum hill', 'cobble hill', 'gowanus', 'dumbo'],
    Manhattan: ['battery park city', 'murray hill', 'financial district', 'tribeca', 'chelsea', 'midtown', 'harlem', 'upper east side', 'upper west side'],
};
const boroughOf = (hood) => Object.keys(HOOD_BOROUGH).find((b) => HOOD_BOROUGH[b].includes(String(hood ?? '').toLowerCase())) ?? null;

export default async function spherexx(cfg, { http, log }) {
    const rows = [];
    for (const site of cfg.sites ?? []) {
        const origin = new URL(site.url).origin;
        const body = new URLSearchParams({
            bedrooms: '', priceMin: '0', isDefaultMinPrice: 'true', priceMax: '100000', isDefaultMaxPrice: 'true',
            buildings: '', moveInDate: '', availableNowOnly: '0', page: '1', lastNum: '', sort: '', numberPerPage: String(site.perPage ?? 500),
        });
        let html;
        try {
            html = await http.text(`${origin}/ajax/getunitlist.asp`, {
                method: 'POST', body,
                headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-requested-with': 'XMLHttpRequest', referer: site.url },
            });
        } catch (e) {
            log.warning?.(`spherexx ${origin}: ${e.message}`);
            continue;
        }
        const $ = cheerio.load(html);
        $('div.unit-list-item').each((_, el) => {
            const item = $(el);
            const btn = item.find('button[aria-label]').first();
            const label = (btn.attr('aria-label') ?? '').replace(/[ \t\n]+,/g, ',').trim();   // keep 'in  on' (empty building)
            const m = label.match(LABEL);
            if (!m) { log.debug?.(`spherexx: unparsed label ${label}`); return; }
            const [, unitName, building, street, bedTxt, bathTxt, sqftTxt, priceTxt, availTxt] = m;
            const path = item.attr('data-url') ?? btn.attr('data-link');
            // KingsQueens shows "Brussels 2S | Rego Park": the neighbourhood is the class-less span after the "|".
            const hood = item.find('.col--01 .hidden--mobile > span:not([class])').map((_, x) => clean($(x).text())).get().filter((t) => t && t !== '|')[0] ?? null;
            const neighbourhood = site.neighbourhood ?? hood;
            const base = num(item.attr('data-base-price'));
            rows.push(makeRow(cfg, {
                sourceId: `${new URL(origin).hostname.replace(/^www\./, '')}:${item.attr('data-uid')}`,
                url: absUrl(path, origin),
                street,
                unit: unitName.replace(/^residence\s+/i, ''),
                neighbourhood,
                borough: site.borough ?? boroughOf(neighbourhood),
                zip: site.zip ?? null,
                price: base || num(priceTxt),
                beds: /studio/i.test(bedTxt) ? 0 : num(bedTxt),
                baths: num(bathTxt),
                sqft: int(sqftTxt),
                noFee: site.noFee ?? cfg.noFee ?? null,
                available: date(availTxt.replace(/^available\s*/i, '') || null) ?? (/now/i.test(availTxt) ? date('now') : null),
                photos: [],
                raw: {
                    building: clean(building) || clean(btn.attr('data-building-name')),
                    totalMonthly: num(item.attr('data-total-price')),
                    promo: clean(item.find('.nep-pricing').first().text()),
                    floorplan: item.find('a[aria-label="Floor plan PDF"]').attr('href') ?? null,
                    site: origin,
                },
            }));
        });
    }
    return rows;
}
