// Durst Organization building sites (via57west.com, eosnomad.com, svenlic.com, ...).
// Each is a Nuxt app whose /availabilities/_payload.json carries the full unit list
// (devalue-encoded). Two item shapes exist:
//   - Nestio listings (VIA, Helena, Frank, EOS, Sven): unit_number, price, bedrooms, building{...}
//   - MRI/Funnel availabilities (Halletts Point): suite, rental_price, availability_address
// cfg: { sites: ['https://www.via57west.com', ...] }
import { makeRow, inNyc, date, splitAddress, num } from '../lib.js';

// Nuxt devalue payload -> plain JS
function devalue(arr) {
    const memo = new Map();
    const h = (i) => {
        if (typeof i !== 'number' || i < 0) return undefined;
        if (memo.has(i)) return memo.get(i);
        const v = arr[i];
        let out;
        if (Array.isArray(v)) {
            if (typeof v[0] === 'string' && ['ShallowReactive', 'Reactive', 'Ref', 'ShallowRef', 'EmptyRef', 'EmptyShallowRef'].includes(v[0])) out = h(v[1]);
            else if (v[0] === 'Set') out = v.slice(1).map(h);
            else if (v[0] === 'Map') out = Object.fromEntries(v.slice(1).reduce((a, x, j) => (j % 2 ? a[a.length - 1].push(h(x)) : a.push([h(x)]), a), []));
            else if (v[0] === 'Date') out = v[1];
            else { out = []; memo.set(i, out); v.forEach((x) => out.push(h(x))); return out; }
        } else if (v && typeof v === 'object') {
            out = {}; memo.set(i, out);
            for (const [k, x] of Object.entries(v)) out[k] = h(x);
            return out;
        } else out = v;
        memo.set(i, out);
        return out;
    };
    return h(0);
}

const slugify = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const saysNoFee = (...xs) => xs.some((x) => /\bno[ -]?(broker(age)?\s*)?fee\b/i.test(String(x ?? '')));

export default async function durst(cfg, { http, log }) {
    const rows = [];
    for (const site of cfg.sites ?? []) {
        const base = site.replace(/\/$/, '');
        let data;
        try {
            data = devalue(JSON.parse(await http.text(`${base}/availabilities/_payload.json`, { json: true })))?.data ?? {};
        } catch (e) {
            log.warning(`durst ${base}: ${e.message}`);
            continue;
        }
        const items = Object.values(data).flatMap((v) => (Array.isArray(v) ? v : v?.items ?? []));
        log.info(`durst ${base}: ${items.length} units`);
        for (const u of items) {
            if (!u || u.hidden || u.private) continue;
            if (u.unit_number != null || u.building) {
                // Nestio listing
                const b = u.building ?? {};
                const lat = b.location?.latitude, lon = b.location?.longitude;
                if (!inNyc({ zip: b.postal_code, lat, lon })) continue;
                if (u.status && !/available/i.test(u.status)) continue;
                rows.push(makeRow(cfg, {
                    sourceId: `nestio-${u.id}`,
                    url: `${base}/residences/${slugify(u.layout || `${u.bedrooms}-bedroom`)}/${u.id}/`,
                    street: u.street_address ?? b.street_address,
                    unit: u.unit_number,
                    neighbourhood: b.neighborhood?.name,
                    city: b.city,
                    zip: b.postal_code,
                    lat, lon,
                    price: num(u.price),
                    beds: u.bedrooms,
                    baths: u.bathrooms,
                    sqft: u.square_footage,
                    noFee: saysNoFee(u.renter_fee, u.description) ? true : null,
                    available: date(u.date_available),
                    photos: (u.photos ?? []).map((p) => p.large ?? p.original),
                    listedAt: u.last_listed_at ?? null,
                    raw: {
                        building: b.name, floor: u.floor, layout: u.layout, isNetEffectivePrice: !!u.is_net_effective_price,
                        incentives: u.incentives || null, leaseTerms: [u.min_lease_term, u.max_lease_term], exposures: u.exposures, view: u.view,
                        renterFee: u.renter_fee, virtualTour: u.virtual_tour_url || null,
                    },
                }));
            } else if (u.suite) {
                // MRI / Funnel availability
                const addr = splitAddress(u.availability_address);
                if (!inNyc({ zip: addr.zip })) continue;
                const assets = u.assets ?? {};
                rows.push(makeRow(cfg, {
                    sourceId: `mri-${u.property_mri_id ?? u.property_id}-${u.suite}`,
                    url: `${base}/availabilities/`,
                    street: addr.street ?? u.community,
                    unit: u.funnel_unit_number ?? u.suite,
                    city: addr.city,
                    zip: addr.zip,
                    price: num(u.rental_price ?? u.cost),
                    beds: u.bedrooms,
                    baths: u.bathrooms,
                    sqft: u.area?.lower || null,
                    noFee: saysNoFee(u.comment, u.listing_features) ? true : null,
                    available: date(u.available),
                    photos: [...(assets.photos ?? []), ...(assets.floorplans ?? [])].map((p) => p?.image ?? p?.url ?? (typeof p === 'string' ? p : null)),
                    raw: { building: u.community, floor: u.floor, unitType: u.unit_type, comment: u.comment, virtualTour: u.virtual_tour_url || null },
                }));
            }
        }
    }
    return rows;
}
