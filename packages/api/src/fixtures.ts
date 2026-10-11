// Example data matching the Fred mockup. The API serves it while the real backend is built,
// so every screen can be designed against it. Dates are relative to `now`.
import type { z } from '@hono/zod-openapi';
import type * as S from './schemas';

type T<K extends keyof typeof S> = (typeof S)[K] extends z.ZodType ? z.infer<(typeof S)[K]> : never;

export function fixtures(now = new Date()) {
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3600_000).toISOString();
  const tomorrow830 = new Date(now); tomorrow830.setDate(now.getDate() + 1); tomorrow830.setHours(8, 30, 0, 0);

  const dealbreakers: T<'Dealbreakers'> = {
    areas: ['manhattan'], maxTotalMonthly: 5000, minBeds: 2, minBaths: 2, pets: 'dogs', noBrokerFee: false, moveBy: null,
  };

  const search: T<'Search'> = {
    dealbreakers,
    preferences: [
      { id: 'p1', label: 'Washer/dryer in unit', weight: 'important' },
      { id: 'p2', label: 'Near a park', weight: 'nice' },
    ],
    commutes: [{ id: 'c1', label: 'Work', address: '1 World Trade Center, New York, NY', maxMinutes: 40 }],
    watching: true,
    updatedAt: at(1),
  };

  const alerts: T<'Alerts'> = { mode: 'instant_strong', channel: 'push', quietHours: { start: '22:00', end: '08:00' } };

  const strong = (reason: string | null = null): T<'Verdict'> => ({ kind: 'strong_fit', label: 'Strong fit', tone: 'good', reason });

  const cards: T<'OpportunityCard'>[] = [
    { id: 'op_hudson', listingId: 101, foundAt: at(2), seen: false, status: 'new', price: 4750, totalMonthly: 4750,
      area: 'Hudson Heights', beds: 2, baths: 2, transit: { lines: ['A'], station: '181 St', walkMinutes: 5 },
      highlight: 'Washer/dryer in unit', thumbnail: null, fit: 92, verdict: strong(), feeCallout: null },
    { id: 'op_inwood', listingId: 102, foundAt: at(4), seen: false, status: 'new', price: 4600, totalMonthly: 4600,
      area: 'Inwood', beds: 2, baths: 2, transit: { lines: ['1'], station: '207 St', walkMinutes: 7 },
      highlight: 'Laundry in building', thumbnail: null, fit: 88, verdict: strong(), feeCallout: null },
    { id: 'op_harlem', listingId: 103, foundAt: at(26), seen: false, status: 'new', price: 4950, totalMonthly: 5035,
      area: 'Harlem', beds: 2, baths: 2, transit: { lines: ['B', 'C'], station: '135 St', walkMinutes: 3 },
      highlight: null, thumbnail: null, fit: 74,
      verdict: { kind: 'over_budget_with_fees', label: 'Over budget with fees', tone: 'warn', reason: '$35 over with the amenity fee' },
      feeCallout: { label: '+$85/mo amenity fee', amount: 85, period: 'monthly' } },
    { id: 'op_uws', listingId: 104, foundAt: at(30), seen: true, status: 'hidden', price: 3200, totalMonthly: 3200,
      area: 'Upper West Side', beds: 2, baths: 2, transit: null, highlight: null, thumbnail: null, fit: 0,
      verdict: { kind: 'likely_scam', label: 'Hidden: likely scam', tone: 'bad', reason: 'Asked for a deposit before a viewing' },
      feeCallout: null },
  ];

  const details: Record<string, T<'OpportunityDetail'>> = {
    op_hudson: {
      ...cards[0], address: '180 Cabrini Blvd', unit: '4F', sqft: 950, available: '2026-11-15',
      description: 'Pre-war two bed, two bath with washer/dryer, renovated kitchen and park views. Dogs welcome.',
      // Free Unsplash photos so the gallery has something to show; real listings bring their own.
      photos: ['https://images.unsplash.com/photo-1722650272764-08d92d193a9c?auto=format&fit=crop&q=75',
               'https://images.unsplash.com/photo-1757742690834-aa581b9f53b2?auto=format&fit=crop&q=75',
               'https://images.unsplash.com/photo-1630699376167-3870469e7598?auto=format&fit=crop&q=75',
               'https://images.unsplash.com/photo-1649068559107-e5d936141e44?auto=format&fit=crop&q=75'],
      amenities: ['Washer/dryer in unit', 'Dishwasher', 'Elevator', 'Pets allowed'], pets: 'Dogs and cats allowed',
      costs: { rent: 4750, netEffective: null, monthsFree: null, leaseMonths: 12, monthlyFees: 0, totalMonthly: 4750,
               brokerFee: 'none', moveInEstimate: 9520,
               fees: [{ kind: 'security_deposit', label: 'Security deposit', amount: 4750, period: 'once', required: true, source: 'listing' },
                      { kind: 'application', label: 'Application fee', amount: 20, period: 'once', required: true, source: 'listing' }] },
      building: { score: 94, flags: [], good: ['No open heat or hot water complaints', 'No evictions in 3 years'] },
      sources: [{ site: 'streeteasy', url: 'https://streeteasy.com/', price: 4750 }],
      priceHistory: [{ at: at(2), price: 4750 }],
      take: { why: ['2 baths under $5,000, rare in Manhattan', 'Washer/dryer in unit', '5 minutes to the A'], concerns: ['Above 110th St'] },
      note: null, location: { lat: 40.8551, lon: -73.9375 },
    },
  };

  const tours: T<'Tour'>[] = [
    { id: 'tour_1', opportunityId: 'op_hudson', startsAt: tomorrow830.toISOString(), address: 'Cabrini Blvd, Hudson Heights',
      status: 'confirmed', contact: 'Leasing office', notes: null },
  ];

  const packet: T<'Packet'> = { items: [
    { kind: 'photo_id', label: 'Photo ID', status: 'uploaded', documentId: 'doc_1', updatedAt: at(48) },
    { kind: 'pay_stubs', label: 'Two recent pay stubs', status: 'missing', documentId: null, updatedAt: null },
    { kind: 'tax_return', label: 'Last tax return', status: 'missing', documentId: null, updatedAt: null },
    { kind: 'bank_statements', label: 'Two bank statements', status: 'missing', documentId: null, updatedAt: null },
    { kind: 'employment_letter', label: 'Employment letter', status: 'missing', documentId: null, updatedAt: null },
  ] };

  const me: T<'Me'> = {
    user: { id: 'user_demo', name: 'Jordan Lee', initials: 'JL' },
    summary: 'Manhattan · 2 bed, 2 bath',
    counts: { new: cards.filter((c) => c.status === 'new' && !c.seen).length, saved: 0, tours: tours.length },
    alerts,
  };

  const threads: T<'Thread'>[] = [{ id: 'thread_1', title: 'Manhattan 2 bed, 2 bath', updatedAt: at(1) }];

  // The mockup's chat turn, as AI SDK UIMessages with Fred's custom parts.
  const messages = [
    { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'I want an apartment under 5k in manhattan with 2 beds 2 baths and it has to be dog friendly' }] },
    { id: 'm2', role: 'assistant', parts: [
      { type: 'data-search-updated', data: { changed: ['areas', 'maxTotalMonthly', 'minBeds', 'minBaths', 'pets'], dealbreakers } satisfies T<'DataSearchUpdated'> },
      { type: 'data-scan', data: { checked: 186, matched: 3, hidden: 1, steps: [
        { label: 'Searched Manhattan, 2 bed 2 bath, up to $5,000', toolCallId: null },
        { label: 'Kept places that allow dogs', toolCallId: null },
        { label: 'Checked fees on 12 listings', toolCallId: null },
        { label: 'Checked 3 buildings with city records', toolCallId: null },
        { label: 'Hid 1 likely scam', toolCallId: null },
      ] } satisfies T<'DataScan'> },
      { type: 'text', text: "Two baths under $5,000 is rare in Manhattan. I found 3 that allow dogs, all above 110th St. They're in your inbox, and I hid 1 that looked like a scam.\n\nWant me to widen the search?" },
      { type: 'data-suggestions', data: { options: [
        { label: 'Allow 1.5 baths', patch: { dealbreakers: { minBaths: 1.5 } } },
        { label: 'Add Long Island City', patch: { dealbreakers: { areas: ['manhattan', 'long-island-city'] } } },
        { label: 'Keep it as is', patch: null },
      ] } satisfies T<'DataSuggestions'> },
      { type: 'data-watch', data: { state: 'watching', lastCheckedAt: at(0.2), nextCheckAt: new Date(now.getTime() + 2 * 3600_000).toISOString() } satisfies T<'DataWatch'> },
    ] },
  ];

  return { me, search, alerts, cards, details, tours, packet, threads, messages };
}
