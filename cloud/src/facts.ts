// What a renter wants to know about a place, read from whatever each site sent in `raw`: pets,
// laundry, outdoor space, light, building perks, deals, trains, and the listing's own words.
// Every site words these differently, so this reads all of a row's tags and text and looks for
// the phrases. Unknown stays null; never guess.

export type Facts = {
  pets: 'dogs_and_cats' | 'dogs' | 'cats' | 'case_by_case' | 'none' | null;
  laundry: 'in_unit' | 'in_building' | null;
  outdoor: 'private' | 'shared' | null;
  noFee: boolean | null;
  rentStabilized: boolean;
  monthsFree: number | null;
  doorman: boolean; elevator: boolean; dishwasher: boolean; gym: boolean; walkUp: boolean;
  light: string | null;          // "Southern exposure", "Floor-to-ceiling windows"
  trains: string[];              // ["J", "M", "L"]
  amenities: string[];           // as the sites name them, deduped, max 20
  description: string | null;
  vsArea: string | null;         // a site's own comparison, e.g. RentHop's "24% cheaper than the median…"
  roomShare: boolean;            // a room in a share, not a whole apartment
  scam: string[];                // scam signs a crawler saw, in plain words
};

// the craigslist actor's flags (actor/craigslist), as a cousin would say them
const SCAM: Record<string, string> = {
  price_far_below_norm: 'Rent is far below what the area goes for',
  deposit_before_viewing: 'Wants money before you see it',
  wire_or_p2p_payment: 'Asks for wire, Zelle or similar payment',
  owner_away: 'Owner says they are away and can\'t show it',
  foreign_or_whatsapp_contact: 'Wants you on WhatsApp or a foreign number',
};

const empty = (): Facts => ({
  pets: null, laundry: null, outdoor: null, noFee: null, rentStabilized: false, monthsFree: null,
  doorman: false, elevator: false, dishwasher: false, gym: false, walkUp: false,
  light: null, trains: [], amenities: [], description: null, vsArea: null, roomShare: false, scam: [],
});

/** every short string in raw (tags, badges, amenity lists), and the long ones as description */
function strings(raw: unknown, out: { tags: string[]; text: string[] } = { tags: [], text: [] }, key = '') {
  if (typeof raw === 'string') {
    if (/url|img|photo|image|phone|email|id$|^id|floorplan|search/i.test(key) || /^https?:/.test(raw)) return out;
    (raw.length > 80 ? out.text : out.tags).push(raw);
  } else if (Array.isArray(raw)) for (const v of raw) strings(v, out, key);
  else if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw)) strings(v, out, k === 'displayString' ? key : k);
  return out;
}

// "OpenKitchen" -> "Open kitchen"
const words = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim().replace(/^\w/, (m) => m.toUpperCase()).replace(/ \w/g, (m) => m.toLowerCase());

const AMENITY = /laundry|washer|dryer|w\/d|dishwasher|balcony|terrace|patio|roof|backyard|yard|garden|outdoor|doorman|door attendant|concierge|elevator|gym|fitness|pool|parking|garage|storage|bike|lounge|exposure|windows|ceiling|brick|hardwood|fireplace|walk.?in closet|renovated|stainless|central air|a\/c|air condition|furnished|\bviews?\b|\blight\b|\bsun(ny|light|lit)?\b/i;

export function factsFrom(raw: any): Facts {
  const f = empty();
  if (!raw || typeof raw !== 'object') return f;
  const { tags, text } = strings(raw);
  const all = [...tags, ...text].join(' \n ').toLowerCase();

  // pets: the most specific statement wins
  if (/no pets|pets not allowed|no dogs or cats/.test(all)) f.pets = 'none';
  const dogs = /dogs? (are )?(ok|allowed|welcome|friendly)|dog.friendly|dogs? - wooof/.test(all);
  const cats = /cats? (are )?(ok|allowed|welcome|friendly)|only cats|cats - purrr/.test(all);
  if (dogs && cats) f.pets = 'dogs_and_cats';
  else if (dogs) f.pets = 'dogs';
  else if (cats || /only cats/.test(all)) f.pets = 'cats';
  else if (/pets? (upon|on|with|subject to) approval|case.by.case|pet.friendly|pets (ok|allowed|welcome)/.test(all)) f.pets = f.pets ?? 'case_by_case';
  if (typeof raw.petPolicy === 'string' && /only cats/i.test(raw.petPolicy)) f.pets = 'cats';
  if (typeof raw.petsAllowed === 'boolean' && !raw.petsAllowed && !f.pets) f.pets = 'none';

  if (/(laundry|washer.{0,12}dryer|w\/d)( hookups?)? in (the )?(unit|apartment|residence)|in.unit (laundry|washer)|w\/d in unit|washer\/dryer in unit/.test(all)) f.laundry = 'in_unit';
  else if (/laundry (in|room|on)( the)? ?(building|site|every floor|premises)?|on.site laundry|shared laundry|laundry facilities/.test(all)) f.laundry = 'in_building';

  if (/private (outdoor|terrace|balcony|patio|yard|roof)|\bbalcony\b|\bterrace\b|\bpatio\b|private backyard/.test(all)) f.outdoor = 'private';
  else if (/(shared|common) (outdoor|backyard|yard|garden|roof)|roof ?(deck|top)|courtyard|backyard/.test(all)) f.outdoor = 'shared';

  if (/\bno (broker )?fee\b|no-fee|broker fee: none|\bfee.free\b/.test(all) || raw.incentives === 'No Fee') f.noFee = true;
  else if (raw.leasing_fee === 1 || /broker fee (applies|required)|\bfee: ?(1[0-5]|\d)%/.test(all)) f.noFee = f.noFee ?? null;

  const free = Number(raw.monthsFree) || Number(all.match(/(\d+(?:\.\d+)?) months? free/)?.[1]) || (/one month free|1 month free/.test(all) ? 1 : 0);
  if (free > 0) f.monthsFree = free;

  f.rentStabilized = /rent.stabili[sz]ed|stabilized (unit|apartment|lease)/.test(all) && !/not rent.stabili/.test(all);
  f.doorman = /doorman|door attendant|concierge|\bdoor ?man\b|full.time door/.test(all);
  f.elevator = /elevator/.test(all);
  f.walkUp = /walk.?up/.test(all) && !f.elevator;
  f.dishwasher = /dishwasher/.test(all);
  f.gym = /gym|fitness/.test(all);

  const exp = all.match(/(south(ern)?|east(ern)?|west(ern)?|north(ern)?)[ -]?(facing|exposure)/g);
  if (/floor.to.ceiling windows/.test(all)) f.light = 'Floor-to-ceiling windows';
  else if (exp?.some((e) => e.startsWith('south'))) f.light = 'Southern exposure';
  else if (/(tons of|lots of|abundant|great|natural|sun.?(drenched|filled|lit)|bright).{0,12}light|sun.?(drenched|filled)|sunny/.test(all)) f.light = 'Lots of light';
  else if (exp?.length) f.light = words(exp[0].replace(/(ern)?[ -]?(facing|exposure)/, '')) + 'ern exposure';

  if (Array.isArray(raw.subwayLines)) f.trains = raw.subwayLines.map(String);

  const seen = new Set<string>();
  for (const t of tags) {
    const w = words(t);
    if (w.length < 40 && AMENITY.test(w) && !/manager|review|listing|\d{4}-\d\d/i.test(w) && !seen.has(w.toLowerCase())) { seen.add(w.toLowerCase()); f.amenities.push(w); }
  }
  f.amenities = f.amenities.slice(0, 20);

  const desc = raw.description ?? raw.body ?? text.find((t) => t.length > 120);
  if (typeof desc === 'string') f.description = desc.replace(/\*\*/g, '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1500);
  if (typeof raw.priceComparison === 'string') f.vsArea = raw.priceComparison;
  const flags: string[] = Array.isArray(raw.flags) ? raw.flags : [];
  f.roomShare = flags.includes('room_or_share') || raw.roomShare === true;
  f.scam = flags.map((x) => SCAM[x]).filter(Boolean);
  return f;
}

/** Several sites' facts about one place, combined: known beats unknown, lists are joined. */
export function mergeFacts(list: Facts[]): Facts {
  const f = empty();
  for (const x of list) {
    f.pets = f.pets && f.pets !== 'case_by_case' ? f.pets : x.pets ?? f.pets;
    f.laundry = f.laundry === 'in_unit' ? f.laundry : x.laundry ?? f.laundry;
    f.outdoor = f.outdoor === 'private' ? f.outdoor : x.outdoor ?? f.outdoor;
    f.noFee = f.noFee ?? x.noFee;
    f.monthsFree = Math.max(f.monthsFree ?? 0, x.monthsFree ?? 0) || null;
    f.rentStabilized ||= x.rentStabilized; f.doorman ||= x.doorman; f.elevator ||= x.elevator; f.dishwasher ||= x.dishwasher; f.gym ||= x.gym; f.walkUp ||= x.walkUp;
    f.light = f.light ?? x.light;
    f.trains = [...new Set([...f.trains, ...x.trains])];
    f.amenities = [...new Set([...f.amenities, ...x.amenities])].slice(0, 20);
    if ((x.description?.length ?? 0) > (f.description?.length ?? 0)) f.description = x.description;
    f.vsArea = f.vsArea ?? x.vsArea;
    f.roomShare ||= x.roomShare;
    f.scam = [...new Set([...f.scam, ...x.scam])];
  }
  if (f.elevator) f.walkUp = false;
  return f;
}

/** Recompute one listing's facts from all its sightings. */
export async function refreshFacts(db: D1Database, ids: number[]) {
  if (!ids.length) return 0;
  // D1 allows 100 bound values per query
  const chunks = Array.from({ length: Math.ceil(ids.length / 90) }, (_, i) => ids.slice(i * 90, i * 90 + 90));
  const res = await db.batch(chunks.map((c) => db.prepare(`SELECT listing_id, raw FROM sightings WHERE listing_id IN (${c.map(() => '?').join(',')})`).bind(...c)));
  const by = new Map<number, Facts[]>(ids.map((id) => [id, []]));
  for (const r of res.flatMap((x) => x.results as { listing_id: number; raw: string }[])) { try { by.get(r.listing_id)?.push(factsFrom(JSON.parse(r.raw))); } catch { /* bad raw: skip */ } }
  const ups = [...by].map(([id, fs]) => {
    const f = mergeFacts(fs);
    // a site saying "no fee" in its tags fills the column the filters use
    return db.prepare(`UPDATE listings SET facts=?, no_fee=COALESCE(no_fee, ?) WHERE id=?`).bind(JSON.stringify(f), f.noFee == null ? null : f.noFee ? 1 : 0, id);
  });
  for (let i = 0; i < ups.length; i += 50) await db.batch(ups.slice(i, i + 50));
  return ups.length;
}

/* ── what to lead with ───────────────────────────────────────────────── */

export type Wants = { pets?: string | null; preferences?: string[] };
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

/**
 * What a realtor cousin would point out first, best first: a good deal, then the things that
 * make a place nice to live in. `typical` is the area's median rent for the same bedroom count.
 */
export function highlights(f: Facts | null, l: { price: number; noFee?: number | null; typical?: number | null }, w: Wants = {}): string[] {
  const out: string[] = [], x = f ?? empty();
  if (x.rentStabilized) out.push('Rent stabilized');
  if (l.typical && l.price <= l.typical * 0.9) out.push(`${money(l.typical - l.price)} under the area's usual`);
  if (x.monthsFree) out.push(`${x.monthsFree} month${x.monthsFree === 1 ? '' : 's'} free`);
  const want = (re: RegExp) => (w.preferences ?? []).some((p) => re.test(p));
  const nice: [boolean, string, boolean][] = [
    [x.laundry === 'in_unit', 'Washer/dryer in unit', want(/wash|laundry|w\/d/i)],
    [x.outdoor === 'private', 'Private outdoor space', want(/outdoor|balcony|terrace|yard|patio/i)],
    [!!w.pets && (x.pets === 'dogs_and_cats' || (x.pets ?? '').startsWith(w.pets.replace('_and_cats', ''))), w.pets === 'cats' ? 'Cats OK' : 'Dogs OK', true],
    [!!x.light, x.light ?? '', want(/light|sun|bright/i)],
    [x.doorman, 'Doorman', want(/doorman|door/i)],
    [x.dishwasher, 'Dishwasher', want(/dishwasher/i)],
    [x.outdoor === 'shared', 'Shared outdoor space', want(/outdoor|yard|roof/i)],
    [x.laundry === 'in_building', 'Laundry in building', want(/laundry/i)],
    [x.gym, 'Gym', want(/gym|fitness/i)],
  ];
  // what they asked for comes before what's merely nice
  for (const [has, label] of [...nice.filter((n) => n[2]), ...nice.filter((n) => !n[2])]) if (has && label && !out.includes(label)) out.push(label);
  if (l.noFee === 1 || x.noFee) out.push('No broker fee');
  return out;
}

export function petsLabel(p: Facts['pets']) {
  return p ? { dogs_and_cats: 'Dogs and cats OK', dogs: 'Dogs OK', cats: 'Cats only', case_by_case: 'Pets case by case', none: 'No pets' }[p] : null;
}

/** SQL: listings whose pet policy could work, given what this person has. Unknown stays in. */
/** SQL: whole apartments only (a room in a share isn't what anyone here is looking for) */
export const notShareSql = `COALESCE(json_extract(l.facts, '$.roomShare'), 0) = 0`;

/** Scam signs, including one any site can show: rent under 60% of the area's usual. */
export function scamSigns(f: Facts | null, price: number, typical: number | null) {
  const out = [...(f?.scam ?? [])];
  if (typical && price < typical * 0.6 && !out.includes(SCAM.price_far_below_norm)) out.push(SCAM.price_far_below_norm);
  return out;
}

export function petsSql(pets: string | null | undefined) {
  const ok = pets === 'dogs' ? ['dogs', 'dogs_and_cats', 'case_by_case'] : pets === 'cats' ? ['cats', 'dogs_and_cats', 'case_by_case'] : pets ? ['dogs_and_cats', 'case_by_case'] : null;
  return ok ? `(json_extract(l.facts, '$.pets') IS NULL OR json_extract(l.facts, '$.pets') IN (${ok.map((o) => `'${o}'`).join(',')}))` : null;
}

/** Median rent per neighbourhood and bedroom count, for "under the area's usual". */
export async function typicalRents(db: D1Database, hoods: string[]) {
  const names = new Set(hoods.filter(Boolean));
  const m = new Map<string, number>();
  if (!names.size) return m;
  // every active listing's area, beds and price: small at this scale, and no 100-variable limit
  const r = await db.prepare(`SELECT neighbourhood AS h, CAST(beds AS INTEGER) AS b, price FROM listings
                              WHERE status='active' AND price > 0 AND neighbourhood IS NOT NULL`).all<any>();
  r.results = r.results.filter((x) => names.has(x.h));
  const groups = new Map<string, number[]>();
  for (const x of r.results) { const k = `${x.h}|${x.b}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(x.price); }
  // a median from 4 or more listings; fewer isn't a fair comparison
  for (const [k, ps] of groups) if (ps.length >= 4) { ps.sort((a, b) => a - b); m.set(k, ps[Math.floor(ps.length / 2)]); }
  return m;
}
export const typicalKey = (hood: string | null, beds: number | null) => `${hood}|${Math.floor(beds ?? 0)}`;
