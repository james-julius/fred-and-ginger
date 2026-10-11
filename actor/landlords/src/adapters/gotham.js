// Gotham Organization. Leasing lives on one site per building (linked from
// gothamproperties.com/our-properties). Two shapes:
//
// 1. "feed" sites (AIRE, The Maybury, The Ashland, The Nicole, The Suffolk, Atlas,
//    Gotham West): a WordPress endpoint /wp-json/component/units/ returns the
//    building's Salesforce/Nestio-style listing feed { items: [...] } with unit,
//    beds, baths, price, incentives, lease terms, building address + lat/lon.
//    Some of these sites sit behind Cloudflare; for those (`browser: true` on the
//    site) the JSON URL itself is opened in the browser with every other request
//    blocked, so a run costs a few hundred KB of residential proxy, not page loads.
// 2. Gotham Point (LIC): server-rendered unit table on /availability/.
//
// Advertised prices are net effective ("Rents reflect net effective pricing"):
// the feed gives the net figure with decimals plus "N Months free" and the lease
// term. When net x term / (term - free) comes back to a whole multiple of $5 the
// gross is recovered and used as `price`, with the advertised figure as
// `netEffective`; otherwise `price` is the advertised net figure and
// raw.priceIsNetEffective is true.
import { makeRow, date, num, int, clean } from '../lib.js';

const BLOCK_ALL_BUT = (url) => {
    const keep = url.split('?')[0];
    return new RegExp(`^(?!(${keep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|https://[^/]+/cdn-cgi/|https://challenges\\.cloudflare\\.com/))`);
};

function grossFromNet(net, it) {
    const free = num(it.incentives?.match(/([\d.]+)\s*months?\s*free/i)?.[1]);
    if (!free) return null;
    const terms = [num(it.min_lease_term), num(it.max_lease_term), 18, 12, 24, 16, 15, 13, 14].filter((t) => t && t > free);
    for (const t of [...new Set(terms)]) {
        const g = (net * t) / (t - free);
        if (Math.abs(g / 5 - Math.round(g / 5)) * 5 < 0.05) return Math.round(g);
    }
    return null;
}

function feedRows(cfg, site, items) {
    const rows = [];
    for (const it of items) {
        if (it.listing_type && !/rent/i.test(it.listing_type)) continue;
        if (it.property_type && it.property_type !== 'Residential') continue;
        if (it.status && !/^available/i.test(it.status)) continue; // drop Offer Pending / In Contract
        const b = it.building ?? {};
        const net = num(it.price);
        if (!net) continue;
        const gross = grossFromNet(net, it);
        const noFee = /no fee/i.test(it.renter_fee ?? '') || /owner pays/i.test(it.fee_structure ?? '') ? true : null;
        rows.push(makeRow(cfg, {
            sourceId: `${new URL(site.url).hostname.replace(/^www\./, '')}-${it.id ?? it.unit_number}`,
            url: site.page ?? new URL('/availability/', site.url).toString(),
            street: b.street_address ?? it.street_address,
            unit: it.unit_number,
            neighbourhood: b.neighborhood?.area ?? null,
            zip: b.postal_code,
            city: b.city,
            lat: b.location?.latitude,
            lon: b.location?.longitude,
            price: gross ?? net,
            netEffective: gross ? net : null,
            beds: it.bedrooms,
            baths: it.bathrooms,
            sqft: int(it.square_footage),
            noFee,
            available: date(it.date_available),
            photos: (it.photos ?? []).map((p) => p.xlarge || p.large || p.preview).filter(Boolean),
            listedAt: it.last_listed_at ? `${it.last_listed_at}T00:00:00.000Z` : null,
            raw: {
                building: b.name ?? site.name ?? null, status: it.status, layout: it.layout, floor: it.floor,
                advertisedPrice: net, priceIsNetEffective: !gross, incentives: it.incentives || null,
                leaseTerm: [it.min_lease_term, it.max_lease_term], exposures: it.exposures ?? null,
            },
        }));
    }
    return rows;
}

async function feedSite(cfg, site, { http, browser }) {
    const api = new URL('/wp-json/component/units/', site.url).toString();
    let payload;
    if (site.browser) {
        if (!browser) throw new Error(`${site.url} needs the browser (set browser: true on the company)`);
        const res = await browser.page(api, { block: BLOCK_ALL_BUT(api), capture: /\/wp-json\/component\/units\//, settleMs: 200 });
        const body = res.captured.find((c) => c.status === 200)?.body
            ?? res.html?.match(/<pre[^>]*>([\s\S]*?)<\/pre>/)?.[1];
        payload = JSON.parse(body);
    } else {
        payload = await http.json(api);
    }
    const items = payload?.items ?? [];
    if ((payload?.total_pages ?? 1) > 1) {
        for (let p = 2; p <= payload.total_pages && !site.browser; p++) {
            items.push(...((await http.json(`${api}?page=${p}`)).items ?? []));
        }
    }
    return feedRows(cfg, site, items);
}

// Gotham Point: <div class="unit res_1bedroom tower_south"> rows on /availability/
async function gothamPoint(cfg, site, { http }) {
    const $ = await http.html(site.url);
    const rows = [];
    $('.unit_lists .unit').each((_, el) => {
        const u = $(el);
        const unit = clean(u.find('.utitlt.first').text())?.replace(/^residence\s*/i, '');
        const layout = clean(u.find('.utitlt_layout').text()) ?? '';
        const [bedPart, bathPart] = layout.split('/');
        const price = int(u.find('.utitlt_price').text());
        if (!unit || !price) return;
        const tower = clean(u.find('.utitlt_tower').text());
        rows.push(makeRow(cfg, {
            sourceId: `gothampoint-${tower ?? ''}-${unit}`,
            url: site.url,
            street: site.street,
            unit,
            neighbourhood: site.neighbourhood,
            zip: site.zip,
            price,
            beds: /studio/i.test(bedPart) ? 0 : num(bedPart),
            baths: num(bathPart),
            photos: [u.find('a.a_fp_link').attr('href')],
            raw: { building: site.name, tower, layout, priceIsNetEffective: true, note: 'Advertised rents are net effective' },
        }));
    });
    return rows;
}

export default async function gotham(cfg, ctx) {
    const rows = [];
    for (const site of cfg.sites ?? []) {
        try {
            const r = site.layout === 'gothampoint' ? await gothamPoint(cfg, site, ctx) : await feedSite(cfg, site, ctx);
            ctx.log.info(`gotham ${site.name}: ${r.length} units`);
            rows.push(...r);
        } catch (e) {
            ctx.log.warning(`gotham ${site.name}: ${e.message}`);
        }
    }
    return rows.slice(0, ctx.limit);
}
