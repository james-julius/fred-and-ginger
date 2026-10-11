"use client";

import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { FredMark } from "@/components/fred-mark";
import { SignedOutError, useMe } from "@/lib/api/client";
import { ChatPanel } from "./chat-panel";
import { Sidebar } from "./sidebar";

type Ask = (place: { id: string; label: string }) => void;
const AskFred = createContext<Ask>(() => {});
/** "Ask Fred about this place": puts the listing on the composer and focuses it. */
export const useAskFred = () => useContext(AskFred);

// Sidebar and chat stay put; the right-hand pane is the page (New places, Profile, …).
export function Shell({ children }: { children: ReactNode }) {
  const { data: me, error } = useMe();
  const [context, setContext] = useState<{ id: string; label: string } | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const ask: Ask = (place) => {
    setContext(place);
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  if (error instanceof SignedOutError) return <SignIn />;

  return (
    <AskFred.Provider value={ask}>
      <div className="min-h-dvh lg:grid lg:h-dvh lg:grid-cols-[220px_minmax(0,0.95fr)_minmax(0,1.2fr)]">
        <Sidebar me={me} />
        <ChatPanel context={context} onClearContext={() => setContext(null)} composerRef={composerRef} />
        {children}
      </div>
    </AskFred.Provider>
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
