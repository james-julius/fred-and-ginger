// Yardi RentCafe online-leasing pages (<site>.securecafe.com/onlineleasing/<prop>/floorplans.aspx).
// securecafe.com sits behind a Cloudflare managed challenge, so this needs the browser.
// The page's `window.pageData.floorplans[]` has beds, baths, sqft, lowPrice/highPrice,
// availableCount and `unitList` (unit numbers). Prices are per floor plan ("starting
// at"), so each listed unit gets its floor plan's low price; when a plan reports
// available units but no unit numbers, one row per floor plan is emitted.
//
// cfg (as a platform): { browser: true, properties: [{ name, url, street, zip, neighbourhood?, lat?, lon? }] }
import { makeRow, date } from '../lib.js';

export const BROWSER_BLOCK = /googletagmanager|google-analytics|doubleclick|facebook|hotjar|clarity|wistia|youtube|vimeo|onetrust|cookielaw|maps\.google|maps\.googleapis|matterport|tiktok|bing\.com|linkedin|pinterest|twitter|bat\.bing|adsrvr|quantserve|nr-data|newrelic|\.css(\?|$)|fonts\.|typekit|cdn\.userway|userway\.org|livechat|meetelise|tour24|rentgrata|zillow|onetrust/;

export function floorplansUrl(leaseUrl) {
    const m = String(leaseUrl).match(/^(https:\/\/[a-z0-9-]+\.securecafe\.com\/onlineleasing\/[^/?#]+)/i);
    return m ? `${m[1]}/floorplans.aspx` : null;
}

export async function securecafeRows(cfg, browser, p) {
    const url = p.floorplansUrl ?? floorplansUrl(p.url);
    if (!url) throw new Error(`not a securecafe url: ${p.url}`);
    const res = await browser.page(url, {
        html: false,
        settleMs: 500,
        block: BROWSER_BLOCK,
        waitFor: (page) => page.waitForFunction(() => window.pageData && Array.isArray(window.pageData.floorplans), null, { timeout: 20000 }),
        evaluate: (page) => page.evaluate(() => JSON.parse(JSON.stringify({
            propertyID: window.pageData?.propertyID ?? null,
            floorplans: (window.pageData?.floorplans ?? []).map((f) => ({
                id: f.id, name: f.name, beds: f.beds, baths: f.baths, sqft: f.sqft, lowPrice: f.lowPrice, highPrice: f.highPrice,
                availableCount: f.availableCount, availableDate: f.availableDate, unitList: f.unitList, image: f.images?.[0]?.src ?? null,
            })),
        }))),
    });
    const pd = res.value ?? {};
    const page = res.url || url;
    const rows = [];
    for (const f of pd.floorplans ?? []) {
        if (!(f.availableCount > 0) || !(f.lowPrice > 0)) continue;
        const units = (f.unitList ?? []).filter(Boolean);
        const base = {
            url: page.replace(/\?.*$/, ''),
            street: p.street, zip: p.zip, neighbourhood: p.neighbourhood ?? null, lat: p.lat ?? null, lon: p.lon ?? null,
            price: f.lowPrice,
            beds: f.beds, baths: f.baths, sqft: f.sqft,
            available: f.availableDate ? date(f.availableDate) : date('now'),
            photos: [f.image ? new URL(f.image, 'https://cdngeneralcf.rentcafe.com').toString() : null],
        };
        const raw = { building: p.name, floorPlan: f.name, floorPlanId: f.id, priceIsFloorPlanMin: true, highPrice: f.highPrice, availableCount: f.availableCount, rentcafePropertyId: pd.propertyID };
        if (units.length) for (const u of units) rows.push(makeRow(cfg, { ...base, sourceId: `rc-${pd.propertyID}-${u}`, unit: u, raw }));
        else rows.push(makeRow(cfg, { ...base, sourceId: `rc-${pd.propertyID}-fp${f.id}`, unit: null, raw: { ...raw, floorPlanLevel: true } }));
    }
    return rows;
}

export default async function securecafe(cfg, { browser, log }) {
    if (!browser) throw new Error('securecafe needs browser: true');
    const rows = [];
    for (const p of cfg.properties ?? []) {
        try {
            const r = await securecafeRows(cfg, browser, p);
            log.info(`securecafe ${p.name}: ${r.length} rows`);
            rows.push(...r);
        } catch (e) {
            log.warning(`securecafe ${p.name}: ${e.message}`);
        }
    }
    return rows;
}
