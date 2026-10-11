"use client";

import useSWR, { mutate, useSWRConfig } from "swr";
import type { components } from "./schema.gen";

// Types come from James's contract (packages/api). Regenerate with `npm run gen:api` at the repo root.
export type S = components["schemas"];

/** The API answers 401 until you sign in at /login (proxied to the Worker). */
export class SignedOutError extends Error {}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
    credentials: "same-origin",
  });
  if (res.status === 401) throw new SignedOutError("Signed out");
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} failed: ${res.status}`);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const get = <T,>(path: string) => api<T>(path);
// Don't keep retrying when you're signed out; the app shows the sign-in screen instead.
const opts = { revalidateOnFocus: false, shouldRetryOnError: (err: unknown) => !(err instanceof SignedOutError) };

// The API pages long lists (nextCursor). The inbox sorts, groups and steps through the whole list, so follow the pages to the end.
async function everyPage(path: string): Promise<S["OpportunityCard"][]> {
  const items: S["OpportunityCard"][] = [];
  let cursor: string | null = null;
  do {
    const page: S["OpportunityPage"] = await api(cursor ? `${path}&cursor=${encodeURIComponent(cursor)}` : path);
    items.push(...page.items);
    cursor = page.items.length ? page.nextCursor : null;
  } while (cursor);
  return items;
}

export const useMe = () => useSWR<S["Me"]>("/api/me", get, opts);
export const useSearch = () => useSWR<S["Search"]>("/api/search", get, opts);
/** Every place in a view, newest first. */
export const useOpportunities = (view: "new" | "saved" | "hidden" | "all" = "new") =>
  useSWR(`/api/opportunities?view=${view}&limit=100`, everyPage, opts);
export const useOpportunity = (id: string | null) => useSWR<S["OpportunityDetail"]>(id ? `/api/opportunities/${id}` : null, get, opts);
export const useTours = (when: "upcoming" | "past" | "all" = "upcoming") => useSWR<S["Tour"][]>(`/api/tours?when=${when}`, get, opts);
export const usePacket = () => useSWR<S["Packet"]>("/api/packet", get, opts);
export const useMemory = () => useSWR<S["MemoryList"]>("/api/memory", get, opts);
export const useThreads = () => useSWR<S["Thread"][]>("/api/threads", get, opts);
export const useThread = (id: string | null) =>
  useSWR<{ thread: S["Thread"]; messages: unknown[] }>(id ? `/api/threads/${id}` : null, get, opts);

/**
 * Where each place is, for the map, or null if it has no location. Cards don't carry coordinates yet, so this reads each
 * place's detail, which does, and keeps those details for the listing modal so opening one is instant. A place never
 * moves, so a detail already fetched is reused, and saving or passing one doesn't look the rest up again.
 */
export function usePlaceLocations(ids: string[]) {
  const { cache } = useSWRConfig();
  return useSWR(
    ids.length ? ["locations", ...ids] : null,
    async () => {
      const detail = async (id: string) => {
        const key = `/api/opportunities/${id}`;
        const known = cache.get(key)?.data as S["OpportunityDetail"] | undefined;
        if (known) return known;
        const d = await api<S["OpportunityDetail"]>(key).catch(() => null);
        if (d) void mutate(key, d, { revalidate: false });
        return d;
      };
      const details = await Promise.all(ids.map(detail));
      return Object.fromEntries(ids.map((id, i) => [id, details[i]?.location ?? null]));
    },
    // Keep the pins up while a changed list is looked up, instead of starting the map over.
    { ...opts, keepPreviousData: true },
  );
}

/** Save, pass, hide or mark seen, then refresh the inbox and the sidebar counts. */
export async function updateOpportunity(id: string, patch: S["OpportunityPatch"]) {
  const card = await api<S["OpportunityCard"]>(`/api/opportunities/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  await refreshPlaces();
  return card;
}

/** Your name or photo. */
export async function updateMe(patch: S["MePatch"]) {
  const me = await api<S["Me"]>("/api/me", { method: "PATCH", body: JSON.stringify(patch) });
  await mutate("/api/me", me, { revalidate: false });
  return me;
}

/** How Fred tells you about new places. The mode shows on /api/me, so refresh that. */
export async function updateAlerts(patch: S["AlertsPatch"]) {
  const alerts = await api<S["Alerts"]>("/api/alerts", { method: "PATCH", body: JSON.stringify(patch) });
  await mutate("/api/me");
  return alerts;
}

/** A tour's status, time or notes. The sidebar counts upcoming tours, so refresh /api/me too. */
export async function updateTour(id: string, patch: S["TourPatch"]) {
  const tour = await api<S["Tour"]>(`/api/tours/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  await mutate((key) => typeof key === "string" && (key.startsWith("/api/tours") || key === "/api/me"));
  return tour;
}

/** What you're looking for. Changing it changes the inbox, so refresh that too. */
export async function updateSearch(patch: S["SearchPatch"]) {
  const search = await api<S["Search"]>("/api/search", { method: "PATCH", body: JSON.stringify(patch) });
  await refreshPlaces();
  return search;
}

/** Correct something Fred remembers. Your edit counts as something you told him. */
export async function updateMemory(id: string, patch: S["MemoryPatch"]) {
  const note = await api<S["Memory"]>(`/api/memory/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  await mutate("/api/memory");
  return note;
}

/** Make Fred forget something. */
export async function forgetMemory(id: string) {
  await api(`/api/memory/${id}`, { method: "DELETE" });
  await mutate("/api/memory");
}

/** After anything that can change the inbox or your profile: a vote, a chat reply that edits the search, a tour or Fred's notes. */
export const refreshPlaces = () =>
  mutate(
    (key) =>
      typeof key === "string" &&
      (key.startsWith("/api/opportunities") || key.startsWith("/api/tours") || ["/api/me", "/api/search", "/api/memory"].includes(key)),
  );
