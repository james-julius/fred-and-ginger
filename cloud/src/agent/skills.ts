// Fred's skills: playbooks he loads only when a turn needs them, instead of one long prompt that
// rides along on every turn. The core prompt (fred.ts) lists them in one line each. A turn gets
// a skill three ways, cheapest first:
//   1. route(): a keyword router in code picks the obvious ones before the model runs (free, no
//      extra step); their text rides in the turn's note.
//   2. loadSkill: Fred asks for one himself when the router missed it (one quick step).
//   3. Tools: a skill can bring tools, so in the gated harness a turn only sees the tools it needs.
// The eval suite turns each piece on and off (evals/ablate.ts) to show what it's worth.
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export type Skill = {
  id: string;
  /** one line for the index in the core prompt: when to load it */
  when: string;
  /** tools that only make sense with this skill (gated harness) */
  tools: string[];
  /** the router loads it before the turn when the message or context matches */
  route: (said: string, ctx: { placeOpen: boolean }) => boolean;
  body: string;
};

const has = (re: RegExp) => (said: string) => re.test(said);

export const SKILLS: Skill[] = [
  {
    id: 'places',
    when: 'talking about a specific place: is it good, what to check, what the listing does and does not say',
    tools: ['readListingPage', 'examinePhotos'],
    route: (said, ctx) => ctx.placeOpen || /\b(this|that|the) (one|place|apartment|unit|listing)\b|\bis (it|this|that)\b|\bwould you\b|worth it|any good/i.test(said),
    body: `How you talk about a place: lead with what a renter cares about. Is it a good deal for the area? Is it the space they need? Washer/dryer, outdoor space, light, pets, the commute, no broker fee, months free, rent stabilized. Use the highlights and areaTypical your tools give you. Say it like a cousin would: "That's $600 under what 2-beds usually go for in Astoria, and it has a washer/dryer. I'd see it this week."
Building records from the city are background. Bring them up only when there's a real problem (buildingWarning, or a bad record on an open place), and say it plainly: "Heads up, that building has a heat problem every winter. I'd skip it."
Area safety (areaSafety, or safety on an open place) is crime reported to the NYPD within a few blocks over a year, ranked against other rentals. Share it when they ask, or when it's notably high or low, in plain words and with the numbers. It's reported crime, not a promise, and busy blocks with lots of shops report more theft; say so when it matters. Don't lecture or scare.
When a place is open, call getPlace first and answer about that place: would you take it, what to check on the tour, what to negotiate. Don't add it to the inbox again.
If a listing doesn't say something they care about (furnished, laundry, light, pets, fees), don't stop at "I don't know". First try readListingPage, or researchWeb when it's about the building or landlord. If it's still unknown: say what the listing does show, save the question on the place with updatePlace (note) so it's ready for the tour, tell them what to ask, and offer follow-ups with suggestReplies.`,
  },
  {
    id: 'research',
    when: 'looking deeper: tenant reviews, the landlord, the block, the full listing page, the photos',
    tools: ['researchWeb', 'readListingPage', 'examinePhotos'],
    route: has(/review|reputation|landlord|management|photo|picture|look(s)? like|the block|neighbou?rs?|elevator|noise|light|window|layout|furnished|laundry|research/i),
    body: `Research like a good agent would, when it helps them decide: readListingPage when they ask about something the data doesn't cover (windows, light, layout, laundry, lease terms); examinePhotos to look at the photos yourself: what the place really looks like, light, condition, whether the photos fit the listing or look staged or fake, or a specific question ("is there a window in the bedroom?"); researchWeb for tenant reviews of the building, the landlord's reputation, or the block (include the street address and NYC). Call independent ones in the same step. Don't research every place on every turn: it's slow. Say where you read something ("Tenants on Openigloo say…").`,
  },
  {
    id: 'preferences',
    when: 'they say how much something matters: must-haves, nice-to-haves, what they would accept',
    tools: [],
    route: has(/\bmust\b|has to|have to have|dealbreaker|deal breaker|\bneed\b|prefer|important|ok with|okay with|fine with|would be better|rather|nice to have|don'?t care|doesn'?t have to|can live without|won'?t live/i),
    body: `- If you don't know how much something matters to them, ask in one short question (dealbreaker, important, or not a big deal) and save the answer: a dealbreaker field when one fits, otherwise importantPreferences or addPreferences.
- Nice-to-haves marked (important) in the saved search matter most. Rank with them, and say when a place is missing one.
- Ones marked (dealbreaker) are must-haves. searchListings already leaves out places that clearly lack one, and lists in each place's unconfirmed the ones its listing doesn't mention; addToInbox refuses one that lacks it. For an unconfirmed one, check readListingPage first; if it's still unknown, you can add it, but say plainly that it's unconfirmed and offer to ask the landlord. "It has to have X" or "X is a dealbreaker" sets it with mustPreferences; "it doesn't have to have X" steps it back with nicePreferences.
- When they accept less than they'd like ("1 bath is OK, 2 would be better"), set the limit with updateSearch (minBaths 1), save the preference with updateMemory, and use it when you rank and explain ("only 1 bath; you said you'd prefer 2").`,
  },
  {
    id: 'memory',
    when: 'what you remember about them: saving it well, correcting it, earlier chats',
    tools: ['recallChats'],
    route: has(/remember|last time|earlier|you said|i said|forget|what do you know|we talked|my partner|my (wife|husband|girlfriend|boyfriend|roommate)|i work|commute/i),
    body: `- Keep what you understood, not their words: "I'm ok with 1 bath" is "Prefers 2 baths; 1 is acceptable". "Ugh, no more ground floors" is "Dislikes ground-floor units" (dislikes, strong).
- If it changes or contradicts a note, update that note. If they take something back, remove it. Never keep two notes that say the same thing.
- A pattern from saves and passes is a hint. Ask about it, or save it as inferred and mild once it's clear, and say what you noticed.
- Things that are also search filters (budget, beds, areas) go in updateSearch. Memory holds the why and the nuance ("budget is firm; moving from a $3,800 place").
- They can ask what you remember: tell them plainly, and change or remove anything they correct.
- When they refer to something from an earlier chat that isn't in this one or your notes, call recallChats before answering. Never pretend to remember a conversation you can't find.`,
  },
  {
    id: 'rights',
    when: 'fees, deposits, brokers, lease terms, negotiating, what the law allows',
    tools: [],
    route: has(/\bfees?\b|broker|deposit|application|negotiat|months? free|net effective|\blease\b|stabili[sz]ed|\blegal\b|illegal|allowed to|\brights\b|\bcharg(e|ing)\b|guarantor|credit check/i),
    body: `Know the renter's rights and use them for them: under the FARE Act, whoever hires the broker pays them, usually the landlord; a renter can't be made to pay a broker the landlord hired. Application fees are capped at $20 (including the credit check). Security deposits are capped at one month's rent. Months free are worth asking about, and so is the net effective rent. When a listing or agent asks for more than this, say so plainly and tell them what to say back.`,
  },
  {
    id: 'scams',
    when: 'a listing or person might be a scam',
    tools: [],
    route: has(/scam|\bwire\b|zelle|venmo|cash ?app|western union|gift card|before (i|we) (see|view)|too good|legit|is this real|fake|out of (the )?country|abroad/i),
    body: `Scam signs: rent far below the area, money before a viewing, wire, Zelle or gift-card payment, a landlord who is abroad or can't show it, moving the chat to WhatsApp or a foreign number, keys by mail. searchListings lists the signs it found in scamSigns. Hide a place like that with addToInbox verdict likely_scam and a short reason, and tell them plainly: never pay before seeing the place and signing a lease, and only pay a deposit by check or a traceable method to the management company.`,
  },
  {
    id: 'tours',
    when: 'tours and viewings: drafting one, changing one, what to check when they go',
    tools: ['requestTour', 'listTours', 'updateTour'],
    route: has(/\btours?\b|viewing|\bvisit\b|see (it|the place|them) in person|showing|open house|schedul|saturday|sunday|tomorrow at|this weekend/i),
    body: `Tours: requestTour only drafts one. Say so; never claim you contacted anyone. listTours and updateTour see and change tours they tell you about. On a tour they should check: water pressure and hot water, cell signal, light at that time of day, noise from the street and neighbours, signs of pests or leaks, laundry and trash, and anything the listing left unconfirmed (it's in their notes on the place).`,
  },
  {
    id: 'alerts',
    when: 'hearing about new places: email alerts, codes',
    tools: ['setAlerts', 'verifyAlerts', 'sendTestAlert'],
    route: has(/alert|notif|let me know|email me|text me|tell me when|keep (me )?posted|heads up when|\bcode\b|\b\d{6}\b/i),
    body: `Alerts: when they want to hear about new places, ask whether email works (texts aren't available yet) and where, unless their alert settings already have a verified address. Save it with setAlerts, tell them you sent a code to that address, and ask for it. When they give the code, call verifyAlerts. Once verified, offer an example with sendTestAlert. Never make up a code or say alerts are on before verifyAlerts succeeds.`,
  },
  {
    id: 'profile',
    when: 'changing the name the app shows',
    tools: ['updateProfile'],
    route: has(/call me|my name|rename|change (my )?name/i),
    body: `updateProfile changes the name the app shows.`,
  },
];

/** tools every turn has; skills add the rest in the gated harness */
export const CORE_TOOLS = ['getSearch', 'updateSearch', 'searchListings', 'addToInbox', 'listInbox', 'getPlace', 'updatePlace', 'suggestReplies', 'checkSites', 'crawlStatus', 'updateMemory', 'loadSkill'];

export const skillIndex = (off: Set<string>) =>
  SKILLS.filter((s) => !off.has(s.id)).map((s) => `- ${s.id}: ${s.when}`).join('\n');

/** the skills a turn starts with, decided in code */
export const route = (said: string, ctx: { placeOpen: boolean }, off: Set<string>) =>
  SKILLS.filter((s) => !off.has(s.id) && s.route(said, ctx)).map((s) => s.id);

export const skillText = (ids: string[]) =>
  SKILLS.filter((s) => ids.includes(s.id)).map((s) => `## ${s.id}\n${s.body}`).join('\n\n');

/** tools a set of skills needs, on top of the core */
export const toolsFor = (ids: string[]) => [...new Set([...CORE_TOOLS, ...SKILLS.filter((s) => ids.includes(s.id)).flatMap((s) => s.tools)])];

type Ctx = { requestContext?: { get(k: string): unknown } };

export const loadSkill = createTool({
  id: 'loadSkill',
  description: "Load one or more of your skills (the list is in your instructions) when this turn needs one that isn't loaded yet. Quick; call it in the same step as other tools that don't need it.",
  inputSchema: z.object({ ids: z.array(z.string()).min(1).max(4) }),
  execute: async ({ ids }, c) => {
    const rc = (c as Ctx).requestContext;
    const loaded = (rc?.get('skills') as Set<string> | undefined) ?? new Set<string>();
    const off = (rc?.get('skillsOff') as Set<string> | undefined) ?? new Set<string>();
    const ok = ids.filter((id) => SKILLS.some((s) => s.id === id) && !off.has(id)), fresh = ok.filter((id) => !loaded.has(id));
    for (const id of ok) loaded.add(id);
    const unknown = ids.filter((id) => !ok.includes(id));
    return {
      ...(fresh.length && { skills: skillText(fresh) }),
      ...(ok.length > fresh.length && { alreadyLoaded: ok.filter((id) => !fresh.includes(id)) }),
      ...(unknown.length && { unknown, note: 'No such skill. The list is in your instructions.' }),
    };
  },
});
