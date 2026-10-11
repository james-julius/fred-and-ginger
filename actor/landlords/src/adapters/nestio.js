// Nestio (Funnel) listing feeds. Two Trees' site proxies its Nestio account at
// https://www.twotreesny.com/api/nestio -> { data: { <id>: { label: 'residential', data: '<json string>' } } }
// where the inner JSON is the Nestio listings payload { total_items, items: [...] }.
// Items carry building {street_address, postal_code, neighborhood, location}, unit_number,
// bedrooms, bathrooms, price, is_net_effective_price, renter_fee ("No Fee"), date_available, photos.
//
// cfg: { feedUrl, siteUrl, urlStyle?: 'twotrees' }
import { makeRow, num, int, date, absUrl } from '../lib.js';

function itemsOf(payload) {
    if (Array.isArray(payload?.items)) return payload.items;
    const out = [];
    for (const block of Object.values(payload?.data ?? {})) {
        if (block?.label && block.label !== 'residential') continue;
        const inner = typeof block?.data === 'string' ? JSON.parse(block.data) : block?.data;
        out.push(...(inner?.items ?? []));
    }
    return out;
}

// Mirrors the Two Trees React route: /apartments/<street minus "street">/<layout>/<unit>
function twoTreesUrl(siteUrl, it) {
    const street = (it.building?.street_address ?? '').toLowerCase().replace('street', '').trim().replace(/ /g, '-');
    const layout = (it.layout ?? '').toLowerCase().replace(/ /g, '-').replace(/w\//g, 'with');
    return absUrl(`/apartments/${street}/${layout}/${it.unit_number}`, siteUrl);
}

export default async function nestio(cfg, { http }) {
    const payload = await http.json(cfg.feedUrl);
    const rows = [];
    for (const it of itemsOf(payload)) {
        if (it.property_type && it.property_type !== 'Residential') continue;
        if (it.listing_type && it.listing_type !== 'For Rent') continue;
        // `private` is set on about half of Two Trees' units, but their site lists them all.
        const b = it.building ?? {};
        const price = num(it.price);
        const noFee = /no fee/i.test(it.renter_fee ?? '') || /owner pays/i.test(it.fee_structure ?? '') ? true : (cfg.noFee ?? null);
        rows.push(makeRow(cfg, {
            sourceId: it.id,
            url: cfg.urlStyle === 'twotrees' ? twoTreesUrl(cfg.siteUrl, it) : (cfg.siteUrl ?? null),
            street: b.street_address ?? it.street_address,
            unit: it.unit_number,
            neighbourhood: b.neighborhood?.name ?? null,
            zip: b.postal_code,
            city: b.city,
            lat: b.location?.latitude,
            lon: b.location?.longitude,
            // An asterisked net-effective price is all the feed gives; no gross alongside it.
            price,
            beds: it.bedrooms,
            baths: it.bathrooms,
            sqft: int(it.square_footage),
            noFee,
            available: date(it.date_available),
            photos: (it.photos ?? []).map((p) => p.xlarge ?? p.large ?? p.original),
            listedAt: it.last_listed_at ?? null,
            raw: {
                building: b.name ?? null, status: it.status, private: it.private, layout: it.layout, floor: it.floor,
                priceIsNetEffective: !!it.is_net_effective_price, incentives: it.incentives || null,
                renterFee: it.renter_fee, feeStructure: it.fee_structure, description: it.description,
            },
        }));
    }
    return rows;
}
