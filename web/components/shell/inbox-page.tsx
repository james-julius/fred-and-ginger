"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { updateOpportunity, useOpportunities } from "@/lib/api/client";
import { Inbox, type View } from "./inbox";
import { ListingModal } from "./listing-modal";
import { useAskFred } from "./shell";

// The URL holds the open listing (?place=op_inwood) and the view (?view=map), so a listing or
// the map can be shared, a reload keeps your view, and the back button closes the modal.
export function InboxPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const openId = params.get("place");
  const view: View = params.get("view") === "map" ? "map" : "list";
  const askFred = useAskFred();

  const { data: page } = useOpportunities("new");
  const ids = page?.items.map((c) => c.id) ?? [];
  const index = openId ? ids.indexOf(openId) : -1;

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
    if (page?.items.find((c) => c.id === id)?.seen === false) void updateOpportunity(id, { seen: true });
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
      <Inbox onOpen={open} openId={openId} view={view} onView={(v) => router.replace(url({ view: v === "map" ? "map" : null }), { scroll: false })} />
      <ListingModal
        id={openId}
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
