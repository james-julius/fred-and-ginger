// AvalonBay (avaloncommunities.com). The region search page server-renders every
// available unit in the region into `Fusion.globalContent` (Arc XP), with community
// coordinates alongside, so one request per region covers the portfolio.
// cfg: { regions: ['/new-york/new-york-city-apartments/'] }
import { makeRow, inNyc, date } from '../lib.js';

const BASE = 'https://www.avaloncommunities.com';

function globalContent(html) {
    const at = html.indexOf('Fusion.globalContent=');
    if (at < 0) throw new Error('no Fusion.globalContent');
    const s = html.slice(at + 'Fusion.globalContent='.length);
    // string-aware brace matching
    let depth = 0, inStr = false, esc = false;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
        if (c === '"') inStr = true;
        else if (c === '{') depth++;
        else if (c === '}' && --depth === 0) return JSON.parse(s.slice(0, i + 1));
    }
    throw new Error('unterminated globalContent');
}

export default async function avalon(cfg, { http, log }) {
    const rows = [];
    for (const region of cfg.regions ?? ['/new-york/new-york-city-apartments/']) {
        const gc = globalContent(await http.text(new URL(region, BASE).toString()));
        const communities = new Map((gc.communityResults?.communities?.items ?? []).map((c) => [c.communityId, c]));
        const units = gc.unitResults?.items ?? [];
        log.info(`avalon ${region}: ${units.length} units in ${communities.size} communities`);
        for (const u of units) {
            const c = communities.get(u.communityId) ?? {};
            const a = u.address ?? c.address ?? {};
            const lat = c.coordinates?.latitude, lon = c.coordinates?.longitude;
            if (!inNyc({ zip: a.zip, lat, lon })) continue;
            const furnishedOnly = !u.startingAtPricesUnfurnished && u.startingAtPricesFurnished;
            const p = (u.startingAtPricesUnfurnished ?? u.startingAtPricesFurnished)?.prices ?? {};
            const communityUrl = c.url && !/^https?:/.test(c.url) ? c.url : null;
            rows.push(makeRow(cfg, {
                sourceId: u.unitId,
                url: communityUrl ? `${BASE}${communityUrl}/apartment/${u.propertyId.replace(/^AVB-/, '')}-${u.unitId.replace(/^AVB-/, '')}` : `${BASE}${region}`,
                street: (a.addressLine1 ?? '').replace(/\s*(#|\b(apartment|apt\.?|unit)\s).*$/i, ''),
                unit: u.unitName,
                city: a.city,
                zip: a.zip,
                lat, lon,
                price: u.useTotalPrice ? p.totalPrice : p.price,
                netEffective: p.netEffectivePrice,
                beds: u.bedroomNumber,
                baths: u.bathroomNumber,
                sqft: u.squareFeet,
                available: date(u.availableDateUnfurnished ?? u.availableDateFurnished),
                photos: u.floorPlan?.highResolution ? [`https://resource.avalonbay.com/${u.floorPlan.highResolution.replace(/^\//, '')}`] : [],
                raw: {
                    building: u.communityName, communityId: u.communityId, floor: u.floorNumber, floorPlan: u.floorPlan?.name,
                    status: u.unitStatus, totalPrice: p.totalPrice, leaseTerm: (u.startingAtPricesUnfurnished ?? u.startingAtPricesFurnished)?.leaseTerm,
                    furnishedOnly: !!furnishedOnly, promotions: (u.promotions ?? []).map((x) => x.promotionTitle),
                },
            }));
        }
    }
    return rows;
}
