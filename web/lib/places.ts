// Example data for the front end until it's wired to James's Worker.
// The first group of fields is what /api/listings returns (cloud/src/index.ts, listings()),
// camelCased, which is what the crawlers collect (actor/SCHEMA.md) plus what the backend adds.
// The second group is Fred's own read on a listing, which comes from the agent once /api/chat exists.

export type Fit = "strong" | "over-budget" | "scam";
export type BuildingType = "stone" | "brick" | "glass";
/** 1 like, -1 pass, null not voted. Same as the votes table. */
export type Vote = 1 | -1 | null;

export type Place = {
  /** URL slug for ?place=. The API's id is a number; the slug will be built from it. */
  id: string;

  // ---- From /api/listings ----
  price: number;
  /** [unix seconds, price] whenever the price changed. */
  priceHistory: [number, number][];
  beds: number;
  baths: number;
  sqft: number | null;
  street: string;
  unit: string | null;
  neighbourhood: string;
  /** ISO date, or null when the listing doesn't say. */
  available: string | null;
  /** null when the listing doesn't say. */
  noFee: boolean | null;
  /** Broker or management company. */
  agency: string | null;
  photos: string[];
  /** The sites it was seen on. */
  sources: string[];
  /** From last_seen. The backend marks a listing gone after 3 days unseen. */
  lastSeen: string;
  /** NYC Open Data building check. Null when the address didn't match a building. */
  building: { score: number; flags: string[]; good: string[] } | null;
  myVote: Vote;
  theirVote: Vote;

  // ---- Fred's read (not in the API yet) ----
  fit: Fit;
  buildingType: BuildingType;
  listed: "Today" | "Yesterday";
  whyLabel: string;
  why?: string;
  reasons?: string[];
  /** What Fred asks before acting. Nothing leaves the account without a tap. */
  ask: { question: string; actions: string[]; note: string };
};

/** The other person on the hunt (the API's `other`). */
export const partner = "James";
/** From the saved search. */
export const maxRent = 5000;

// Free-to-use Unsplash photos. Never real listing photos: those belong to the listing sites.
const unsplash = (id: string) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&q=75`;

/** Ask Unsplash for a size that fits. Real listing photo URLs come as they are. */
export const photoAt = (src: string, width: number) =>
  src.startsWith("https://images.unsplash.com/") ? `${src}&w=${width}` : src;

const day = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

export const places: Place[] = [
  {
    id: "cabrini-blvd-hudson-heights",
    price: 4750,
    priceHistory: [],
    beds: 2,
    baths: 2,
    sqft: 1050,
    street: "Cabrini Blvd",
    unit: "5C",
    neighbourhood: "Hudson Heights",
    available: "2026-11-01",
    noFee: true,
    agency: "Cabrini Terrace Management",
    photos: [
      unsplash("1722650272764-08d92d193a9c"),
      unsplash("1757742690834-aa581b9f53b2"),
      unsplash("1630699376167-3870469e7598"),
      unsplash("1649068559107-e5d936141e44"),
    ],
    sources: ["Zillow", "StreetEasy"],
    lastSeen: "2 hr ago",
    building: {
      score: 88,
      flags: ["3 open class B (hazardous) violations"],
      good: ["no heat complaints in the last year", "no pest or bedbug reports"],
    },
    myVote: null,
    theirVote: 1,
    fit: "strong",
    buildingType: "stone",
    listed: "Today",
    whyLabel: "Why this one",
    why: "Two full baths, no broker fee, a building that scores 88, and it’s $250 under your max.",
    ask: {
      question: "You’re touring tomorrow at 8:30 AM. Want your application ready to send right after?",
      actions: ["Get it ready", "Not now"],
      note: "Nothing is sent until you tap Send.",
    },
  },
  {
    id: "seaman-ave-inwood",
    price: 4600,
    priceHistory: [],
    beds: 2,
    baths: 2,
    sqft: 980,
    street: "Seaman Ave",
    unit: "3F",
    neighbourhood: "Inwood",
    available: "2026-12-01",
    noFee: null,
    agency: null,
    photos: [
      unsplash("1722650362357-7cb7d35a45eb"),
      unsplash("1721395286594-8913b06056eb"),
      unsplash("1630699144641-72fa7a6b8aa1"),
      unsplash("1652882860938-f90aa298e644"),
    ],
    sources: ["StreetEasy"],
    lastSeen: "40 min ago",
    building: {
      score: 74,
      flags: ["6 heat / hot water complaints in the last year", "11 noise complaints to 311 in the last year"],
      good: ["no open serious violations", "no pest or bedbug reports"],
    },
    myVote: null,
    theirVote: null,
    fit: "strong",
    buildingType: "brick",
    listed: "Today",
    whyLabel: "Why this one",
    why: "Two full baths, $400 under your max, and it’s free right when you want to move. The building has some heat complaints, so ask about that on the tour.",
    ask: {
      question: "The listing doesn’t say if there’s a broker fee. Ask before you book a showing?",
      actions: ["Ask about the fee", "Not now"],
      note: "Fred sends it as a message from you and shows you the reply.",
    },
  },
  {
    id: "frederick-douglass-blvd-harlem",
    price: 5150,
    priceHistory: [
      [day("2026-10-03"), 5350],
      [day("2026-10-09"), 5150],
    ],
    beds: 2,
    baths: 2,
    sqft: 1120,
    street: "Frederick Douglass Blvd",
    unit: "8A",
    neighbourhood: "Harlem",
    available: "2026-11-15",
    noFee: true,
    agency: "Douglass Tower Leasing",
    photos: [
      unsplash("1780427670049-43aa7921e3f0"),
      unsplash("1484154218962-a197022b5858"),
      unsplash("1771287491132-4954b32210d6"),
      unsplash("1774311237295-a65a4c1ff38a"),
    ],
    sources: ["StreetEasy", "Compass"],
    lastSeen: "5 hr ago",
    building: {
      score: 95,
      flags: [],
      good: ["no open serious violations", "no heat complaints in the last year", "no pest or bedbug reports"],
    },
    myVote: null,
    theirVote: 1,
    fit: "over-budget",
    buildingType: "glass",
    listed: "Yesterday",
    whyLabel: "Why it’s here anyway",
    why: "Everything matches except the price, which is $150 over your max. It already dropped $200 this week.",
    ask: {
      question: "Tell you if the price drops under $5,000?",
      actions: ["Watch the price", "Not now"],
      note: "The crawlers check every listing about every 4 hours.",
    },
  },
  {
    id: "w-86th-st-upper-west-side",
    price: 3200,
    priceHistory: [],
    beds: 2,
    baths: 2,
    sqft: null,
    street: "W 86th St",
    unit: null,
    neighbourhood: "Upper West Side",
    available: null,
    noFee: null,
    agency: null,
    photos: [unsplash("1630699375019-c334927264df"), unsplash("1560448075-57d0285fc59b"), unsplash("1560448075-cbc16bb4af8e")],
    sources: ["Craigslist"],
    lastSeen: "1 day ago",
    building: null,
    myVote: null,
    theirVote: null,
    fit: "scam",
    buildingType: "brick",
    listed: "Yesterday",
    whyLabel: "Why Fred flagged it",
    // The same checks as the Craigslist crawler's scamFlags(), in plain English.
    reasons: [
      "It asks for a deposit before you can see the place.",
      "It wants payment by Zelle.",
      "The owner says they’re out of the country.",
      "The rent is far below other 2-beds on the Upper West Side.",
      "The address doesn’t match a building in the city’s records.",
    ],
    ask: {
      question: "Report this listing to Craigslist?",
      actions: ["Report it", "Show it anyway"],
      note: "Fred will never ask you for money. A real landlord won’t ask before a viewing either.",
    },
  },
];

export const money = (n: number) => "$" + n.toLocaleString("en-US");

/** "Nov 1" from "2026-11-01". */
export const shortDate = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Same thresholds as the old grid: 80+ good, 60+ middling, lower is worth a look at the flags. */
export const scoreTone = (score: number) => (score >= 80 ? "text-success" : score >= 60 ? "text-warning" : "text-destructive");
