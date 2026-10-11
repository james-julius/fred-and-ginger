// The shapes the Fred app and the API agree on. Change them here, then run `npm run gen:api`
// at the repo root: that rebuilds openapi.json and web/lib/api/schema.gen.ts.
import { z } from '@hono/zod-openapi';

const iso = z.string().openapi({ format: 'date-time', example: '2026-10-11T14:30:00Z' });
const money = z.number().int().openapi({ description: 'US dollars, whole' });

/* ── you ─────────────────────────────────────────────────────────────── */

export const AlertMode = z.enum(['instant_strong', 'daily', 'off']).openapi('AlertMode', {
  description: 'instant_strong = message me about strong fits right away; daily = one digest; off = only in the app',
});

export const Alerts = z.object({
  mode: AlertMode,
  channel: z.enum(['email', 'sms', 'push']),
  quietHours: z.object({ start: z.string(), end: z.string() }).nullable().openapi({ example: { start: '22:00', end: '08:00' } }),
}).openapi('Alerts');

export const Me = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    initials: z.string(),
    photo: z.string().nullable().openapi({ description: 'Profile photo: an https image URL, or a data:image URL the app sends (small, about 256px square)' }),
  }),
  summary: z.string().openapi({ example: 'Manhattan · 2 bed, 2 bath' }),
  counts: z.object({
    new: z.number().int().openapi({ description: 'Unseen places in the inbox' }),
    saved: z.number().int(),
    tours: z.number().int().openapi({ description: 'Upcoming tours' }),
  }),
  alerts: Alerts,
}).openapi('Me');

export const MePatch = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  photo: z.string().max(300_000).regex(/^(https:\/\/|data:image\/(png|jpeg|webp);base64,)/, 'an https or data:image URL')
    .nullable().optional().openapi({ description: 'null removes the photo' }),
}).openapi('MePatch');

/* ── your search ─────────────────────────────────────────────────────── */

export const Dealbreakers = z.object({
  areas: z.array(z.string()).openapi({ example: ['manhattan'], description: 'Borough or neighbourhood slugs' }),
  excludeAreas: z.array(z.string()).optional().openapi({ example: ['central-harlem'], description: 'Borough or neighbourhood slugs to leave out, even inside `areas`' }),
  maxTotalMonthly: money.nullable().openapi({ description: 'Budget including required monthly fees' }),
  minBeds: z.number().nullable(),
  minBaths: z.number().nullable(),
  pets: z.enum(['dogs', 'cats', 'dogs_and_cats']).nullable(),
  noBrokerFee: z.boolean(),
  moveBy: z.string().nullable().openapi({ format: 'date' }),
}).openapi('Dealbreakers');

export const Preference = z.object({
  id: z.string(),
  label: z.string().openapi({ example: 'Washer/dryer in unit' }),
  weight: z.enum(['nice', 'important']),
}).openapi('Preference');

export const Commute = z.object({
  id: z.string(),
  label: z.string().openapi({ example: 'Work' }),
  address: z.string(),
  maxMinutes: z.number().int().nullable(),
}).openapi('Commute');

export const Search = z.object({
  dealbreakers: Dealbreakers,
  preferences: z.array(Preference),
  commutes: z.array(Commute),
  watching: z.boolean().openapi({ description: 'False pauses new-place checks' }),
  updatedAt: iso,
}).openapi('Search');

export const SearchPatch = z.object({
  dealbreakers: Dealbreakers.partial().optional(),
  preferences: z.array(Preference).optional(),
  commutes: z.array(Commute).optional(),
  watching: z.boolean().optional(),
}).openapi('SearchPatch');

/* ── places ──────────────────────────────────────────────────────────── */

export const Verdict = z.object({
  kind: z.enum(['strong_fit', 'good_fit', 'over_budget_with_fees', 'price_dropped', 'broker_fee', 'building_issues', 'likely_scam', 'gone']),
  label: z.string().openapi({ example: 'Strong fit' }),
  tone: z.enum(['good', 'warn', 'bad', 'neutral']),
  reason: z.string().nullable().openapi({ example: 'Asked for a deposit before a viewing' }),
}).openapi('Verdict');

export const Transit = z.object({
  lines: z.array(z.string()).openapi({ example: ['A'] }),
  station: z.string(),
  walkMinutes: z.number().int(),
}).openapi('Transit');

export const FeeCallout = z.object({
  label: z.string().openapi({ example: '+$85/mo amenity fee' }),
  amount: money,
  period: z.enum(['monthly', 'once']),
}).openapi('FeeCallout');

export const OpportunityStatus = z.enum(['new', 'saved', 'passed', 'hidden']).openapi('OpportunityStatus');

export const OpportunityCard = z.object({
  id: z.string(),
  listingId: z.number().int(),
  foundAt: iso,
  seen: z.boolean(),
  status: OpportunityStatus,
  price: money.openapi({ description: 'Rent on the lease' }),
  totalMonthly: money.nullable().openapi({ description: 'Rent plus required monthly fees' }),
  area: z.string().openapi({ example: 'Hudson Heights' }),
  beds: z.number(),
  baths: z.number().nullable(),
  transit: Transit.nullable(),
  highlight: z.string().nullable().openapi({ example: 'Washer/dryer in unit' }),
  thumbnail: z.string().url().nullable().openapi({ description: 'Null: show the building illustration' }),
  fit: z.number().int().min(0).max(100),
  verdict: Verdict,
  feeCallout: FeeCallout.nullable(),
}).openapi('OpportunityCard');

export const FeeItem = z.object({
  kind: z.enum(['amenity', 'pet', 'utilities', 'parking', 'broker', 'application', 'security_deposit', 'move_in', 'board', 'other']),
  label: z.string(),
  amount: money.nullable(),
  period: z.enum(['monthly', 'once']),
  required: z.boolean(),
  source: z.enum(['listing', 'read_from_text']).openapi({ description: 'read_from_text = pulled from the description, less certain' }),
}).openapi('FeeItem');

export const Costs = z.object({
  rent: money,
  netEffective: money.nullable(),
  monthsFree: z.number().nullable(),
  leaseMonths: z.number().int().nullable(),
  monthlyFees: money,
  totalMonthly: money,
  brokerFee: z.enum(['none', 'tenant', 'unknown']),
  moveInEstimate: money.nullable(),
  fees: z.array(FeeItem),
}).openapi('Costs');

export const SourceLink = z.object({
  site: z.string().openapi({ example: 'streeteasy' }),
  url: z.string().url(),
  price: money.nullable(),
}).openapi('SourceLink');

export const BuildingReport = z.object({
  score: z.number().int().min(0).max(100),
  flags: z.array(z.string()).openapi({ example: ['3 open heat complaints this year'] }),
  good: z.array(z.string()),
}).openapi('BuildingReport');

export const Safety = z.object({
  level: z.enum(['much_lower', 'lower', 'typical', 'higher', 'much_higher']),
  label: z.string().openapi({ example: 'Less crime than most places for rent' }),
  percentile: z.number().int().min(0).max(100).openapi({ description: 'Share of rental spots we checked with fewer violent crimes nearby' }),
  violent: z.number().int().openapi({ description: 'Murder, robbery, felony assault and kidnapping reported nearby' }),
  property: z.number().int().openapi({ description: 'Burglary, larceny and car theft reported nearby' }),
  total: z.number().int().openapi({ description: 'Every crime reported nearby' }),
  top: z.array(z.object({ offense: z.string(), count: z.number().int() })).openapi({ description: 'Most reported, in plain words' }),
  radiusMeters: z.number().int().openapi({ example: 300 }),
  from: z.string().openapi({ format: 'date' }),
  to: z.string().openapi({ format: 'date', description: 'NYPD data is published quarterly, so this lags by a few months' }),
}).openapi('Safety', { description: 'Crimes reported to the NYPD near the place over 12 months (NYC Open Data). Rape and sex crimes are left out because the NYPD masks their locations.' });

export const OpportunityDetail = OpportunityCard.extend({
  address: z.string(),
  unit: z.string().nullable(),
  sqft: z.number().int().nullable(),
  available: z.string().nullable().openapi({ format: 'date' }),
  description: z.string().nullable(),
  photos: z.array(z.string().url()),
  costs: Costs,
  amenities: z.array(z.string()),
  pets: z.string().nullable(),
  building: BuildingReport.nullable(),
  sources: z.array(SourceLink),
  priceHistory: z.array(z.object({ at: iso, price: money })),
  take: z.object({
    why: z.array(z.string()).openapi({ description: "Fred's reasons this fits you" }),
    concerns: z.array(z.string()),
  }),
  note: z.string().nullable(),
  location: z.object({ lat: z.number(), lon: z.number() }).nullable(),
  safety: Safety.nullable().openapi({ description: 'Null until the area has been checked' }),
}).openapi('OpportunityDetail');

export const OpportunityPatch = z.object({
  seen: z.boolean().optional(),
  status: OpportunityStatus.optional(),
  note: z.string().nullable().optional(),
}).openapi('OpportunityPatch');

export const OpportunityPage = z.object({
  items: z.array(OpportunityCard),
  nextCursor: z.string().nullable(),
}).openapi('OpportunityPage');

/* ── tours ───────────────────────────────────────────────────────────── */

export const Tour = z.object({
  id: z.string(),
  opportunityId: z.string(),
  startsAt: iso.nullable().openapi({ description: 'Null until a time is confirmed' }),
  address: z.string().openapi({ example: 'Cabrini Blvd, Hudson Heights' }),
  status: z.enum(['draft', 'requested', 'confirmed', 'done', 'cancelled']),
  contact: z.string().nullable(),
  notes: z.string().nullable(),
}).openapi('Tour');

export const TourRequest = z.object({
  opportunityId: z.string(),
  slots: z.array(z.object({ start: iso, end: iso })).min(1),
}).openapi('TourRequest');

export const TourPatch = z.object({
  status: Tour.shape.status.optional(),
  startsAt: iso.nullable().optional(),
  notes: z.string().nullable().optional(),
}).openapi('TourPatch');

/* ── application packet ──────────────────────────────────────────────── */

export const PacketItem = z.object({
  kind: z.enum(['photo_id', 'pay_stubs', 'tax_return', 'bank_statements', 'employment_letter', 'reference_letter', 'guarantor', 'other']),
  label: z.string(),
  status: z.enum(['missing', 'uploaded', 'expired']),
  documentId: z.string().nullable(),
  updatedAt: iso.nullable(),
}).openapi('PacketItem');

export const Packet = z.object({ items: z.array(PacketItem) }).openapi('Packet');

/* ── chat ────────────────────────────────────────────────────────────── */

export const Thread = z.object({ id: z.string(), title: z.string(), updatedAt: iso }).openapi('Thread');

// Custom parts inside a chat message. The AI SDK names them data-<key>; the keys below are the <key>.
export const DataSearchUpdated = z.object({
  changed: z.array(z.string()).openapi({ example: ['areas', 'maxTotalMonthly', 'minBeds', 'minBaths', 'pets'] }),
  dealbreakers: Dealbreakers,
}).openapi('DataSearchUpdated', { description: 'Chat part data-search-updated: the Dealbreakers chips' });

export const DataScan = z.object({
  checked: z.number().int(),
  matched: z.number().int(),
  hidden: z.number().int(),
  steps: z.array(z.object({ label: z.string(), toolCallId: z.string().nullable() })),
}).openapi('DataScan', { description: 'Chat part data-scan: "Checked 186 new listings · 9 steps"' });

export const DataSuggestions = z.object({
  options: z.array(z.object({ label: z.string(), patch: SearchPatch.nullable() })),
}).openapi('DataSuggestions', { description: 'Chat part data-suggestions: quick replies. Tapping one sends its label as a message.' });

export const DataWatch = z.object({
  state: z.enum(['watching', 'paused', 'checking']),
  lastCheckedAt: iso.nullable(),
  nextCheckAt: iso.nullable(),
}).openapi('DataWatch', { description: 'Chat part data-watch: "Watching for new places…". Also sent as an event.' });

export const ChatRequest = z.object({
  threadId: z.string(),
  message: z.unknown().openapi({ description: 'The newest AI SDK UIMessage only; the server keeps the history' }),
  context: z.object({ opportunityId: z.string() }).nullable().optional(),
}).openapi('ChatRequest');

/* ── live events (GET /api/events, server-sent) ──────────────────────── */

export const Event = z.discriminatedUnion('type', [
  z.object({ type: z.literal('opportunity.created'), opportunity: OpportunityCard }),
  z.object({ type: z.literal('opportunity.updated'), opportunity: OpportunityCard }),
  z.object({ type: z.literal('tour.updated'), tour: Tour }),
  z.object({ type: z.literal('search.updated'), search: Search }),
  z.object({ type: z.literal('watch'), watch: DataWatch }),
  z.object({ type: z.literal('counts'), counts: Me.shape.counts }),
]).openapi('Event');

export const ErrorBody = z.object({ error: z.string() }).openapi('Error');
