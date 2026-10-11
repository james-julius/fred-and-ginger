// Where a listing is, and whether that's somewhere this person wants. Sites name neighbourhoods
// their own way ("Bed Stuy", "Bedford-Stuyvesant, Brooklyn", "BEDSTUY/BROOKLYN"), so each
// listing's neighbourhood text is read for the areas it names, the most specific name first:
// "East Harlem" is East Harlem, not Harlem, and "East Williamsburg" isn't Williamsburg.
// A search for a neighbourhood only matches listings that name it; a borough matches everything
// in it. Slugs follow StreetEasy's where it has one, since the crawlers search with them.

type Borough = 'manhattan' | 'brooklyn' | 'queens' | 'bronx' | 'staten-island';
type Area = { borough: Borough; names: string[]; within?: string };

export const BOROUGHS: Record<Borough, string[]> = {
  manhattan: ['manhattan'], brooklyn: ['brooklyn', 'bklyn'], queens: ['queens'], bronx: ['bronx', 'the bronx'], 'staten-island': ['staten island'],
};

// slug -> borough, other names, and the bigger area it's part of
const AREAS: Record<string, Area> = {
  // Manhattan
  'financial-district': { borough: 'manhattan', names: ['fidi', 'wall street'] },
  'battery-park-city': { borough: 'manhattan', names: [] },
  tribeca: { borough: 'manhattan', names: [] },
  soho: { borough: 'manhattan', names: [] },
  noho: { borough: 'manhattan', names: [] },
  nolita: { borough: 'manhattan', names: [] },
  'little-italy': { borough: 'manhattan', names: [] },
  chinatown: { borough: 'manhattan', names: ['two bridges'] },
  'lower-east-side': { borough: 'manhattan', names: ['les'] },
  bowery: { borough: 'manhattan', names: [] },
  'east-village': { borough: 'manhattan', names: [] },
  'greenwich-village': { borough: 'manhattan', names: [] },
  'west-village': { borough: 'manhattan', names: [] },
  chelsea: { borough: 'manhattan', names: [] },
  flatiron: { borough: 'manhattan', names: ['flatiron district', 'nomad'] },
  gramercy: { borough: 'manhattan', names: ['gramercy park'] },
  'stuyvesant-town': { borough: 'manhattan', names: ['stuytown', 'stuy town', 'peter cooper village'] },
  'kips-bay': { borough: 'manhattan', names: [] },
  'murray-hill': { borough: 'manhattan', names: [] },
  midtown: { borough: 'manhattan', names: [] },
  'midtown-east': { borough: 'manhattan', names: ['turtle bay', 'sutton place'], within: 'midtown' },
  'midtown-west': { borough: 'manhattan', names: ['midtown south'], within: 'midtown' },
  'hells-kitchen': { borough: 'manhattan', names: ['hell s kitchen', 'clinton'], within: 'midtown-west' },
  'hudson-yards': { borough: 'manhattan', names: [], within: 'midtown-west' },
  'upper-east-side': { borough: 'manhattan', names: ['ues'] },
  'lenox-hill': { borough: 'manhattan', names: [], within: 'upper-east-side' },
  yorkville: { borough: 'manhattan', names: [], within: 'upper-east-side' },
  'carnegie-hill': { borough: 'manhattan', names: [], within: 'upper-east-side' },
  'upper-west-side': { borough: 'manhattan', names: ['uws'] },
  'lincoln-square': { borough: 'manhattan', names: [], within: 'upper-west-side' },
  'manhattan-valley': { borough: 'manhattan', names: [], within: 'upper-west-side' },
  'roosevelt-island': { borough: 'manhattan', names: [] },
  'morningside-heights': { borough: 'manhattan', names: ['morningside'] },
  'central-harlem': { borough: 'manhattan', names: ['harlem'] },
  'east-harlem': { borough: 'manhattan', names: ['spanish harlem', 'el barrio'] },
  'hamilton-heights': { borough: 'manhattan', names: ['sugar hill'] },
  'washington-heights': { borough: 'manhattan', names: ['wash hts', 'wash heights'] },
  inwood: { borough: 'manhattan', names: [] },
  // Brooklyn
  williamsburg: { borough: 'brooklyn', names: [] },
  'east-williamsburg': { borough: 'brooklyn', names: [] },
  greenpoint: { borough: 'brooklyn', names: [] },
  bushwick: { borough: 'brooklyn', names: [] },
  'bedford-stuyvesant': { borough: 'brooklyn', names: ['bed stuy', 'bedstuy', 'bedford stuyvesant'] },
  'stuyvesant-heights': { borough: 'brooklyn', names: [], within: 'bedford-stuyvesant' },
  'ocean-hill': { borough: 'brooklyn', names: [] },
  weeksville: { borough: 'brooklyn', names: [] },
  'clinton-hill': { borough: 'brooklyn', names: [] },
  'fort-greene': { borough: 'brooklyn', names: [] },
  'boerum-hill': { borough: 'brooklyn', names: [] },
  'cobble-hill': { borough: 'brooklyn', names: [] },
  'carroll-gardens': { borough: 'brooklyn', names: [] },
  'brooklyn-heights': { borough: 'brooklyn', names: [] },
  dumbo: { borough: 'brooklyn', names: [] },
  'downtown-brooklyn': { borough: 'brooklyn', names: [] },
  'park-slope': { borough: 'brooklyn', names: [] },
  'south-slope': { borough: 'brooklyn', names: [], within: 'park-slope' },
  gowanus: { borough: 'brooklyn', names: [] },
  'red-hook': { borough: 'brooklyn', names: [] },
  'prospect-heights': { borough: 'brooklyn', names: [] },
  'crown-heights': { borough: 'brooklyn', names: [] },
  'prospect-lefferts-gardens': { borough: 'brooklyn', names: ['plg', 'lefferts gardens'] },
  flatbush: { borough: 'brooklyn', names: [] },
  'east-flatbush': { borough: 'brooklyn', names: [] },
  'ditmas-park': { borough: 'brooklyn', names: [] },
  kensington: { borough: 'brooklyn', names: [] },
  'windsor-terrace': { borough: 'brooklyn', names: [] },
  greenwood: { borough: 'brooklyn', names: ['greenwood heights', 'green wood'] },
  'sunset-park': { borough: 'brooklyn', names: [] },
  'bay-ridge': { borough: 'brooklyn', names: [] },
  bensonhurst: { borough: 'brooklyn', names: [] },
  'bath-beach': { borough: 'brooklyn', names: [] },
  'borough-park': { borough: 'brooklyn', names: ['boro park'] },
  midwood: { borough: 'brooklyn', names: [] },
  'sheepshead-bay': { borough: 'brooklyn', names: [] },
  'brighton-beach': { borough: 'brooklyn', names: [] },
  'coney-island': { borough: 'brooklyn', names: [] },
  gravesend: { borough: 'brooklyn', names: [] },
  canarsie: { borough: 'brooklyn', names: [] },
  flatlands: { borough: 'brooklyn', names: [] },
  'east-new-york': { borough: 'brooklyn', names: ['east ny'] },
  'cypress-hills': { borough: 'brooklyn', names: ['cypres hills'] },
  brownsville: { borough: 'brooklyn', names: ['brownville'] },
  farragut: { borough: 'brooklyn', names: [] },
  // Queens
  astoria: { borough: 'queens', names: [] },
  'long-island-city': { borough: 'queens', names: ['lic', 'hunters point', 'hunter s point', 'hunter s point south'] },
  sunnyside: { borough: 'queens', names: [] },
  woodside: { borough: 'queens', names: [] },
  'jackson-heights': { borough: 'queens', names: [] },
  elmhurst: { borough: 'queens', names: [] },
  'east-elmhurst': { borough: 'queens', names: [] },
  corona: { borough: 'queens', names: [] },
  flushing: { borough: 'queens', names: [] },
  'forest-hills': { borough: 'queens', names: [] },
  'rego-park': { borough: 'queens', names: [] },
  'kew-gardens': { borough: 'queens', names: [] },
  'kew-gardens-hills': { borough: 'queens', names: ['kew garden hills'] },
  'fresh-meadows': { borough: 'queens', names: [] },
  bayside: { borough: 'queens', names: [] },
  whitestone: { borough: 'queens', names: [] },
  ridgewood: { borough: 'queens', names: [] },
  maspeth: { borough: 'queens', names: ['maspet'] },
  'middle-village': { borough: 'queens', names: [] },
  glendale: { borough: 'queens', names: [] },
  jamaica: { borough: 'queens', names: [] },
  'jamaica-hills': { borough: 'queens', names: [], within: 'jamaica' },
  'richmond-hill': { borough: 'queens', names: [] },
  'ozone-park': { borough: 'queens', names: [] },
  'howard-beach': { borough: 'queens', names: [] },
  woodhaven: { borough: 'queens', names: [] },
  rockaway: { borough: 'queens', names: ['rockaways'] },
  'far-rockaway': { borough: 'queens', names: ['far rockawy'], within: 'rockaway' },
  'rockaway-park': { borough: 'queens', names: [], within: 'rockaway' },
  arverne: { borough: 'queens', names: [], within: 'rockaway' },
  hollis: { borough: 'queens', names: [] },
  'cambria-heights': { borough: 'queens', names: [] },
  rosedale: { borough: 'queens', names: [] },
  'queens-village': { borough: 'queens', names: [] },
  'little-neck': { borough: 'queens', names: [] },
  douglaston: { borough: 'queens', names: [] },
  bellerose: { borough: 'queens', names: ['bellerose manor'] },
  'oakland-gardens': { borough: 'queens', names: ['ockland garden'] },
  // the Bronx
  'mott-haven': { borough: 'bronx', names: [] },
  'port-morris': { borough: 'bronx', names: [] },
  concourse: { borough: 'bronx', names: ['grand concourse', 'yankee stadium'] },
  'south-bronx': { borough: 'bronx', names: [] },
  fordham: { borough: 'bronx', names: [] },
  kingsbridge: { borough: 'bronx', names: [] },
  riverdale: { borough: 'bronx', names: [] },
  'pelham-bay': { borough: 'bronx', names: [] },
};

/** lower case, words only: "Hell's Kitchen" and "hells-kitchen" both become "hell s kitchen" */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const words = (slug: string) => slug.replace(/-/g, ' ');

// every name, longest first, so the most specific one claims the words
const NAMES: [string, string][] = [
  ...Object.entries(AREAS).flatMap(([slug, a]) => [words(slug), ...a.names].map((n) => [norm(n), slug] as [string, string])),
  ...Object.entries(BOROUGHS).flatMap(([slug, ns]) => ns.map((n) => [norm(n), slug] as [string, string])),
  // "hells kitchen" written without the apostrophe
  ['hells kitchen', 'hells-kitchen'] as [string, string],
].sort((a, b) => b[0].length - a[0].length);

const isBorough = (s: string): s is Borough => s in BOROUGHS;

/** The areas (and boroughs) a piece of neighbourhood text names, most specific name first. */
export function areasIn(text: string | null | undefined): string[] {
  let t = ` ${norm(text ?? '')} `;
  const out: string[] = [];
  for (const [name, slug] of NAMES) {
    const at = t.indexOf(` ${name} `);
    if (at === -1) continue;
    if (!out.includes(slug)) out.push(slug);
    t = t.slice(0, at) + ' ' + '#'.repeat(name.length) + ' ' + t.slice(at + name.length + 2);
  }
  return out;
}

/**
 * The standard slug for whatever someone typed or said: "Spanish Harlem" -> "east-harlem",
 * "Bed Stuy" -> "bedford-stuyvesant". Something we don't know stays as its own slug.
 */
export function canonicalArea(s: string): string {
  const n = norm(s), hit = NAMES.find(([name]) => name === n);
  return hit ? hit[1] : n.replace(/ /g, '-');
}

export const knownArea = (slug: string) => slug in AREAS || isBorough(slug);

/** an area and every bigger area it's part of: hells-kitchen -> midtown-west -> midtown */
function lineage(slug: string): string[] {
  const out = [slug];
  for (let a = AREAS[slug]; a?.within; a = AREAS[a.within]) out.push(a.within);
  return out;
}

function boroughOf(slug: string): Borough | null {
  return isBorough(slug) ? slug : AREAS[slug]?.borough ?? null;
}

/**
 * Is a listing in this area? A borough matches on the listing's borough, or, when a site didn't
 * say, on the neighbourhood it names. A neighbourhood matches when the listing names it or a part
 * of it. A slug we don't know matches listings whose neighbourhood says those words.
 */
export function inArea(listing: { borough: string | null; neighbourhood: string | null }, want: string): boolean {
  const slug = canonicalArea(want), named = areasIn(listing.neighbourhood);
  if (isBorough(slug)) {
    const b = listing.borough ? canonicalArea(listing.borough) : null;
    if (b && isBorough(b)) return b === slug;
    return named.some((n) => boroughOf(n) === slug);
  }
  if (knownArea(slug)) return named.some((n) => lineage(n).includes(slug));
  return ` ${norm(listing.neighbourhood ?? '')} `.includes(` ${words(slug)} `);
}

/** Is `inner` entirely inside `outer`? Lets Fred narrow a search but never widen it. */
export function within(inner: string, outer: string): boolean {
  const i = canonicalArea(inner), o = canonicalArea(outer);
  if (i === o) return true;
  if (isBorough(o)) return boroughOf(i) === o;
  return knownArea(i) && lineage(i).includes(o);
}

/* ── SQL ──────────────────────────────────────────────────────────────── */

type Place = { borough: string | null; neighbourhood: string | null };
let places: { at: number; rows: Place[] } | null = null;

/** every borough + neighbourhood pair among active listings: a few hundred, cached a few minutes */
async function placesIn(db: D1Database): Promise<Place[]> {
  if (places && Date.now() - places.at < 5 * 60_000) return places.rows;
  const r = await db.prepare(`SELECT DISTINCT borough, neighbourhood FROM listings WHERE status='active'`).all<Place>();
  places = { at: Date.now(), rows: r.results };
  return r.results;
}
/** for tests */
export const forgetPlaces = () => { places = null; };

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const key = (p: Place) => `${p.borough ?? ''}|${p.neighbourhood ?? ''}`;
const KEY_SQL = `(COALESCE(l.borough, '') || '|' || COALESCE(l.neighbourhood, ''))`;

/**
 * SQL for "in one of these areas and none of those", on listings aliased `l`. The matching is
 * done here against the distinct place names, then inlined as literals: no LIKE guessing, and
 * no 100-variable limit. Null when there's nothing to filter.
 */
export async function areaSql(db: D1Database, areas: string[] | undefined, exclude: string[] | undefined): Promise<string | null> {
  const want = (areas ?? []).filter(Boolean), not = (exclude ?? []).filter(Boolean);
  if (!want.length && !not.length) return null;
  const rows = await placesIn(db);
  const ok = rows.filter((p) => (!want.length || want.some((a) => inArea(p, a))) && !not.some((a) => inArea(p, a)));
  if (!ok.length) return '0';
  return `${KEY_SQL} IN (${ok.map((p) => lit(key(p))).join(',')})`;
}
