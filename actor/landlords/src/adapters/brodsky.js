// The Brodsky Organization (brodsky.com): Next.js app router. /rentals server-renders the
// full dataset into the RSC flight data (self.__next_f) as "initialApartments":[...]
// (fullDatasetFromServer: true). Buildings whose name isn't a street address get one
// fetch of their building page for the schema.org streetAddress.
// cfg: { base: 'https://www.brodsky.com' }
import { makeRow, date, absUrl } from '../lib.js';

function flight(html) {
    let out = '';
    for (const m of html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)) {
        try { const a = JSON.parse(m[1]); if (typeof a[1] === 'string') out += a[1]; } catch { /* skip */ }
    }
    return out;
}

function arrayAfter(s, key) {
    const i = s.indexOf(key);
    if (i < 0) return null;
    return new JSONDecoder(s, i + key.length).value();
}

// minimal raw_decode: parse the JSON value starting at `from`
class JSONDecoder {
    constructor(s, from) { this.s = s; this.from = from; }
    value() {
        const s = this.s; let depth = 0, inStr = false, esc = false;
        for (let i = this.from; i < s.length; i++) {
            const c = s[i];
            if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
            if (c === '"') inStr = true;
            else if (c === '[' || c === '{') depth++;
            else if ((c === ']' || c === '}') && --depth === 0) return JSON.parse(s.slice(this.from, i + 1));
        }
        return null;
    }
}

// "$23:props:children:props:field" -> the image url inside RSC row 23
function photo(fl, ref) {
    if (ref && typeof ref === 'object') return ref.url ?? null;
    const id = String(ref ?? '').match(/^\$([0-9a-f]+):/)?.[1];
    if (!id) return null;
    const i = fl.indexOf(`\n${id}:`);
    if (i < 0) return null;
    return fl.slice(i, i + 3000).match(/"url":"(https:[^"]+)"/)?.[1] ?? null;
}

const looksLikeStreet = (s) => /^\d+[\w-]*\s+(\w+\s+)*?(street|st|avenue|ave|place|pl|road|rd|boulevard|blvd|drive|dr|lane|way|terrace|broadway|bowery)\b/i.test(s ?? '')
    || /^\d+\s+(east|west|north|south|e|w)\s+\d+/i.test(s ?? '');

export default async function brodsky(cfg, { http, log }) {
    const base = cfg.base ?? 'https://www.brodsky.com';
    const html = await http.text(`${base}/rentals`);
    const fl = flight(html);
    const apts = arrayAfter(fl, '"initialApartments":');
    if (!apts) throw new Error('no initialApartments in /rentals flight data');

    const streets = {};
    for (const a of apts) {
        if (a.propertyUid in streets) continue;
        if (looksLikeStreet(a.propertyName)) { streets[a.propertyUid] = a.propertyName; continue; }
        const purl = a.url.split('/').slice(0, 4).join('/');
        try {
            const p = await http.text(absUrl(purl, base));
            streets[a.propertyUid] = p.match(/streetAddress\\?":\\?"([^"\\]+)/)?.[1] ?? null;
        } catch (e) {
            log.warning?.(`brodsky ${purl}: ${e.message}`);
            streets[a.propertyUid] = null;
        }
    }

    return apts.map((a) => {
        const gross = a.minimumRent;
        const net = a.effectiveMinRent;
        return makeRow(cfg, {
            sourceId: a.apartmentId,
            url: absUrl(a.url, base),
            street: streets[a.propertyUid] ?? a.propertyName,
            unit: a.apartmentName,
            neighbourhood: a.neighborhoodName,
            zip: a.zipCode,
            lat: a.latitude, lon: a.longitude,
            price: gross,
            netEffective: net && net < gross ? net : null,
            beds: a.beds ?? a.bedrooms,
            baths: a.baths ?? a.bathrooms,
            sqft: null,
            available: date(a.availableDate),
            photos: [photo(fl, a.thumbnail)],
            raw: { building: a.propertyName, propertyId: a.propertyId, specials: a.specials?.replace(/^\$\$/, '$') ?? null, marketingPrice: a.marketingPrice, maximumRent: a.maximumRent },
        });
    });
}
