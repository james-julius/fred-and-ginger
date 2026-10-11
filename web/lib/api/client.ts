"use client";

import useSWR, { mutate } from "swr";
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
  return res.json() as Promise<T>;
}

const get = <T,>(path: string) => api<T>(path);
// Don't keep retrying when you're signed out; the app shows the sign-in screen instead.
const opts = { revalidateOnFocus: false, shouldRetryOnError: (err: unknown) => !(err instanceof SignedOutError) };

export const useMe = () => useSWR<S["Me"]>("/api/me", get, opts);
export const useSearch = () => useSWR<S["Search"]>("/api/search", get, opts);
export const useOpportunities = (view: "new" | "saved" | "hidden" | "all" = "new") =>
  useSWR<S["OpportunityPage"]>(`/api/opportunities?view=${view}`, get, opts);
export const useOpportunity = (id: string | null) => useSWR<S["OpportunityDetail"]>(id ? `/api/opportunities/${id}` : null, get, opts);
export const useTours = () => useSWR<S["Tour"][]>("/api/tours?when=upcoming", get, opts);
export const useThreads = () => useSWR<S["Thread"][]>("/api/threads", get, opts);
export const useThread = (id: string | null) =>
  useSWR<{ thread: S["Thread"]; messages: unknown[] }>(id ? `/api/threads/${id}` : null, get, opts);

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

/** What you're looking for. Changing it changes the inbox, so refresh that too. */
export async function updateSearch(patch: S["SearchPatch"]) {
  const search = await api<S["Search"]>("/api/search", { method: "PATCH", body: JSON.stringify(patch) });
  await refreshPlaces();
  return search;
}

/** After anything that can change the inbox: a vote, a chat reply that edits the search. */
export const refreshPlaces = () =>
  mutate((key) => typeof key === "string" && (key.startsWith("/api/opportunities") || key === "/api/me" || key === "/api/search"));
