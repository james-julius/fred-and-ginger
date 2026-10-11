// Zillow listing pages -> { top, detail } for nest rows (see SCHEMA.md "Listing pages: raw.detail").
//
// Pure functions: everything here takes the parsed __NEXT_DATA__ object of a page and returns
// plain data. No I/O, so test/detail.test.js runs them against saved real payloads.
//
// Two page kinds:
// - unit pages (/homedetails/..._zpid/): props.pageProps.componentProps.gdpClientCache is a JSON
//   *string* keyed by GraphQL query name; each value has `property` (livingArea, description,
//   resoFacts{...}, photos, ...).
// - building pages (/b/... and /apartments/...): props.pageProps.componentProps.initialReduxState
//   .gdp.building (ungroupedUnits with beds/baths/sqft/price, amenityDetails, buildingAttributes,
//   amenitySummary, rentalCostsAndFees, description, floorPlans on managed complexes).

const MAX_DESC = 4000;

// Bump when parsing changes in a way that should re-read cached pages (main.js treats records
// with a lower version as stale).
export const DETAIL_VERSION = 1;

const clean = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');
const isUnknown = (s) => !s || /^(unknown|none|null|n\/a)$/i.test(String(s).trim());
const posInt = (v) => {
    if (v == null || v === '') return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};
const posNum = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
};

// "MicrowaveOven" -> "Microwave oven", "SmallDogs" -> "Small dogs"; leaves normal text alone.
function humanize(s) {
    s = clean(String(s));
    if (!/\s/.test(s) && /[a-z][A-Z]/.test(s)) {
        s = s.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
        s = s[0].toUpperCase() + s.slice(1);
    }
    return s;
}

function dedupe(list) {
    const out = [];
    const seen = new Set();
    for (const v of list) {
        const s = clean(String(v ?? ''));
        if (!s || isUnknown(s)) continue;
        const k = s.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(s);
    }
    return out;
}

const arr = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);

function isoDate(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number' || /^\d{10,13}$/.test(String(v))) {
        const n = Number(v);
        const d = new Date(n < 1e12 ? n * 1000 : n);
        // Zillow uses 2000-01-01 as "no date given"
        return Number.isNaN(d.getTime()) || d.getUTCFullYear() < 2010 ? null : d.toISOString().slice(0, 10);
    }
    const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    const d = new Date(String(v));
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// Drop empty values so raw.detail only carries what the page says.
function compact(o) {
    const out = {};
    for (const [k, v] of Object.entries(o)) {
        if (v == null || v === '') continue;
        if (Array.isArray(v) && !v.length) continue;
        out[k] = v;
    }
    return out;
}

function money(v) {
    if (v == null) return null;
    if (typeof v === 'number') return v > 0 ? Math.round(v * 100) / 100 : null;
    const m = String(v).replace(/,/g, '').match(/\$?\s*(\d+(?:\.\d+)?)/);
    return m && Number(m[1]) > 0 ? Number(m[1]) : null;
}

// ---------------------------------------------------------------------------------------------
// fees

// Zillow's monthly/one-time fee sections look like
//   { feeName: "Application fee", feeAmount: {...} | "$20", ... } in various shapes; we walk any
// object array and pick out name + amount + period words.
function periodOf(...texts) {
    const t = texts.filter(Boolean).join(' ').toLowerCase();
    if (/month|\/mo\b|recurring|per month/.test(t)) return 'monthly';
    if (/one[- ]?time|once|upfront|move[- ]?in|application|deposit|admin|broker|holding|move/.test(t)) return 'once';
    return null;
}

function addFee(fees, name, amount, period) {
    name = clean(name);
    const a = money(amount);
    if (!name || a == null) return;
    const p = period || periodOf(name) || 'once';
    if (fees.some((f) => f.name.toLowerCase() === name.toLowerCase() && f.amount === a)) return;
    fees.push({ name, amount: a, period: p });
}

// ---------------------------------------------------------------------------------------------
// unit pages

export function gdpProperty(nextData) {
    const cp = nextData?.props?.pageProps?.componentProps;
    let cache = cp?.gdpClientCache;
    if (typeof cache === 'string') {
        try { cache = JSON.parse(cache); } catch { cache = null; }
    }
    if (cache && typeof cache === 'object') {
        // prefer the entry with the most complete property (the full-render query)
        let best = null;
        for (const v of Object.values(cache)) {
            const p = v?.property;
            if (p && (!best || Object.keys(p).length > Object.keys(best).length)) best = p;
        }
        if (best) return best;
    }
    return null;
}

function photosOfProperty(p) {
    const out = [];
    for (const ph of arr(p.responsivePhotos ?? p.photos)) {
        const jpeg = ph?.mixedSources?.jpeg;
        let url = null;
        if (Array.isArray(jpeg) && jpeg.length) {
            // pick a mid-size rendition (~768px) rather than the largest
            const sorted = [...jpeg].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
            url = (sorted.find((j) => (j.width ?? 0) >= 768) ?? sorted[sorted.length - 1])?.url;
        }
        url = url || ph?.url;
        if (url) out.push(url);
        if (out.length >= 8) break;
    }
    return out;
}

// ---------------------------------------------------------------------------------------------
// listing text: only facts the text states outright (numbers, "no fee", "W/D in unit").

// "800 sq ft", "approx. 1,100 square feet", "750 SF", "650sqft"
export function sqftFromText(t) {
    if (!t) return null;
    const re = /(?:^|[^\d$.,])(\d{1,2},?\d{3}|\d{3})\s*\+?\s*(?:sq\.?\s*(?:ft|feet)\.?|square\s*(?:ft|feet|foot)|sf\b|sqft\b|ft2|ft²)/gi;
    const vals = [];
    for (const m of t.matchAll(re)) {
        const n = Number(m[1].replace(',', ''));
        if (n >= 200 && n <= 6000) vals.push(n);
    }
    // more than one figure (e.g. "1,000 sq ft roof deck" next to the unit size) is ambiguous unless they agree
    return vals.length && vals.every((v) => v === vals[0]) ? vals[0] : null;
}

export function laundryFromText(t) {
    if (!t) return null;
    if (/no\s+(?:laundry|washer)/i.test(t)) return null;
    if (/\b(?:w\/?d|washer\s*(?:\/|&|and)\s*dryer|washer-dryer|in[- ]unit\s+(?:laundry|washer))\b[^.!|\n]{0,25}?\b(?:in[- ]?(?:the\s+)?(?:unit|apartment|apt|residence|home)|in[- ]?unit)\b/i.test(t)
        || /\bin[- ]unit\s+(?:laundry|washer|w\/?d)/i.test(t)) return 'Washer/dryer in unit';
    if (/\b(?:washer\s*(?:\/|&|and)\s*dryer|w\/d)\b/i.test(t) && !/\b(?:building|shared|common|basement|every floor|each floor|on[- ]site|downstairs)\b[^.]{0,20}laundry|laundry[^.]{0,30}\b(?:building|room|every floor|each floor|on[- ]site|downstairs|basement)\b/i.test(t)) return 'Washer/dryer';
    if (/laundry[^.!\n]{0,30}\b(?:in (?:the )?building|room|on every floor|on each floor|on[- ]site|downstairs|in (?:the )?basement)|\b(?:shared|common|on[- ]site|building|basement)\s+laundry/i.test(t)) return 'Laundry in building';
    return null;
}

export function noFeeFromText(t) {
    if (!t) return null;
    if (/\bno[- ]?(?:broker(?:'?s)?|brokers?\s+)?\s*fees?\b|\bno broker(?:'?s)? fee\b|\bfee[- ]?free\b|\bzero (?:broker )?fee\b|\bowner pays (?:the )?(?:broker )?fee\b|\blandlord pays (?:the )?(?:broker )?fee\b/i.test(t)) return 'No fee';
    const m = t.match(/\b(?:broker(?:'?s)?\s+fee|fee)\b[^.!\n]{0,40}?\b(\d{1,2}(?:\.\d+)?\s*%|one month'?s?\s+rent)[^.!\n]{0,30}/i);
    return m ? clean(m[0]) : null;
}

const UTIL = 'heat|hot water|cooking gas|gas|electricity|electric|water|internet|wi-?fi|cable|sewer|trash';
export function utilitiesFromText(t) {
    if (!t) return [];
    if (/\ball utilities (?:are )?included\b|\butilities included\b/i.test(t) && !/\butilities (?:are )?not included\b/i.test(t)) {
        const m = t.match(new RegExp(`\\b((?:${UTIL})(?:\\s*(?:,|&|and|\\+|\\/)\\s*(?:${UTIL}))*)\\s+(?:are\\s+|is\\s+)?included`, 'i'));
        if (!m) return ['All utilities'];
    }
    const out = [];
    for (const m of t.matchAll(new RegExp(`\\b((?:${UTIL})(?:\\s*(?:,|&|and|\\+|\\/)\\s*(?:${UTIL}))*)\\s+(?:(?:are|is)\\s+)?(?:all\\s+)?included`, 'gi'))) {
        for (const u of m[1].split(/\s*(?:,|&|\band\b|\+|\/)\s*/)) if (u) out.push(u[0].toUpperCase() + u.slice(1).toLowerCase());
    }
    return dedupe(out);
}

const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
export function floorFromText(t) {
    if (!t) return null;
    const m = t.match(/\b(?:on\s+the\s+|located\s+on\s+the\s+|\(?)(\d{1,2})(?:st|nd|rd|th)\)?\s+floor\b/i)
        ?? t.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)[- ]floor\b/i);
    if (!m) return null;
    const n = ORD[m[1].toLowerCase()] ?? Number(m[1]);
    return n >= 1 && n <= 99 ? n : null;
}

// ---------------------------------------------------------------------------------------------
// unit pages

const glance = (rf, label) => {
    const f = arr(rf.atAGlanceFacts).find((x) => String(x?.factLabel).toLowerCase() === label.toLowerCase());
    const v = f?.factValue;
    return v == null || isUnknown(v) ? null : clean(String(v));
};

function petsOfReso(rf, p) {
    const words = glance(rf, 'Pets') ?? (arr(rf.allowedPets ?? rf.petsAllowed).length ? arr(rf.allowedPets ?? rf.petsAllowed).map(humanize).join(', ') : null);
    let out = null;
    if (words) out = /\bno\b|not allowed/i.test(words) ? words : `${words} allowed`;
    else if (rf.hasPetsAllowed === false) out = 'No pets';
    const extra = clean(rf.petPolicyDescription ?? p.petPolicyDescription ?? '');
    return [out, extra].filter(Boolean).join('; ') || null;
}

function laundryOfReso(rf) {
    const l = dedupe([...arr(rf.laundryFeatures).map(humanize), glance(rf, 'Laundry')]);
    if (!l.length) return null;
    // Zillow says "In Unit" / "Shared"; give it the noun
    return l.map((s) => (/^in unit$/i.test(s) ? 'Washer/dryer in unit' : /^(shared|in building|on site)$/i.test(s) ? `Laundry ${s.toLowerCase()}` : s)).join(', ');
}

// rentalCostsAndFees.fees.{monthly,oneTime,...}.feeGroup[].fees[]: {type, name?, amount?...}. BASE_RENT
// is the rent itself. Shape of filled fees varies by listing, so walk it for name+amount pairs.
function feesOfProperty(p, rf) {
    const fees = [];
    const walk = (node, ctxPeriod, depth = 0) => {
        if (!node || depth > 8) return;
        if (Array.isArray(node)) { node.forEach((n) => walk(n, ctxPeriod, depth + 1)); return; }
        if (typeof node !== 'object') return;
        if (node.type !== 'BASE_RENT') {
            const rawName = node.feeName ?? node.name ?? node.label ?? node.displayName ?? node.title ?? (typeof node.type === 'string' ? humanize(node.type.toLowerCase().replace(/_/g, ' ')) : null);
            const amt = node.feeAmount ?? node.amount ?? node.value ?? node.price ?? node.fee ?? node.cost;
            const amtVal = amt && typeof amt === 'object' ? (amt.min ?? amt.max ?? amt.value ?? amt.amount ?? amt.displayText) : amt;
            if (typeof rawName === 'string' && amtVal != null && typeof amtVal !== 'object') {
                const name = rawName[0].toUpperCase() + rawName.slice(1);
                addFee(fees, name, amtVal, periodOf(node.feeType, node.frequency, node.period, ctxPeriod, name));
            }
        }
        for (const [k, v] of Object.entries(node)) {
            if (v && typeof v === 'object') {
                const kp = /monthly|recurring/i.test(k) ? 'monthly' : /one[_-]?time|upfront|moveIn|due ?at/i.test(k) ? 'once' : ctxPeriod;
                walk(v, kp, depth + 1);
            }
        }
    };
    walk(p.rentalCostsAndFees ?? null, null);
    walk(p.feesAndDues ?? null, null);
    // Zillow's own rental application (NYC caps it at $20); only when the listing takes applications
    const app = p.rentalApplicationPriceDetail;
    if (app?.actualPriceInCents > 0 && p.rentalApplicationsAcceptedType && !/^NONE$/i.test(p.rentalApplicationsAcceptedType)) {
        addFee(fees, 'Application fee', app.actualPriceInCents / 100, 'once');
    }
    addFee(fees, 'Security deposit', rf.securityDeposit ?? rf.depositFee ?? p.depositFee, 'once');
    addFee(fees, 'Pet deposit', rf.petDeposit, 'once');
    addFee(fees, 'Pet rent', rf.petRent, 'monthly');
    // "Deposit & fees" / "One-time fees" glance facts: "$4,490 deposit" style text
    for (const label of ['Deposit & fees', 'One-time fees']) {
        const v = glance(rf, label);
        if (!v) continue;
        for (const part of v.split(/[,;|]/)) {
            const amt = money(part);
            const name = clean(part.replace(/\$\s*[\d,]+(?:\.\d+)?/, '')) || label;
            if (amt != null) addFee(fees, name[0].toUpperCase() + name.slice(1), amt, 'once');
        }
    }
    return fees;
}

function utilitiesOf(...lists) {
    return dedupe(lists.flatMap((l) => arr(l)).map(humanize)).filter((u) => !isUnknown(u));
}

function leaseTermsOf(...vals) {
    const terms = dedupe(vals.flatMap((v) => arr(v)).map((v) => humanize(String(v)))).filter((t) => !/contact|unknown|call/i.test(t));
    return terms.length ? terms.join(', ') : null;
}

function noFeeFrom(brokerFee) {
    if (!brokerFee) return null;
    if (/^no\b|no[- ]?fee/i.test(brokerFee)) return true;
    if (/\d|month/i.test(brokerFee)) return false;
    return null;
}

export function parseUnitPage(nextData) {
    const p = gdpProperty(nextData);
    if (!p) return null;
    const rf = p.resoFacts ?? {};
    const rawDesc = typeof p.description === 'string' ? p.description : '';
    const description = clean(rawDesc).slice(0, MAX_DESC) || null;

    const amenities = dedupe([
        ...arr(rf.appliances),
        ...arr(rf.interiorFeatures),
        ...arr(rf.communityFeatures),
        ...arr(rf.associationAmenities),
        ...arr(rf.exteriorFeatures).filter((f) => !/^laundry$/i.test(f)), // laundry has its own field
        ...arr(rf.patioAndPorchFeatures),
        ...arr(rf.accessibilityFeatures),
        ...arr(rf.securityFeatures),
        ...arr(rf.flooring).map((f) => (isUnknown(f) ? null : `${humanize(f)} floors`)),
        ...arr(rf.cooling).map((c) => (isUnknown(c) ? null : humanize(c))),
        ...arr(rf.heating).map((c) => (isUnknown(c) ? null : `Heating: ${humanize(c)}`)),
        ...arr(rf.parkingFeatures).map((c) => (isUnknown(c) ? null : `Parking: ${humanize(c)}`)),
        ...(rf.hasView ? arr(rf.view) : []),
        ...arr(rf.otherFacts).map((f) => (f?.name && f?.value && !isUnknown(f.value) ? `${f.name}: ${f.value}` : null)),
    ].filter(Boolean).map(humanize));

    const brokerFee = clean(p.brokerFee ?? p.brokerageFee ?? rf.brokerFee ?? '') || noFeeFromText(rawDesc);
    const detail = compact({
        description,
        amenities,
        pets: petsOfReso(rf, p),
        laundry: laundryOfReso(rf) ?? laundryFromText(rawDesc),
        fees: feesOfProperty(p, rf),
        brokerFee,
        utilities: dedupe([...utilitiesOf(rf.utilitiesIncluded, p.utilitiesIncluded), ...utilitiesFromText(rawDesc)]),
        leaseTerms: leaseTermsOf(rf.leaseTerm, rf.leaseTerms, p.leaseTerm, rf.leaseLength),
        floor: posInt(rf.unitFloor ?? rf.floorNumber ?? p.floorNumber) ?? floorFromText(rawDesc),
        yearBuilt: posInt(rf.yearBuilt ?? p.yearBuilt),
        buildingUnits: posInt(rf.totalUnits ?? rf.numberOfUnitsInCommunity ?? p.building?.unitCount),
        buildingUrl: p.building?.bdpUrl ? `https://www.zillow.com${p.building.bdpUrl}` : null,
    });

    const full = posNum(rf.bathroomsFull);
    const half = posNum(rf.bathroomsHalf);
    const baths = full != null ? full + 0.5 * (half ?? 0) : posNum(p.bathrooms ?? rf.bathrooms);
    const structuredSqft = posInt(p.livingArea ?? p.livingAreaValue ?? rf.livingArea);
    const textSqft = structuredSqft ? null : sqftFromText(rawDesc);
    if (textSqft) detail.sqftSource = 'description';
    const top = compact({
        sqft: structuredSqft ?? textSqft,
        baths,
        noFee: noFeeFrom(brokerFee),
        available: isoDate(rf.availabilityDate ?? p.availabilityDate ?? p.dateAvailable),
        photos: photosOfProperty(p),
    });
    return { kind: 'unit', top, detail };
}

// ---------------------------------------------------------------------------------------------
// building pages

export function gdpBuilding(nextData) {
    return nextData?.props?.pageProps?.componentProps?.initialReduxState?.gdp?.building ?? null;
}

function buildingAmenities(b) {
    const ad = b.amenityDetails ?? {};
    const ba = b.buildingAttributes ?? {};
    const yes = (flag, label) => (ba[flag] === true ? label : null);
    const unitFeatures = arr(ad.unitFeatures);
    return dedupe([
        ...unitFeatures,
        ...arr(ad.customAmenities?.rawAmenities),
        // unitFeatures already lists appliances and floors in Zillow's display words
        ...(unitFeatures.length ? [] : arr(ba.appliances).map(humanize)),
        ...arr(ba.communityRooms).map(humanize),
        ...arr(ba.outdoorCommonAreas).map(humanize),
        ...arr(ba.securityTypes).map(humanize),
        ...arr(ba.sportsCourts).map(humanize),
        ...arr(ba.viewType).map((v) => (isUnknown(v) ? null : `View: ${humanize(v)}`)),
        ...arr(ba.parkingTypes).map((v) => (isUnknown(v) ? null : `Parking: ${humanize(v)}`)),
        ...(unitFeatures.length ? [] : arr(ba.floorCoverings).map((f) => (isUnknown(f) ? null : `${humanize(f)} flooring`))),
        ...arr(b.amenitySummary?.buildingDetails),
        yes('hasElevator', 'Elevator'),
        yes('hasSwimmingPool', 'Pool'),
        yes('hasPatioBalcony', 'Patio/balcony'),
        yes('hasStorage', 'Storage'),
        yes('hasBicycleStorage', 'Bike storage'),
        yes('hasPackageService', 'Package service'),
        yes('hasOnsiteManagement', 'On-site management'),
        yes('hasTwentyFourHourMaintenance', '24-hour maintenance'),
        yes('hasDisabledAccess', 'Wheelchair accessible'),
        yes('hasFireplace', 'Fireplace'),
        yes('hasGuestSuite', 'Guest suite'),
        yes('hasPetPark', 'Pet park'),
        yes('hasHotTub', 'Hot tub'),
        yes('hasSauna', 'Sauna'),
        yes('hasBarbecue', 'Barbecue'),
        yes('isSmokeFree', 'Smoke-free'),
        ba.isFurnished === true ? 'Furnished' : null,
        ba.airConditioning && !isUnknown(ba.airConditioning) && /^yes$/i.test(ba.airConditioning) ? 'Air conditioning' : null,
        ...arr(b.zovInsight?.tags),
    ].filter(Boolean));
}

function buildingPets(b) {
    const ad = b.amenityDetails ?? {};
    const ba = b.buildingAttributes ?? {};
    const parts = [];
    const pets = dedupe([...arr(ad.pets), ...arr(ba.petPolicies).map(humanize)]);
    if (pets.length) parts.push(/^no pets?$/i.test(pets[0]) ? pets[0] : `${pets.join(', ')} allowed`);
    for (const d of arr(ad.petDetails)) {
        const s = typeof d === 'string' ? d : clean([d?.title, d?.description, d?.text].filter(Boolean).join(': '));
        if (s) parts.push(clean(s));
    }
    const pd = b.detailedPetPolicy ?? ba.detailedPetPolicy;
    if (pd && typeof pd === 'object') {
        for (const v of Object.values(pd)) for (const x of arr(v)) {
            if (typeof x === 'string') parts.push(clean(x));
            else if (x && typeof x === 'object') {
                const s = clean([x.petType ?? x.type, x.description ?? x.restrictions].filter(Boolean).join(': '));
                if (s) parts.push(s);
            }
        }
    }
    if (ba.petPolicyDescription) parts.push(clean(ba.petPolicyDescription));
    return dedupe(parts).join('; ') || null;
}

function buildingLaundry(b) {
    const l = dedupe([
        ...arr(b.amenitySummary?.laundry),
        b.buildingAttributes?.hasSharedLaundry === true ? 'Shared laundry' : null,
    ]);
    // "Shared laundry, washer/dryer" is what Zillow shows; keep its words
    return l.length ? l.join(', ') : null;
}

function buildingFees(b) {
    const ba = b.buildingAttributes ?? {};
    const fees = [];
    addFee(fees, 'Application fee', ba.applicationFee, 'once');
    addFee(fees, 'Administrative fee', ba.administrativeFee, 'once');
    if (ba.depositFeeMin != null || ba.depositFeeMax != null) {
        addFee(fees, 'Security deposit', ba.depositFeeMin ?? ba.depositFeeMax, 'once');
    }
    // rentalCostsAndFees.selectors.beds[].selector.costs: baseRent plus optional fee groups
    for (const sel of arr(b.rentalCostsAndFees?.selectors?.beds)) {
        const costs = sel?.selector?.costs ?? {};
        for (const [k, v] of Object.entries(costs)) {
            if (k === 'baseRent' || !v) continue;
            const period = /monthly|recurring/i.test(k) ? 'monthly' : /one|upfront|moveIn|deposit/i.test(k) ? 'once' : null;
            for (const f of arr(v.fees ?? v.items ?? v)) {
                const name = f?.name ?? f?.feeName ?? f?.displayName ?? f?.label;
                const amt = f?.amount?.min ?? f?.amount?.max ?? f?.amount ?? f?.value;
                if (name && amt != null && typeof amt !== 'object') addFee(fees, name, amt, period);
            }
        }
    }
    return fees;
}

export function buildingUnits(b) {
    const units = [];
    for (const u of arr(b.ungroupedUnits)) {
        if (u?.listingType && u.listingType !== 'FOR_RENT') continue;
        const price = posInt(u.price ?? u.baseRent);
        if (price == null) continue;
        units.push(compact({
            unit: clean(String(u.unitNumber ?? '')).replace(/^(unit|apt\.?|#)\s*/i, '') || null,
            beds: u.beds == null ? null : Number(u.beds),
            baths: posNum(u.baths),
            sqft: posInt(u.sqft),
            price,
            available: isoDate(u.availableFrom),
            zpid: u.zpid ? String(u.zpid) : null,
        }));
    }
    // managed complexes list floor plans instead of (or as well as) units
    for (const fp of arr(b.floorPlans)) {
        for (const u of arr(fp?.units)) {
            const price = posInt(u?.price);
            if (price == null) continue;
            const unit = clean(String(u.unitNumber ?? '')).replace(/^(unit|apt\.?|#)\s*/i, '') || null;
            if (unit && units.some((x) => x.unit === unit)) continue;
            units.push(compact({
                unit,
                beds: fp.beds == null ? null : Number(fp.beds),
                baths: posNum(fp.baths),
                sqft: posInt(u.sqft ?? fp.sqft),
                price,
                available: isoDate(u.availableFrom),
                zpid: u.zpid ? String(u.zpid) : null,
                floorPlan: clean(fp.name ?? '') || null,
            }));
        }
    }
    return units;
}

export function parseBuildingPage(nextData) {
    const b = gdpBuilding(nextData);
    if (!b) return null;
    const ba = b.buildingAttributes ?? {};
    const description = clean(b.description).slice(0, MAX_DESC) || null;
    const rawDesc = typeof b.description === 'string' ? b.description : '';
    const brokerFee = noFeeFromText(rawDesc);
    const units = buildingUnits(b);
    const detail = compact({
        description,
        amenities: buildingAmenities(b),
        pets: buildingPets(b),
        laundry: buildingLaundry(b) ?? laundryFromText(rawDesc),
        fees: buildingFees(b),
        brokerFee,
        utilities: dedupe([...utilitiesOf(ba.utilitiesIncluded), ...utilitiesFromText(rawDesc)]),
        leaseTerms: leaseTermsOf(ba.leaseTerms, ba.leaseLengths),
        yearBuilt: posInt(b.yearBuilt ?? ba.yearBuilt),
        // rentalUnitsSummary.unitCount counts units *for rent*, not the building; ungroupedUnits is
        // Zillow's whole unit roster (rent + off-market) when it holds more than the rentals
        buildingUnits: posInt(ba.unitCount) ?? (arr(b.ungroupedUnits).length > units.length ? arr(b.ungroupedUnits).length : null),
        buildingName: clean(b.buildingName) || null,
        units,
    });
    const photos = [];
    for (const ph of arr(b.photos ?? b.galleryPhotos)) {
        const srcs = ph?.mixedSources?.jpeg ?? ph?.mixedSources?.webp ?? [];
        const sorted = [...srcs].sort((x, y) => (x.width ?? 0) - (y.width ?? 0));
        const url = (sorted.find((j) => (j.width ?? 0) >= 768) ?? sorted[sorted.length - 1])?.url;
        if (url) photos.push(url);
        if (photos.length >= 8) break;
    }
    return { kind: 'building', top: compact({ noFee: noFeeFrom(brokerFee), photos }), detail };
}

export function parseDetailPage(nextData) {
    return parseUnitPage(nextData) ?? parseBuildingPage(nextData);
}

// ---------------------------------------------------------------------------------------------
// merging a cached/parsed record into a row

// Fill top-level fields from the page when the page is better than the card.
export function applyDetail(row, rec) {
    if (!rec?.detail) return row;
    const { top = {}, detail = {}, fetchedAt } = rec;
    const out = { ...row, raw: { ...row.raw } };
    if (row.raw?.isBuilding) {
        // Building rows are one per bed type: keep only that bed count's units. sqft/baths/available
        // come from those units: sqft and baths when all units agree, else the SMALLEST (matches the
        // row's "from" price, which is the cheapest/smallest unit); available = earliest date.
        const all = detail.units ?? [];
        const mine = all.filter((u) => u.beds === row.beds);
        const pick = (k) => [...new Set(mine.map((u) => u[k]).filter((v) => v != null))].sort((a, b) => a - b);
        const sq = pick('sqft');
        const bt = pick('baths');
        if (out.sqft == null && sq.length) out.sqft = sq[0];
        if (out.baths == null && bt.length) out.baths = bt[0];
        const av = mine.map((u) => u.available).filter(Boolean).sort();
        if (out.available == null && av.length) out.available = av[0];
        out.raw.detail = { fetchedAt, ...detail, units: mine };
    } else {
        if (top.sqft != null) out.sqft = top.sqft; // page wins: card `area` is often missing
        if (top.baths != null && (out.baths == null || Number.isInteger(out.baths))) out.baths = top.baths;
        if (top.available) out.available = top.available;
        out.raw.detail = { fetchedAt, ...detail };
    }
    if (top.noFee != null && out.noFee == null) out.noFee = top.noFee;
    if (top.photos?.length && top.photos.length > (out.photos?.length ?? 0)) out.photos = top.photos;
    return out;
}
