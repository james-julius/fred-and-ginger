"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { places, type Place, type Vote } from "@/lib/places";
import { ChatPanel } from "./chat-panel";
import { Inbox } from "./inbox";
import { ListingModal } from "./listing-modal";
import { Sidebar } from "./sidebar";

// The open listing lives in the URL (?place=seaman-ave-inwood), so a listing can be shared
// and the back button closes the modal.
export function AppShell() {
  const router = useRouter();
  const pathname = usePathname();
  const openId = useSearchParams().get("place");
  const index = places.findIndex((p) => p.id === openId);
  const open = index === -1 ? null : places[index];

  const [unread, setUnread] = useState<ReadonlySet<string>>(
    () => new Set(places.filter((p) => p.fit !== "scam").map((p) => p.id)),
  );
  // Your votes. Later this posts to the Worker's /api/vote.
  const [myVotes, setMyVotes] = useState<Record<string, Vote>>(() => Object.fromEntries(places.map((p) => [p.id, p.myVote])));
  const [context, setContext] = useState<Place | null>(null);
  const [draft, setDraft] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const markRead = (id: string) =>
    setUnread((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

  const openPlace = (id: string) => {
    markRead(id);
    router.push(`${pathname}?place=${id}`, { scroll: false });
  };
  const step = (by: 1 | -1) => {
    const next = places[(index + by + places.length) % places.length];
    markRead(next.id);
    router.replace(`${pathname}?place=${next.id}`, { scroll: false });
  };
  const close = () => {
    if (open) markRead(open.id);
    router.replace(pathname, { scroll: false });
  };
  const ask = (place: Place) => {
    setContext(place);
    close();
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  // The place you're looking at doesn't count as unread.
  const unreadNow = open ? withoutId(unread, open.id) : unread;

  return (
    <div className="min-h-dvh lg:grid lg:h-dvh lg:grid-cols-[220px_minmax(0,0.95fr)_minmax(0,1.2fr)]">
      <Sidebar newCount={unreadNow.size} />
      <ChatPanel
        context={context}
        onClearContext={() => setContext(null)}
        draft={draft}
        onDraft={setDraft}
        composerRef={composerRef}
      />
      <Inbox places={places} unread={unreadNow} myVotes={myVotes} onOpen={openPlace} />
      <ListingModal
        place={open}
        position={index + 1}
        total={places.length}
        myVote={open ? myVotes[open.id] : null}
        onVote={(id, vote) => setMyVotes((prev) => ({ ...prev, [id]: vote }))}
        onStep={step}
        onClose={close}
        onAsk={ask}
      />
    </div>
  );
}

function withoutId(set: ReadonlySet<string>, id: string) {
  if (!set.has(id)) return set;
  const next = new Set(set);
  next.delete(id);
  return next;
}
