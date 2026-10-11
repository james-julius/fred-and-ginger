// Zillow search-result cards -> nest SCHEMA rows.
//
// A card is either a single unit (has zpid, unformattedPrice, beds, baths, area,
// hdpData.homeInfo) or a building (isBuilding: true, lotId, units: [{price: "$3,675+",
// beds: "1"}], already narrowed by the search's price/bed filters). A building has no
// per-unit data on the results page, so it becomes one row per bed type, priced at
// the "from" price; raw.priceIsFrom marks those rows.

const BASE = 'https://www.zillow.com';
const BOROUGH_CITY = { brooklyn: 'Brooklyn', 'new york': 'Manhattan', manhattan: 'Manhattan', bronx: 'Bronx', 'staten island': 'Staten Island' };

function boroughOf(zip, city) {
    const c = BOROUGH_CITY[(city || '').toLowerCase()];
    if (c) return c;
    const z = String(zip || '').slice(0, 3);
    if (['100', '101', '102'].includes(z)) return 'Manhattan';
    if (z === '104') return 'Bronx';
    if (z === '103') return 'Staten Island';
    if (z === '112') return 'Brooklyn';
    if (['110', '111', '113', '114', '116'].includes(z)) return 'Queens';
    return null;
}

// Queens addresses carry the neighbourhood as the city ("Astoria", "Long Island City").
function neighbourhoodOf(city, borough) {
    if (!city || borough !== 'Queens' || /^(queens|new york)$/i.test(city)) return null;
    return city;
}

const UNIT_RE = /\s+(?:#\s*|(?:apt|unit|ste|suite|fl|floor|ph|penthouse|rm|room)\.?(?:\s+|(?=\d)))(\S.*)$/i;

// "1447 E 88th St #2" -> ["1447 E 88th St", "2"]
function splitStreet(s) {
    if (!s || /undisclosed/i.test(s)) return [null, null];
    s = s.replace(/\s+/g, ' ').trim();
    const m = s.match(UNIT_RE);
    if (!m) return [s, null];
    const unit = m[1].replace(/^[#\s-]+/, '').trim() || null;
    return [s.slice(0, m.index).trim(), unit];
}

const int = (v) => {
    if (v == null) return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const abs = (u) => (!u ? null : u.startsWith('http') ? u : BASE + u);

function photosOf(c) {
    const cp = c.carouselPhotosComposable;
    if (cp?.baseUrl && cp.photoData?.length) {
        return cp.photoData.slice(0, 8).map((p) => cp.baseUrl.replace('{photoKey}', p.photoKey));
    }
    return c.imgSrc ? [c.imgSrc] : [];
}

function flex(c) {
    return (c.listCardRecommendation?.flexFieldRecommendations ?? []).map((f) => f.displayString).filter(Boolean);
}

function noFeeOf(c) {
    const t = flex(c).join(' | ');
    if (/\bno[- ]fee\b/i.test(t)) return true;
    return null; // Zillow search cards don't say otherwise
}

function availableOf(c) {
    const d = c.availabilityDate;
    if (!d) return null;
    const m = String(d).match(/^\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : null;
}

function listedAtOf(c, now) {
    const ms = c.hdpData?.homeInfo?.timeOnZillow;
    if (!Number.isFinite(ms) || ms < 0) return null;
    return new Date(now - ms).toISOString();
}

function rawOf(c) {
    const { carouselPhotosComposable, ...rest } = c;
    return rest;
}

export function mapCard(c, ctx) {
    const now = ctx.now ?? Date.now();
    const scrapedAt = new Date(now).toISOString();
    const zip = c.addressZipcode || c.hdpData?.homeInfo?.zipcode || null;
    const city = c.addressCity || c.hdpData?.homeInfo?.city || null;
    const borough = boroughOf(zip, city);
    const lat = num(c.latLong?.latitude ?? c.hdpData?.homeInfo?.latitude);
    const lon = num(c.latLong?.longitude ?? c.hdpData?.homeInfo?.longitude);
    const common = {
        source: 'zillow',
        neighbourhood: neighbourhoodOf(city, borough),
        borough,
        zip,
        lat,
        lon,
        photos: photosOf(c),
        scrapedAt,
    };
    const extra = { search: ctx.search, page: ctx.page, totalCount: ctx.totalCount, highlights: flex(c) };

    if (c.isBuilding || Array.isArray(c.units)) {
        // street from "532 Neptune Ave, Brooklyn, NY" (addressStreet carries a sample unit)
        const street = splitStreet((c.address || '').split(',')[0] || c.addressStreet)[0];
        const id = c.lotId ? String(c.lotId) : (c.providerListingId || c.zpid);
        return (c.units ?? []).map((u) => {
            const beds = /studio/i.test(String(u.beds)) ? 0 : num(u.beds);
            return {
                ...common,
                sourceId: `b${id}-${beds ?? 'x'}br`,
                url: abs(c.detailUrl),
                street,
                unit: null,
                price: int(u.price),
                netEffective: null,
                beds,
                baths: null,
                sqft: null,
                noFee: noFeeOf(c),
                available: null,
                agency: null,
                listedAt: null,
                raw: { ...rawOf(c), ...extra, isBuilding: true, buildingId: id, priceIsFrom: /\+/.test(u.price || ''), unitPriceText: u.price, unitsInGroup: c.units },
            };
        }).filter((r) => r.price != null && r.beds != null);
    }

    const h = c.hdpData?.homeInfo ?? {};
    const [street, unit] = splitStreet(c.addressStreet || h.streetAddress);
    const fullBaths = num(c.factsAndFeatures?.fullBathroomCount);
    const halfBaths = num(c.factsAndFeatures?.halfBathroomCount);
    let baths = num(c.baths ?? h.bathrooms);
    if (fullBaths != null && halfBaths != null) baths = fullBaths + 0.5 * halfBaths;
    const row = {
        ...common,
        sourceId: String(c.zpid ?? h.zpid ?? c.id),
        url: abs(c.detailUrl),
        street,
        unit: unit ?? (h.unit ? String(h.unit).replace(/^(#|apt\.?|unit)\s*/i, '') : null),
        price: int(c.unformattedPrice ?? h.price),
        netEffective: null,
        beds: num(c.beds ?? h.bedrooms),
        baths,
        sqft: int(c.area ?? h.livingArea),
        noFee: noFeeOf(c),
        available: availableOf(c),
        agency: c.brokerName ? c.brokerName.replace(/^listing (?:by|provided by):?\s*/i, '').trim() || null : null,
        listedAt: listedAtOf(c, now),
        raw: { ...rawOf(c), ...extra, isBuilding: false },
    };
    return row.price != null && row.beds != null ? [row] : [];
}
