// Compass search cards (+ optional detail-page listing) -> nest SCHEMA rows.
//
// A search card (initialResults.lolResults.data[].listing) carries: listingIdSHA, title
// ("$4,950"), subtitles ["75 Kingsland Avenue, Unit 2B", "Williamsburg"], badges
// ("Listed By Compass", "No Fee", "New", ...), media (not always), subStats (beds/bath/sqft
// strings), location {lat, lng}, structuredData (JSON-LD strings with the zip), and
// clusterSummary {compassListingTypes, transactionTypes, priceRange, bedrooms, bathrooms}.
//
// CompassListingType (from Compass's own bundle): 0 COMING_SOON, 1 PRIVATE_EXCLUSIVE,
// 2 STANDARD_EXCLUSIVE, 3 MLS_LISTINGS, 4 NEW_CONSTRUCTION. "Exclusive" = 1 or 2, i.e.
// Compass (or its Corcoran brand) holds the listing.
//
// The detail page (window.__INITIAL_DATA__.props.listingRelation.listing) adds the agent
// (fullContacts), dates (listed / available), full baths, incentives (No Fee) and photos.

const BASE = 'https://www.compass.com';
export const CLT = { COMING_SOON: 0, PRIVATE_EXCLUSIVE: 1, STANDARD_EXCLUSIVE: 2, MLS_LISTINGS: 3, NEW_CONSTRUCTION: 4 };

function boroughOf(zip, city) {
    const c = { brooklyn: 'Brooklyn', manhattan: 'Manhattan', bronx: 'Bronx', 'staten island': 'Staten Island', queens: 'Queens' }[(city || '').toLowerCase()];
    if (c) return c;
    const z = String(zip || '').slice(0, 3);
    if (['100', '101', '102'].includes(z)) return 'Manhattan';
    if (z === '104') return 'Bronx';
    if (z === '103') return 'Staten Island';
    if (z === '112') return 'Brooklyn';
    if (['110', '111', '113', '114', '116'].includes(z)) return 'Queens';
    return null;
}

const int = (v) => {
    if (v == null) return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const abs = (u) => (!u ? null : u.startsWith('http') ? u : u.startsWith('//') ? `https:${u}` : BASE + u);

// "75 Kingsland Avenue, Unit 2B" -> ["75 Kingsland Avenue", "2B"]; "Kent Avenue" (address withheld) -> ["Kent Avenue", null]
function splitStreet(s) {
    if (!s) return [null, null];
    s = s.replace(/\s+/g, ' ').trim();
    const m = s.match(/^(.*?),?\s+(?:unit|apt\.?|apartment|#)\s*(\S.*)$/i);
    if (!m) return [s, null];
    return [m[1].replace(/,$/, '').trim(), m[2].replace(/^#/, '').trim() || null];
}

function jsonLd(card) {
    try { return JSON.parse(card.structuredData?.singleFamilyResidence || 'null'); } catch { return null; }
}

function badgeTexts(b) {
    return (b?.cornerBadges ?? []).map((x) => x.displayText).filter(Boolean);
}

export function flags(card) {
    const types = card.clusterSummary?.compassListingTypes ?? [];
    const badges = badgeTexts(card.badges);
    const comingSoon = types.includes(CLT.COMING_SOON) || badges.some((t) => /coming soon/i.test(t));
    const privateExclusive = types.includes(CLT.PRIVATE_EXCLUSIVE);
    const exclusive = privateExclusive || types.includes(CLT.STANDARD_EXCLUSIVE);
    return { comingSoon, exclusive, privateExclusive, newConstruction: types.includes(CLT.NEW_CONSTRUCTION) };
}

function subStat(card, re) {
    return (card.subStats ?? []).find((s) => re.test(s.title || '') || re.test(s.titleLabel || ''));
}

function keyDetail(d, key) {
    return d?.detailedInfo?.keyDetails?.find((k) => k.key === key)?.value ?? null;
}

// "10/05/2026" -> "2026-10-05"
function usDate(s) {
    const m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
}

function nyDate(ms) {
    if (!Number.isFinite(ms)) return null;
    return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function photosOf(media) {
    const m = (media ?? []).filter((x) => x && (x.thumbnailUrl || x.originalUrl));
    // category 0 = photo; floor plans etc. go after
    m.sort((a, b) => (a.category === 0 ? 0 : 1) - (b.category === 0 ? 0 : 1));
    return m.slice(0, 8).map((x) => abs(x.thumbnailUrl || x.originalUrl));
}

export function mapListing(card, detail, ctx) {
    const cs = card.clusterSummary ?? {};
    const ld = jsonLd(card);
    const loc = detail?.location ?? {};
    const f = flags(card);
    const badges = [...new Set([...badgeTexts(card.badges), ...badgeTexts(detail?.badges)])];
    const listedBy = badges.map((t) => t.match(/^Listed By (.+)$/i)?.[1]).find(Boolean) ?? null;

    const [street0, unit0] = splitStreet(card.subtitles?.[0] || ld?.address?.streetAddress);
    // The card's spelled-out street ("715 East 5th Street") beats the detail's parts ("715" "5th" "St",
    // which drop East/West). Corcoran-brand cards withhold the number ("East 10th Street"); the
    // detail page still has it, and the unit.
    let street = street0, unit = unit0;
    const dUnit = loc.unitNumber ? String(loc.unitNumber).replace(/^#/, '').trim() || null : null;
    if (!/^\d/.test(street0 || '') && loc.streetNumber) {
        street = street0 ? `${loc.streetNumber} ${street0}` : [loc.streetNumber, loc.street, loc.streetType].filter(Boolean).join(' ');
    }
    if (!unit && dUnit) unit = dUnit;
    const zip = loc.zipCode || ld?.address?.postalCode || null;
    const city = loc.city || ld?.address?.addressLocality || null;

    const price = int(detail?.price?.lastKnown ?? cs.priceRange?.[0] ?? card.title);
    const bedsRaw = num(detail?.size?.bedrooms ?? cs.bedrooms);
    const beds = bedsRaw == null ? null : bedsRaw < 1 ? 0 : bedsRaw;   // 0.5 = alcove studio
    let baths = num(cs.bathrooms);
    if (detail?.size) {
        const full = num(detail.size.fullBathrooms), half = num(detail.size.halfBathrooms);
        if (full != null) baths = full + 0.5 * (half ?? 0);
        else if (num(detail.size.bathrooms) != null) baths = num(detail.size.bathrooms);
    }
    let sqft = int(detail?.size?.squareFeet ?? subStat(card, /^sq\s*ft|square feet/i)?.subtitle);
    if (sqft != null && sqft > 6000) sqft = null;       // building-wide numbers leak into some cards

    const incentives = keyDetail(detail, 'Rental Incentives');
    const feeText = [...badges, incentives || ''].join(' | ');
    const noFee = /\bno fee\b/i.test(feeText) ? true : null;

    const contacts = (detail?.fullContacts ?? []).filter((c) => c.consumerVisible !== false);
    const agent = contacts.find((c) => /agent/i.test(c.contactType || '')) ?? contacts[0] ?? null;
    const agency = agent?.company || detail?.listOfficeGroup?.brandInfo?.brandName || listedBy || null;

    const available = usDate(keyDetail(detail, 'Available Date')) ?? nyDate(detail?.date?.available);
    const listedAt = Number.isFinite(detail?.date?.listed) ? new Date(detail.date.listed).toISOString() : null;
    const status = detail?.localizedStatus ?? null;
    const comingSoon = f.comingSoon || /coming soon/i.test(status || '');

    return {
        source: 'compass',
        sourceId: String(card.listingIdSHA),
        url: abs(card.pageLink || card.navigationPageLink),
        street,
        unit,
        neighbourhood: loc.neighborhood || card.subtitles?.[1] || null,
        borough: boroughOf(zip, city) ?? ctx.borough ?? null,
        zip,
        lat: num(loc.latitude ?? card.location?.latitude),
        lon: num(loc.longitude ?? card.location?.longitude),
        price,
        netEffective: null,
        beds,
        baths,
        sqft,
        noFee,
        available,
        photos: photosOf(detail?.media?.length ? detail.media : card.media),
        agency,
        listedAt,
        scrapedAt: new Date().toISOString(),
        raw: {
            search: ctx.search,
            page: ctx.page,
            exclusive: f.exclusive,
            privateExclusive: f.privateExclusive,
            comingSoon,
            newConstruction: f.newConstruction,
            listedBy,
            agentName: agent?.contactName ?? null,
            agentPhone: agent?.phone ?? null,
            agentEmail: agent?.email ?? null,
            agentUrl: agent?.websiteURL ? abs(agent.websiteURL) : null,
            otherAgents: contacts.filter((c) => c !== agent).map((c) => c.contactName).filter(Boolean),
            badges,
            alcoveStudio: bedsRaw === 0.5,
            addressWithheld: !/^\d/.test(street0 || ''),
            compassListingTypes: cs.compassListingTypes ?? null,
            transactionTypes: cs.transactionTypes ?? null,
            propertyType: cs.propertyType?.masterType?.GLOBAL ?? null,
            openHouse: cs.openHouseInfo ?? null,
            status,
            daysOnMarket: detail?.date?.daysOnMarket ?? null,
            incentives,
            leaseTerm: detail?.rentalInfo?.leaseTerm ?? null,
            petPolicy: keyDetail(detail, 'Pet Policy'),
            amenities: detail?.detailedInfo?.amenities ?? null,
            building: detail?.buildingInfo?.buildingAddress ?? null,
            isOffMLS: detail?.isOffMLS ?? null,
            detailFetched: !!detail,
        },
    };
}
