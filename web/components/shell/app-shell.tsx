"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { FredMark } from "@/components/fred-mark";
import { SignedOutError, updateOpportunity, useMe, useOpportunities, type S } from "@/lib/api/client";
import { ChatPanel } from "./chat-panel";
import { Inbox } from "./inbox";
import { ListingModal } from "./listing-modal";
import { Sidebar } from "./sidebar";

// The open listing lives in the URL (?place=op_inwood), so a listing can be shared
// and the back button closes the modal.
export function AppShell() {
  const router = useRouter();
  const pathname = usePathname();
  const openId = useSearchParams().get("place");

  const { data: me, error: meError } = useMe();
  const { data: page } = useOpportunities("new");
  const ids = page?.items.map((c) => c.id) ?? [];
  const index = openId ? ids.indexOf(openId) : -1;

  const [context, setContext] = useState<{ id: string; label: string } | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const markSeen = (id: string) => {
    if (page?.items.find((c) => c.id === id)?.seen === false) void updateOpportunity(id, { seen: true });
  };
  const openPlace = (id: string) => {
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
  const ask = (place: S["OpportunityDetail"]) => {
    setContext({ id: place.id, label: place.address });
    close();
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  if (meError instanceof SignedOutError) return <SignIn />;

  return (
    <div className="min-h-dvh lg:grid lg:h-dvh lg:grid-cols-[220px_minmax(0,0.95fr)_minmax(0,1.2fr)]">
      <Sidebar me={me} />
      <ChatPanel context={context} onClearContext={() => setContext(null)} composerRef={composerRef} />
      <Inbox onOpen={openPlace} openId={openId} />
      <ListingModal id={openId} position={index + 1} total={ids.length} onStep={step} onClose={close} onAsk={ask} />
    </div>
  );
}

// /login is James's page on the Worker, proxied through this app, so the session cookie lands here.
function SignIn() {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="grid max-w-sm justify-items-center gap-4 text-center">
        <FredMark className="h-13 w-10" />
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to Fred</h1>
        <p className="text-muted-foreground">Your places, tours and chat are waiting.</p>
        <a href="/login" className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground">
          Sign in
        </a>
      </div>
    </main>
  );
}
