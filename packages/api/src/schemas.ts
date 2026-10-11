// The shapes the Fred app and the API agree on. Change them here, then run `npm run gen:api`
// at the repo root: that rebuilds openapi.json and web/lib/api/schema.gen.ts.
import { z } from '@hono/zod-openapi';

const iso = z.string().openapi({ format: 'date-time', example: '2026-10-11T14:30:00Z' });
const money = z.number().int().openapi({ description: 'US dollars, whole' });

/* ── you ─────────────────────────────────────────────────────────────── */

export const AlertMode = z.enum(['instant_strong', 'daily', 'off']).openapi('AlertMode', {
  description: 'instant_strong = message me about strong fits right away; daily = one digest; off = only in the app',
});

export const AlertChannel = z.enum(['email', 'sms']).openapi('AlertChannel');

const deliveryFields = {
  enabled: z.boolean().openapi({ description: 'The person wants alerts here. Nothing is sent until verified is true too.' }),
  verified: z.boolean().openapi({ description: 'They entered the code sent to this address or number' }),
  available: z.boolean().openapi({ description: "False when we can't send on this channel yet (texts, for now)" }),
};

export const Alerts = z.object({
  mode: AlertMode,
  quietHours: z.object({ start: z.string(), end: z.string() }).nullable().openapi({ example: { start: '22:00', end: '08:00' }, description: 'New York time; alerts wait until it ends' }),
  email: z.object({ address: z.string().nullable().openapi({ example: 'erin@example.com' }), ...deliveryFields }).openapi('EmailAlerts'),
  sms: z.object({ number: z.string().nullable().openapi({ example: '+12125551234', description: 'E.164' }), ...deliveryFields }).openapi('SmsAlerts'),
}).openapi('Alerts');

export const AlertsPatch = z.object({
  mode: AlertMode.optional(),
  quietHours: Alerts.shape.quietHours.optional(),
  email: z.object({ address: z.string().trim().email().max(254).optional(), enabled: z.boolean().optional() }).optional()
    .openapi({ description: 'A new address is saved unverified and a 6-digit code is emailed to it' }),
  sms: z.object({ number: z.string().trim().min(7).max(20).optional(), enabled: z.boolean().optional() }).optional()
    .openapi({ description: 'A new number is saved unverified. US numbers can be given as 10 digits.' }),
}).openapi('AlertsPatch');

export const AlertsVerify = z.object({ channel: AlertChannel, code: z.string().trim().regex(/^\d{6}$/, '6 digits') }).openapi('AlertsVerify');
export const AlertsChannelRequest = z.object({ channel: AlertChannel }).openapi('AlertsChannelRequest');
export const CodeSent = z.object({
  sentTo: z.string().openapi({ example: 'j•••@gmail.com' }),
  expiresAt: z.string().openapi({ format: 'date-time' }),
}).openapi('CodeSent');

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

/* ── what Fred remembers about you ───────────────────────────────────── */

export const MemoryKind = z.enum(['likes', 'dislikes', 'needs', 'life', 'timing', 'working_style']).openapi('MemoryKind', {
  description: 'likes/dislikes: in a place; needs: must be true; life: who they are (work, partner, pets, commute); timing: move dates, lease ends; working_style: how they like Fred to work',
});

export const Memory = z.object({
  id: z.string().openapi({ example: 'm_3fa9c1' }),
  kind: MemoryKind,
  text: z.string().openapi({ example: 'Prefers 2 baths; 1 is acceptable', description: 'Distilled by Fred in his own words, never a quote' }),
  strength: z.enum(['must', 'strong', 'mild']),
  from: z.enum(['said', 'inferred']).openapi({ description: 'said: the person told Fred; inferred: Fred read it from what they saved and passed' }),
  updatedAt: iso,
}).openapi('Memory');

export const MemoryList = z.object({ items: z.array(Memory) }).openapi('MemoryList');

export const MemoryPatch = z.object({
  text: z.string().trim().min(3).max(160).optional(),
  kind: MemoryKind.optional(),
  strength: Memory.shape.strength.optional(),
}).openapi('MemoryPatch');

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
