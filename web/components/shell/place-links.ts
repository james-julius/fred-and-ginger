// Fred names places by address ("261 W 70th St #2") but can only link the ones it has an id for, and
// addToInbox doesn't hand it addresses. So the chat links them itself: it looks up the places this
// reply touched and turns their addresses in Fred's text into [address](place:op_…) links.

import useSWR, { mutate } from "swr";
import { api, type S } from "@/lib/api/client";
import { asTool } from "./fred-tools";

type Named = { id: string; names: string[] };

const isPlaceId = (v: unknown): v is string => typeof v === "string" && /^op_[\w-]+$/.test(v);

/** The places one reply touched: what it added (data-places, addToInbox) and any place a tool read or changed. */
export function placeIdsIn(parts: { type: string }[]): string[] {
  const ids = new Set<string>();
  for (const part of parts) {
    if (part.type === "data-places") {
      const data = (part as { data?: { ids?: unknown[]; hidden?: unknown[] } }).data;
      for (const id of [...(data?.ids ?? []), ...(data?.hidden ?? [])]) if (isPlaceId(id)) ids.add(id);
    }
    const tool = asTool(part);
    if (!tool) continue;
    if (isPlaceId(tool.input.id)) ids.add(tool.input.id);
    for (const list of [tool.input.places, tool.output.added]) {
      if (!Array.isArray(list)) continue;
      for (const p of list as { id?: unknown; listingId?: unknown }[]) {
        if (isPlaceId(p?.id)) ids.add(p.id);
        else if (typeof p?.listingId === "number") ids.add(`op_${p.listingId}`); // older threads added by listing id
      }
    }
  }
  return [...ids];
}

/** Each place's address as Fred writes it ("261 W 70th St #2"), and the street alone. Keeps the details for the listing modal. */
export function usePlaceNames(ids: string[]): Named[] {
  const { data } = useSWR(
    ids.length ? ["place-names", ...ids] : null,
    async () => {
      const details = await Promise.all(ids.map((id) => api<S["OpportunityDetail"]>(`/api/opportunities/${id}`).catch(() => null)));
      for (const d of details) if (d) void mutate(`/api/opportunities/${d.id}`, d, { revalidate: false });
      return details.flatMap((d) => (d?.address ? [{ id: d.id, names: [d.unit ? `${d.address} #${d.unit}` : "", d.address].filter(Boolean) }] : []));
    },
    { revalidateOnFocus: false },
  );
  return data ?? [];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Links each address in the text to its place, longest first so "#212" beats "#2". A bare street
 * only links when one place has it. Text already inside a link, or a link still streaming in, stays as it is.
 */
export function linkPlaces(text: string, places: Named[]): string {
  const byName = new Map<string, string | null>(); // lowercased name to place id; null when two places share it
  for (const p of places) for (const n of p.names) byName.set(n.toLowerCase(), byName.has(n.toLowerCase()) && byName.get(n.toLowerCase()) !== p.id ? null : p.id);
  const names = [...byName].filter(([, id]) => id).map(([n]) => n).sort((a, b) => b.length - a.length);
  if (!names.length) return text;
  const find = new RegExp(`(?<![\\w#])(${names.map(escape).join("|")})(?![\\w])`, "gi");
  return text
    .split(/(\[[^\]]*\](?:\([^)]*\)?)?|\[[^\]]*$)/)
    .map((piece, i) => (i % 2 ? piece : piece.replace(find, (m) => `[${m}](place:${byName.get(m.toLowerCase())})`)))
    .join("");
}
