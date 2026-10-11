// Bozzuto: building sites built on one WordPress template. Two kinds of property:
//  - SightMap buildings (`embed` id or a page `url` to find it on): plain HTTP to
//    sightmap.com, unit-level rows (delegates to ./sightmap.js).
//  - RentCafe-backed buildings whose sites sit behind Cloudflare (`fpPage`): one
//    browser page per building, parsing the server-rendered floor-plan cards
//    (schema.org FloorPlan): beds, baths, "From" total + base rent, sqft, date.
//    These are floor-plan rows (unit null, sourceId = RentCafe floor plan id),
//    price = lowest base rent for that plan; raw.priceIsFrom = true.
import sightmap from './sightmap.js';
import { makeRow, absUrl, clean, int, num, date, cheerio } from '../lib.js';

// third-party junk on these sites (video alone was ~80 MB a page)
const BLOCK = /mux\.com|\.m3u8|\.ts(\?|$)|hls\.js|googletagmanager|google-analytics|facebook|hy\.ly|liadm|agkn|mpio|posthog|osano|acsbapp|bugsnag|doubleclick|partytown|youtube|vimeo|maps\.googleapis|recaptcha|cloudflareinsights|cdn-cgi\/rum|rentgrata|addtoany|communityfees|userway|clarity|hotjar|tiktok|bing\.com|linkedin|pinterest/i;

function floorPlanRows(cfg, prop, html, pageUrl) {
    const $ = cheerio.load(html);
    const rows = [];
    $('.mt_fp_list_box[itemtype*="FloorPlan"]').each((_, el) => {
        const c = $(el);
        const link = c.find('a[href*="floorplanid="]').first().attr('href');
        const fpId = link?.match(/floorplanid=(\d+)/)?.[1] ?? c.find('a[href*="floorPlans="]').attr('href')?.match(/floorPlans=(\d+)/)?.[1];
        if (!fpId) return;
        const bedText = clean(c.find('[itemprop="numberOfBedrooms"]').text());
        const detail = (label) => c.find('.mt_fp_details').filter((__, d) => clean($(d).find('label').text())?.toLowerCase() === label);
        const base = int(c.find('.base-rent').text());
        const total = int(c.find('.data-price').first().text());
        const avail = clean(detail('available').find('span').text());
        rows.push(makeRow(cfg, {
            sourceId: `${prop.name}-fp-${fpId}`,
            url: absUrl(link, pageUrl) ?? pageUrl,
            street: prop.street,
            unit: null,
            neighbourhood: prop.neighbourhood,
            zip: prop.zip,
            lat: prop.lat, lon: prop.lon,
            price: base ?? total,
            beds: /studio/i.test(bedText ?? '') ? 0 : num(bedText),
            baths: num(c.find('[itemprop="numberOfBathroomsTotal"]').text()),
            sqft: int(detail('sq. ft.').find('span').text()),
            available: avail ? date(avail.replace(/\./g, '/')) : null,
            photos: [c.find('.mt_fp_plan_img img').attr('src')],
            raw: { building: prop.name, floorPlan: clean(c.find('[itemprop="name"]').text()), floorPlanId: fpId, totalMonthly: total, priceIsFrom: true },
        }));
    });
    return rows;
}

export default async function bozzuto(cfg, ctx) {
    const { log, browser } = ctx;
    const rows = [];
    const smProps = (cfg.properties ?? []).filter((p) => !p.fpPage);
    if (smProps.length) rows.push(...await sightmap({ ...cfg, properties: smProps }, ctx));
    for (const prop of (cfg.properties ?? []).filter((p) => p.fpPage)) {
        if (!browser) { log.warning(`bozzuto ${prop.name}: needs browser: true`); continue; }
        try {
            const res = await browser.page(prop.fpPage, {
                block: BLOCK,
                // cards are server-rendered: only the site's own documents + Cloudflare's /cdn-cgi/ check
                allowOnly: new RegExp(`^https?://${new URL(prop.fpPage).hostname.replace(/\./g, '\\.')}/(?!.*\\.(css|js|png|jpe?g|svg|gif|webp|ts|m3u8)(\\?|$))|/cdn-cgi/`, 'i'),
                waitFor: '.mt_fp_list_box',
                settleMs: 500,
            });
            const r = floorPlanRows(cfg, prop, res.html, res.url);
            log.info(`bozzuto ${prop.name}: ${r.length} floor plans`);
            rows.push(...r);
        } catch (e) {
            log.warning(`bozzuto ${prop.name}: ${e.message}`);
        }
    }
    return rows;
}
