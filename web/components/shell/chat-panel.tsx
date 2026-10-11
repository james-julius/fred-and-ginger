"use client";

import { ArrowUp, ChevronRight, Mic, Plus, X } from "lucide-react";
import type { RefObject } from "react";
import { FredMark } from "@/components/fred-mark";
import type { Place } from "@/lib/places";

// Example conversation. When /api/chat exists this becomes AI SDK's useChat, with
// AI Elements' Conversation and Message doing the scrolling and markdown.
const dealbreakers = ["Manhattan", "Up to $5,000", "2 bed", "2 bath", "Dogs OK"];
// What the backend really does on each run (cloud/ and actor/).
const steps = [
  "Ran the crawlers on StreetEasy, Zillow, RentHop, Zumper, Craigslist, Compass, Nooklyn and 23 landlords’ sites",
  "Found 186 new listings",
  "Merged 31 that were the same apartment on more than one site",
  "Kept 14 that match your search",
  "Matched each address to its building in the city’s records",
  "Checked each building’s violations, complaints, 311 calls, bedbugs and evictions",
  "Flagged 1 likely scam on Craigslist",
  "Marked 2 places gone after 3 days unseen",
  "Added 3 places to your inbox",
];
const replies = ["Allow 1.5 baths", "Add Long Island City", "Keep it as is"];

export function ChatPanel({ context, onClearContext, draft, onDraft, composerRef }: {
  context: Place | null;
  onClearContext: () => void;
  draft: string;
  onDraft: (text: string) => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const pick = (text: string) => {
    onDraft(text);
    composerRef.current?.focus();
  };

  return (
    <section aria-label="Conversation with Fred" className="flex flex-col border-b bg-chat lg:min-h-0 lg:border-r lg:border-b-0">
      <div className="grid content-start gap-3.5 px-5 pt-5 pb-2 lg:flex-1 lg:overflow-y-auto">
        <p className="max-w-[88%] justify-self-end rounded-[14px] border bg-background px-3.5 py-2.5 shadow-xs">
          I want an apartment under 5k in manhattan with 2 beds 2 baths and it has to be dog friendly
        </p>

        {/* What Fred understood, as hard filters you can edit */}
        <div className="-mt-1.5 flex max-w-[92%] flex-wrap items-center justify-end gap-1.5 justify-self-end">
          <span className="mr-0.5 text-xs text-muted-foreground">Dealbreakers</span>
          {dealbreakers.map((d) => (
            <span key={d} className="rounded-full border bg-background px-2.5 py-0.5 text-[12.5px]">
              {d}
            </span>
          ))}
          <button type="button" className="rounded-full border border-dashed bg-background px-2.5 py-0.5 text-[12.5px] text-muted-foreground hover:text-foreground">
            Edit
          </button>
        </div>

        {/* Fred's thinking stays one line until you open it */}
        <details className="group justify-self-start">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-[13.5px] text-muted-foreground [&::-webkit-details-marker]:hidden">
            <FredMark className="h-[17px] w-[13px]" />
            <span>
              <b className="font-medium text-foreground">Checked 186 new listings</b> · {steps.length} steps
            </span>
            <ChevronRight size={13} strokeWidth={1.5} className="transition-transform group-open:rotate-90" aria-hidden />
          </summary>
          <ol className="mt-2 ml-1.5 grid list-decimal gap-1 border-l pl-6 text-[13px] text-muted-foreground marker:text-muted-foreground/70">
            {steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </details>

        <p className="max-w-[60ch] text-[15px] leading-relaxed">
          Two baths under $5,000 is rare in Manhattan. I found 3 that allow dogs, all above 110th St. They’re in your inbox, and
          I flagged 1 that looked like a scam.
        </p>
        <p className="text-[15px]">Want me to widen the search?</p>
        <div className="-mt-1 flex flex-wrap gap-2">
          {replies.map((r, i) => (
            <button
              key={r}
              type="button"
              onClick={() => pick(r)}
              className={`rounded-full border bg-background px-3.5 py-1.5 text-[13.5px] font-medium hover:border-foreground ${
                i === replies.length - 1 ? "text-muted-foreground" : ""
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        <p className="mt-1.5 inline-flex items-center gap-2 text-[13px]">
          <FredMark working className="h-[17px] w-[13px] text-muted-foreground" />
          <span className="fred-shimmer">Watching for new places…</span>
        </p>
      </div>

      <form className="px-4 pt-2 pb-4" onSubmit={(e) => e.preventDefault()}>
        <div className="grid gap-3.5 rounded-[14px] border bg-background px-3.5 pt-3 pb-2.5 shadow-xs focus-within:border-foreground/30">
          {context && (
            <span className="inline-flex items-center gap-1.5 justify-self-start rounded-full bg-muted py-0.5 pr-1 pl-2.5 text-[12.5px] text-muted-foreground">
              About <b className="font-medium text-foreground">{context.street}</b>
              <button type="button" onClick={onClearContext} aria-label="Stop asking about this place" className="rounded-full p-0.5 hover:text-foreground">
                <X size={13} strokeWidth={1.5} aria-hidden />
              </button>
            </span>
          )}
          <label htmlFor="composer" className="sr-only">
            Message Fred
          </label>
          <textarea
            id="composer"
            ref={composerRef}
            rows={1}
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            placeholder={context ? "Ask Fred about this place…" : "Tell Fred what you want…"}
            className="max-h-40 resize-none bg-transparent outline-none field-sizing-content placeholder:text-muted-foreground"
          />
          <div className="flex items-center gap-3 text-muted-foreground">
            <button type="button" aria-label="Add a listing link" className="hover:text-foreground">
              <Plus size={18} strokeWidth={1.25} aria-hidden />
            </button>
            <button type="button" aria-label="Talk to Fred" className="ml-auto hover:text-foreground">
              <Mic size={18} strokeWidth={1.25} aria-hidden />
            </button>
            <button
              type="submit"
              aria-label="Send"
              disabled={!draft.trim()}
              className="grid size-8 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
            >
              <ArrowUp size={15} strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
