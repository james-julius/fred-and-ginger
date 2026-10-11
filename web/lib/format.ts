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

/** "Tomorrow, 8:30 AM" or "Sat, Oct 18, 11:00 AM". */
export function tourTime(iso: string, now = new Date()) {
  const d = new Date(iso);
  const ahead = Math.round((startOfDay(d) - startOfDay(now)) / 86_400_000);
  const day = ahead === 0 ? "Today" : ahead === 1 ? "Tomorrow" : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return `${day}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

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
