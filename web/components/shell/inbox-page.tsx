"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { updateOpportunity, useOpportunities } from "@/lib/api/client";
import { Inbox } from "./inbox";
import { ListingModal } from "./listing-modal";
import { useAskFred } from "./shell";

// The open listing lives in the URL (?place=op_inwood), so a listing can be shared
// and the back button closes the modal.
export function InboxPage() {
  const router = useRouter();
  const pathname = usePathname();
  const openId = useSearchParams().get("place");
  const askFred = useAskFred();

  const { data: page } = useOpportunities("new");
  const ids = page?.items.map((c) => c.id) ?? [];
  const index = openId ? ids.indexOf(openId) : -1;

  const markSeen = (id: string) => {
    if (page?.items.find((c) => c.id === id)?.seen === false) void updateOpportunity(id, { seen: true });
  };
  const open = (id: string) => {
    markSeen(id);
    router.push(`${pathname}?place=${id}`, { scroll: false });
  };
  const step = (by: 1 | -1) => {
    if (!ids.length) return;
    const next = ids[(index + by + ids.length) % ids.length];
    markSeen(next);
    router.replace(`${pathname}?place=${next}`, { scroll: false });
  };
  const close = () => router.replace(pathname, { scroll: false });

  return (
    <>
      <Inbox onOpen={open} openId={openId} />
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
