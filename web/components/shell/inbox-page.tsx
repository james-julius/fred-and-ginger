"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { preload, useSWRConfig } from "swr";
import { api, updateOpportunity, type S } from "@/lib/api/client";
import { arrange, sortParam } from "./arrange";
import { Inbox, usePlaces, type PlaceList, type View } from "./inbox";
import { ListingModal } from "./listing-modal";
import { useAskFred } from "./shell";

// The URL holds the open listing (?place=op_inwood), the view (?view=map) and the sort (?sort=fit), so a
// listing or the map can be shared, a reload keeps your view, and the back button closes the modal.
// New places, Saved and Passed are all this page, each with its own list.
export function InboxPage({ list = "new" }: { list?: PlaceList }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const openId = params.get("place");
  const view: View = params.get("view") === "map" ? "map" : "list";
  const sort = sortParam(params.get("sort"));
  const askFred = useAskFred();

  const { items } = usePlaces(list);
  const ids = arrange(items ?? [], sort).flatMap((g) => g.items.map((c) => c.id)); // the modal steps in the order the list shows
  const index = openId ? ids.indexOf(openId) : -1;

  // Load the places either side of the open one in the background, so the arrows open them at once.
  const { cache } = useSWRConfig();
  const neighbours = index === -1 || ids.length < 2 ? "" : `${ids[(index + 1) % ids.length]} ${ids[(index - 1 + ids.length) % ids.length]}`;
  useEffect(() => {
    for (const near of neighbours.split(" ").filter(Boolean)) {
      const key = `/api/opportunities/${near}`;
      if (cache.get(key)?.data === undefined) preload(key, (path: string) => api<S["OpportunityDetail"]>(path)).catch(() => {});
    }
  }, [neighbours, cache]);

  const url = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    const q = next.toString();
    return q ? `${pathname}?${q}` : pathname;
  };
  const markSeen = (id: string) => {
    if (items?.find((c) => c.id === id)?.seen === false) void updateOpportunity(id, { seen: true });
  };
  const open = (id: string) => {
    markSeen(id);
    router.push(url({ place: id }), { scroll: false });
  };
  const step = (by: 1 | -1) => {
    if (!ids.length) return;
    const next = ids[(index + by + ids.length) % ids.length];
    markSeen(next);
    router.replace(url({ place: next }), { scroll: false });
  };
  const close = () => router.replace(url({ place: null }), { scroll: false });

  return (
    <>
      <Inbox
        list={list}
        onOpen={open}
        openId={openId}
        view={view}
        onView={(v) => router.replace(url({ view: v === "map" ? "map" : null }), { scroll: false })}
        sort={sort}
        onSort={(s) => router.replace(url({ sort: s === "newest" ? null : s }), { scroll: false })}
      />
      <ListingModal
        id={openId}
        preview={items?.find((c) => c.id === openId)}
        position={index + 1}
        total={ids.length}
        onStep={step}
        onClose={close}
        onAsk={(place) => {
          close();
          askFred({ id: place.id, label: place.address });
        }}
      />
    </>
  );
}
