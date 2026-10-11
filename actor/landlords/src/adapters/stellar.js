// Stellar Management (stellarmanagement.com): Nuxt site backed by its own CMS API.
// The availabilities page embeds a public API key in window.__NUXT__.config; with it,
// GET /cmsapi/unit/search returns every available unit (paged), and /cmsapi/property/search
// gives building lat/lon. cfg: { base: 'https://www.stellarmanagement.com' }
import { makeRow, date, absUrl } from '../lib.js';

const BOROUGHS = new Set(['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island']);

export default async function stellar(cfg, { http, log, limit }) {
    const base = cfg.base ?? 'https://www.stellarmanagement.com';
    const page = await http.text(`${base}/availabilities`);
    const apiUrl = page.match(/API_URL:"([^"]+)"/)?.[1] ?? `${base}/cmsapi`;
    const key = page.match(/API_KEY:"([^"]+)"/)?.[1];
    if (!key) throw new Error('no API key on availabilities page');
    const headers = { 'X-API-KEY': key };

    const geo = {};
    try {
        for (let p = 1; p <= 10; p++) {
            const d = await http.json(`${apiUrl}/property/search?pageNo=${p}&pageSize=50`, { headers });
            for (const b of d.items ?? []) geo[b.propertyID] = b;
            if (p * 50 >= (d.totalProperties ?? 0)) break;
        }
    } catch (e) { log.warning?.(`stellar property/search: ${e.message}`); }

    const units = [];
    for (let p = 1; p <= 20; p++) {
        const d = await http.json(`${apiUrl}/unit/search?pageNo=${p}&pageSize=100&sort=priceAsc`, { headers });
        units.push(...(d.items ?? []));
        if (!d.items?.length || units.length >= (d.totalUnits ?? 0) || units.length >= limit) break;
    }

    return units
        .filter((u) => BOROUGHS.has(u.mainNeighborhoodName))
        .map((u) => {
            const b = geo[u.propertyID] ?? {};
            const rent = u.unitRent ?? u.marketRent;
            return makeRow(cfg, {
                sourceId: u.unitID,
                url: absUrl(u.propertyPageUrl, base),
                street: u.address || u.fullAddress,
                unit: u.unitType,
                neighbourhood: u.subNeighborhoodName,
                borough: u.mainNeighborhoodName,
                lat: b.lati, lon: b.longi,
                price: rent,
                netEffective: u.isNetPrice || (u.netRent && u.netRent < rent) ? u.netRent : null,
                beds: u.beds,
                baths: u.baths,
                sqft: u.minimumSQFT,
                available: u.availableNow ? date('now') : date(u.availabilityDate),
                photos: u.imageUrls ?? (u.imageUrl ? [u.imageUrl] : []),
                raw: {
                    building: u.marketingName || u.name, propertyId: u.propertyID, unitMngmID: u.unitMngmID,
                    hasSpecialOffer: u.hasSpecialOffer, concessionFreeMonths: u.concessionFreeMonths || null,
                    concessionTermMonths: u.concessionTermMonths || null, offerTerm: u.offerTerm || null,
                    applyUrl: u.applyUrl, floorPlan: u.floorPlanFileUrl, virtualTour: u.virtualTourUrl,
                },
            });
        });
}
