// Yardi RentCafe property websites (the "Powered by RentCafe" CMS). Every such site
// serves /availableunits: all available apartments grouped by floor plan, one table
// row per unit (apartment #, rent, date). Sqft comes from each row's applyGAClick()
// args; street/zip from the page's schema.org ApartmentComplex block.
// The sites sit behind Cloudflare, so this is a browser path (browser: true):
// one page per building, junk blocked.
//
// cfg: { browser: true, sites: [{ url: 'https://www.liveatsky.com', name?, neighbourhood?, borough?, noFee? }],
//        discover?: 'https://www.dalanrentals.com/searchlisting' }
// `discover` = a RentCafe company search page: its property cards (name, link,
// address) are read first (one extra page) and every NYC property is added to `sites`.
import { makeRow, clean, int, num, date, cheerio, boroughFromZip } from '../lib.js';

// only the site's own documents and Cloudflare's /cdn-cgi/ check scripts; unit data is server-rendered
const sameSite = (u) => new RegExp(`^https?://${new URL(u).hostname.replace(/\./g, '\\.')}/(?!.*\\.(css|js|png|jpe?g|svg|gif|webp)(\\?|$))|/cdn-cgi/`, 'i');
const BLOCK = /matterport|mux\.com|\.m3u8|youtube|vimeo|googletagmanager|google-analytics|facebook|doubleclick|t\.rentcafe\.com\/rct|cookielaw|onetrust|hotjar|clarity|tiktok|bing\.com|linkedin|pinterest|recaptcha|maps\.googleapis|cloudflareinsights|cdn-cgi\/rum|nudge|livechat|conversations|userway|accessibe|acsbapp/i;

// applyGAClick('1 Bedroom 1 Bathroom', '1 Bed(s)', '566', '5667.00', '5667.00', '62E')
function gaArgs(onclick) {
    const m = onclick?.match(/applyGAClick\((.*)\)/s);
    if (!m) return [];
    return [...m[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((x) => x[1]);
}

export function parseAvailableUnits(cfg, site, html, pageUrl) {
    const $ = cheerio.load(html);
    let addr = {};
    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const d = JSON.parse($(el).text());
            const a = d.address ?? (Array.isArray(d['@graph']) ? d['@graph'].find((x) => x.address)?.address : null);
            if (a?.streetAddress && !addr.street) addr = { street: a.streetAddress, zip: a.postalCode, city: a.addressLocality, name: d.name, lat: d.geo?.latitude, lon: d.geo?.longitude };
        } catch { /* ignore */ }
    });
    const rows = [];
    $('.floorplan-section').each((_, sec) => {
        const s = $(sec);
        const plan = s.attr('data-name') ?? clean(s.find('h2').first().text());
        const spans = s.find('h2').first().next('div').find('span').map((__, x) => clean($(x).text())).get();
        const bedText = spans.find((x) => /bed|studio/i.test(x)) ?? plan;
        const bathText = spans.find((x) => /bath/i.test(x)) ?? plan;
        s.find('tr.unit-container').each((__, tr) => {
            const r = $(tr);
            const id = r.attr('id')?.replace('unit-container-', '');
            const nameCell = r.find('.td-card-name').clone();
            nameCell.find('p, a').remove();
            const ga = gaArgs(r.find('[onclick*="applyGAClick"]').attr('onclick'));
            const unit = clean(ga[5]) ?? clean(nameCell.text())?.replace(/^#/, '').split(' ')[0];
            const availCell = r.find('.td-card-available').clone();
            availCell.find('p').remove();
            const availText = clean(availCell.text());
            const rentCell = r.find('.td-card-rent').clone();
            rentCell.find('p').remove();
            const price = int(rentCell.text());
            if (!price) return;
            rows.push(makeRow({ ...cfg, noFee: site.noFee ?? cfg.noFee }, {
                sourceId: `${new URL(pageUrl).hostname.replace(/^www\./, '')}-${id ?? unit}`,
                url: pageUrl,
                street: site.street ?? addr.street,
                unit,
                neighbourhood: site.neighbourhood ?? null,
                zip: site.zip ?? addr.zip,
                city: addr.city,
                borough: site.borough ?? boroughFromZip(site.zip ?? addr.zip) ?? null,
                lat: site.lat ?? addr.lat, lon: site.lon ?? addr.lon,
                price,
                beds: /studio/i.test(bedText ?? '') ? 0 : num(bedText),
                baths: num(String(bathText ?? '').match(/(\d+(\.\d+)?)\s*bath/i)?.[1]),
                sqft: int(ga[2]),
                available: /^available$|now/i.test(availText ?? '') ? date('now') : date(availText),
                photos: [],
                raw: { building: site.name ?? addr.name, floorPlan: plan, floorPlanId: s.attr('data-id'), unitId: id, availableText: availText },
            }));
        });
    });
    return rows;
}

async function discoverSites(browser, url, log) {
    const res = await browser.page(url, { block: BLOCK, waitFor: 'li.property-box', settleMs: 500 });
    const $ = cheerio.load(res.html);
    const sites = [];
    $('li.property-box').each((_, el) => {
        const c = $(el);
        const href = c.find('.property-name a').first().attr('href')?.split('?')[0];
        const address = clean(c.find('.card-prop-address').first().text());
        const zip = address?.match(/\bNY,?\s*(\d{5})/)?.[1];
        if (!href || !zip || !boroughFromZip(zip)) return;
        const name = clean(c.find('.property-name a').first().text().replace(/opens in a new tab/i, ''));
        sites.push({ name, url: href.replace(/\/default\.aspx$/i, '').replace(/\/$/, ''), street: address.split(',')[0].trim(), zip });
    });
    log.info(`rentcafe discover ${url}: ${sites.length} NYC properties`);
    return sites;
}

export default async function rentcafe(cfg, { browser, log }) {
    if (!browser) throw new Error('rentcafe needs browser: true');
    const rows = [];
    const sites = [...(cfg.sites ?? [])];
    if (cfg.discover) {
        for (const s of await discoverSites(browser, cfg.discover, log)) {
            if (!sites.some((x) => x.url.replace(/\/$/, '') === s.url)) sites.push(s);
        }
    }
    for (const site of sites) {
        const url = site.availableUrl ?? `${site.url.replace(/\/$/, '')}/availableunits`;
        try {
            const res = await browser.page(url, { block: BLOCK, allowOnly: sameSite(url), waitFor: '#available-units-container', settleMs: 500 });
            const r = parseAvailableUnits(cfg, site, res.html, res.url);
            log.info(`rentcafe ${site.name ?? url}: ${r.length} units`);
            rows.push(...r);
        } catch (e) {
            log.warning(`rentcafe ${site.name ?? url}: ${e.message}`);
        }
    }
    return rows;
}
