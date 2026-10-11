import type { S } from "@/lib/api/client";

export const money = (n: number) => "$" + n.toLocaleString("en-US");

/** "Today", "Yesterday", or "Oct 8", in the viewer's time zone. */
export function dayLabel(iso: string, now = new Date()) {
  const d = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "Nov 15" from "2026-11-15". */
export const shortDate = (isoDate: string) =>
  new Date(isoDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

// Every listing is in New York, so tour times are New York times wherever you're looking from.
const NYC = "America/New_York";
const nycDay = (d: Date) => new Date(d.toLocaleDateString("en-US", { timeZone: NYC })).getTime();

/** "Tomorrow, 8:30 AM" or "Sat, Oct 18, 11:00 AM", in New York time. */
export function tourTime(iso: string, now = new Date()) {
  const d = new Date(iso);
  const ahead = Math.round((nycDay(d) - nycDay(now)) / 86_400_000);
  const day =
    ahead === 0 ? "Today" : ahead === 1 ? "Tomorrow" : d.toLocaleDateString("en-US", { timeZone: NYC, weekday: "short", month: "short", day: "numeric" });
  return `${day}, ${d.toLocaleTimeString("en-US", { timeZone: NYC, hour: "numeric", minute: "2-digit" })}`;
}

/** "2026-10-14T18:30", the New York wall time, for a datetime-local input. */
export function nycInputValue(iso: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NYC,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** A datetime-local value, read as New York time, as an ISO instant. */
export function fromNycInput(value: string) {
  const asUtc = new Date(`${value}Z`);
  const offset = asUtc.getTime() - new Date(`${nycInputValue(asUtc.toISOString())}Z`).getTime();
  return new Date(asUtc.getTime() + offset).toISOString();
}

export const tourStatusLabel: Record<S["Tour"]["status"], string> = {
  draft: "Draft",
  requested: "Requested",
  confirmed: "Confirmed",
  done: "Done",
  cancelled: "Cancelled",
};

/** Ask Unsplash for a size that fits. Real listing photo URLs come as they are. */
export const photoAt = (src: string, width: number) =>
  src.startsWith("https://images.unsplash.com/") ? `${src}${src.includes("?") ? "&" : "?"}w=${width}` : src;

/** "5 min to the A" or "3 min to the B/C". */
export const transitText = (t: NonNullable<S["Transit"]>) => `${t.walkMinutes} min to the ${t.lines.join("/")}`;

/** "long-island-city" → "Long Island City" */
const titleCase = (slug: string) => slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

/** The Dealbreakers chips, in the order people say them. */
export function dealbreakerChips(d: S["Dealbreakers"]) {
  const pets = { dogs: "Dogs OK", cats: "Cats OK", dogs_and_cats: "Dogs and cats OK" } as const;
  return [
    ...d.areas.map(titleCase),
    d.maxTotalMonthly != null && `Up to ${money(d.maxTotalMonthly)}`,
    d.minBeds != null && `${d.minBeds} bed`,
    d.minBaths != null && `${d.minBaths} bath`,
    d.pets && pets[d.pets],
    d.noBrokerFee && "No broker fee",
    d.moveBy && `Move by ${shortDate(d.moveBy)}`,
  ].filter((x): x is string => Boolean(x));
}

export const alertsLabel: Record<S["AlertMode"], string> = {
  instant_strong: "Alerts: strong fits right away",
  daily: "Alerts: one daily digest",
  off: "Alerts: off",
};

export const toneClass: Record<S["Verdict"]["tone"], string> = {
  good: "text-success",
  warn: "text-warning",
  bad: "text-destructive",
  neutral: "text-muted-foreground",
};

/** Same thresholds as the old grid: 80+ good, 60+ middling, lower is worth a look at the flags. */
export const scoreTone = (score: number) => (score >= 80 ? "text-success" : score >= 60 ? "text-warning" : "text-destructive");

/** Which building drawing to show when a listing has no photo. Stable per listing. */
export const buildingType = (listingId: number) => (["stone", "brick", "glass"] as const)[listingId % 3];

export const siteName = (site: string) =>
  ({ streeteasy: "StreetEasy", zillow: "Zillow", renthop: "RentHop", zumper: "Zumper", craigslist: "Craigslist", compass: "Compass", nooklyn: "Nooklyn" })[
    site
  ] ?? titleCase(site);
