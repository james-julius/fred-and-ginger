import type { S } from "@/lib/api/client";
import { dayLabel } from "@/lib/format";

type Card = S["OpportunityCard"];

// How New places orders its list. The URL holds it (?sort=price-up), like the view.
export type Sort = "newest" | "price-up" | "price-down" | "fit" | "area";
const sorts: Sort[] = ["newest", "price-up", "price-down", "fit", "area"];
export const sortParam = (v: string | null): Sort => (sorts.includes(v as Sort) ? (v as Sort) : "newest");

export const isHidden = (c: Card) => c.status === "hidden" || c.verdict.kind === "likely_scam";

const order: Record<Sort, (a: Card, b: Card) => number> = {
  newest: () => 0, // the API sends newest first
  area: () => 0,
  "price-up": (a, b) => a.price - b.price,
  "price-down": (a, b) => b.price - a.price,
  fit: (a, b) => b.fit - a.fit,
};

/**
 * The list as it shows: grouped by the day Fred found each place (Newest) or by neighborhood,
 * otherwise one group with no heading. Hidden places and likely scams go last in their group, so a
 * too-cheap scam never tops the price sort.
 */
export function arrange(cards: Card[], sort: Sort): { label: string; items: Card[] }[] {
  const key = sort === "newest" ? (c: Card) => dayLabel(c.foundAt) : sort === "area" ? (c: Card) => c.area : () => "";
  const groups = new Map<string, Card[]>();
  for (const c of cards) {
    const k = key(c);
    if (groups.has(k)) groups.get(k)!.push(c);
    else groups.set(k, [c]);
  }
  const out = [...groups].map(([label, items]) => ({ label, items: items.sort((a, b) => Number(isHidden(a)) - Number(isHidden(b)) || order[sort](a, b)) }));
  return sort === "area" ? out.sort((a, b) => a.label.localeCompare(b.label)) : out;
}
