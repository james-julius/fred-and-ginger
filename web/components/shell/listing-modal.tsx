"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpRight, Check, ChevronLeft, ChevronRight, CircleCheck, Flag, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { FredMark } from "@/components/fred-mark";
import { Gallery } from "@/components/gallery";
import { updateOpportunity, useOpportunity, useSearch, type S } from "@/lib/api/client";
import { money, scoreTone, shortDate, siteName, toneClass } from "@/lib/format";
import { PassReasons } from "./pass-reasons";

// MapLibre is big, so it loads with the first listing that has a location.
const MiniMap = dynamic(() => import("./places-map").then((m) => m.MiniMap), {
  ssr: false,
  loading: () => <div className="size-full bg-muted" />,
});

const iconButton =
  "grid size-[30px] place-items-center rounded-lg border bg-background hover:bg-muted focus-visible:outline-2 focus-visible:outline-foreground";
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function ListingModal({ id, position = 0, total = 0, onStep, onClose, onAsk }: {
  id: string | null;
  /** 1-based, for the "2 of 4" label. 0 when the open place isn't in the list, say one opened from the chat. */
  position?: number;
  total?: number;
  /** Leave out where there's no list to step through, like a tour's place. */
  onStep?: (by: 1 | -1) => void;
  onClose: () => void;
  onAsk: (place: S["OpportunityDetail"]) => void;
}) {
  const { data: place, error } = useOpportunity(id);
  const [asking, setAsking] = useState<string | null>(null); // the place just passed: ask what put them off

  return (
    <Dialog.Root open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          // Focus the dialog itself, so the arrow keys work straight away without a ring on the ‹ button.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement | null)?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") onStep?.(1);
            if (e.key === "ArrowLeft") onStep?.(-1);
          }}
          className="fixed inset-0 z-50 flex flex-col bg-background text-foreground outline-none sm:inset-auto sm:top-1/2 sm:left-1/2 sm:max-h-[min(900px,calc(100dvh-48px))] sm:w-[min(760px,calc(100vw-48px))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:shadow-2xl"
        >
          <div className="flex items-center gap-1.5 border-b px-3 py-2.5">
            {onStep && total > 0 && (
              <>
                <button type="button" className={iconButton} onClick={() => onStep(-1)} aria-label="Previous place">
                  <ChevronLeft size={15} strokeWidth={1.25} aria-hidden />
                </button>
                <button type="button" className={iconButton} onClick={() => onStep(1)} aria-label="Next place">
                  <ChevronRight size={15} strokeWidth={1.25} aria-hidden />
                </button>
              </>
            )}
            {position > 0 && total > 0 && (
              <span className="ml-1 text-[12.5px] text-muted-foreground tabular-nums">
                {position} of {total}
              </span>
            )}
            {place && <Votes place={place} onPass={(passed) => setAsking(passed ? place.id : null)} />}
            <Dialog.Close className={`${place ? "ml-1" : "ml-auto"} border-transparent ${iconButton}`} aria-label="Close">
              <X size={15} strokeWidth={1.25} aria-hidden />
            </Dialog.Close>
          </div>
          {place && asking === place.id && (
            <div className="flex items-start gap-3 border-b bg-muted/40 px-4 py-3">
              <div className="min-w-0 flex-1">
                <PassReasons place={place} onDone={() => setAsking(null)} />
              </div>
              <button type="button" onClick={() => setAsking(null)} className="text-[13px] text-muted-foreground hover:text-foreground">
                Skip
              </button>
            </div>
          )}

          {!place ? (
            <div className="grid flex-1 place-items-center p-10 text-sm text-muted-foreground">
              <Dialog.Title className="sr-only">Listing</Dialog.Title>
              {error ? "Couldn’t load this place. Try again in a moment." : "Loading…"}
            </div>
          ) : (
            <>
              <Details place={place} />
              <div className="flex border-t px-3.5 py-2.5">
                <button
                  type="button"
                  onClick={() => onAsk(place)}
                  className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13.5px] font-medium hover:bg-muted"
                >
                  <FredMark className="h-[17px] w-[13px]" />
                  Ask Fred about this place
                </button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// Save and pass map to the API's status. Tapping the active one puts the place back in New.
// Passing also asks what put them off (onPass(true)); un-passing or saving drops the question.
function Votes({ place, onPass }: { place: S["OpportunityDetail"]; onPass: (passed: boolean) => void }) {
  const set = (status: S["OpportunityStatus"]) => {
    const next = place.status === status ? "new" : status;
    onPass(next === "passed");
    return updateOpportunity(place.id, { status: next });
  };
  return (
    <div className="ml-auto flex items-center gap-1.5">
      <VoteButton active={place.status === "passed"} onClick={() => set("passed")} icon={<X size={14} strokeWidth={1.5} aria-hidden />}>
        Pass
      </VoteButton>
      <VoteButton active={place.status === "saved"} onClick={() => set("saved")} icon={<Check size={14} strokeWidth={1.5} aria-hidden />}>
        Save
      </VoteButton>
    </div>
  );
}

function Details({ place }: { place: S["OpportunityDetail"] }) {
  const scam = place.verdict.kind === "likely_scam";
  return (
    <div className="grid flex-1 auto-rows-max content-start gap-4 overflow-y-auto px-6 pt-5 pb-6">
      <Gallery key={place.id} photos={place.photos} label={`${place.address}, ${place.area}`} />

      <div className="grid gap-0.5">
        <Dialog.Title className="text-[22px] font-semibold tracking-tight tabular-nums">
          {money(place.price)} · {place.beds} bed{place.baths != null && `, ${place.baths} bath`}
        </Dialog.Title>
        <p className="text-muted-foreground">
          {[`${place.address}${place.unit ? ` #${place.unit}` : ""}, ${place.area}`, place.sqft && `${place.sqft.toLocaleString("en-US")} ft²`]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 text-[13px]">
        <span className={`inline-flex items-center gap-1.5 font-medium ${toneClass[place.verdict.tone]}`}>
          {place.verdict.tone === "bad" ? <Flag size={14} strokeWidth={1.25} aria-hidden /> : <CircleCheck size={14} strokeWidth={1.25} aria-hidden />}
          {place.verdict.label}
          {place.verdict.reason && <span className="font-normal text-muted-foreground">· {place.verdict.reason}</span>}
        </span>
        {place.sources.map((s) => (
          <a key={s.url} href={s.url} target="_blank" rel="noopener" className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground">
            {siteName(s.site)}
            <ArrowUpRight size={13} strokeWidth={1.25} aria-hidden />
          </a>
        ))}
      </div>

      {!scam && <Facts place={place} />}

      {(place.take.why.length > 0 || place.take.concerns.length > 0) && (
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          {place.take.why.length > 0 && <List label={scam ? "Why Fred flagged it" : "Why this one"} items={place.take.why} />}
          {place.take.concerns.length > 0 && <List label="Worth knowing" items={place.take.concerns} />}
        </div>
      )}

      {place.location && (
        <section aria-label="Where it is" className="grid gap-2">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-semibold text-muted-foreground">Where it is</span>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${place.location.lat},${place.location.lon}`}
              target="_blank"
              rel="noopener"
              className="ml-auto inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
            >
              Google Maps
              <ArrowUpRight size={13} strokeWidth={1.25} aria-hidden />
            </a>
          </div>
          <div className="h-44 overflow-hidden rounded-xl border">
            <MiniMap key={place.id} lat={place.location.lat} lon={place.location.lon} />
          </div>
        </section>
      )}

      {place.building && (
        <section aria-label="The building" className="grid gap-2.5 rounded-xl border p-3.5">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-semibold text-muted-foreground">The building</span>
            <span className="ml-auto text-xs text-muted-foreground">from NYC Open Data</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className={`text-3xl leading-none font-semibold tabular-nums ${scoreTone(place.building.score)}`}>{place.building.score}</span>
            <span className="text-sm text-muted-foreground">out of 100</span>
          </div>
          <ul className="grid gap-1 text-[13.5px]">
            {place.building.flags.map((f) => (
              <li key={f} className="flex gap-2">
                <Flag size={14} strokeWidth={1.25} className="mt-[3px] shrink-0 text-warning" aria-hidden />
                {sentence(f)}
              </li>
            ))}
            {place.building.good.map((g) => (
              <li key={g} className="flex gap-2">
                <CircleCheck size={14} strokeWidth={1.25} className="mt-[3px] shrink-0 text-success" aria-hidden />
                {sentence(g)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(place.description || place.amenities.length > 0 || place.pets) && (
        <section aria-label="From the listing" className="grid gap-2 text-sm">
          <span className="text-xs font-semibold text-muted-foreground">From the listing</span>
          {place.description && <p className="leading-relaxed">{place.description}</p>}
          {(place.amenities.length > 0 || place.pets) && (
            <ul className="flex flex-wrap gap-1.5">
              {[...place.amenities, ...(place.pets ? [place.pets] : [])].map((a) => (
                <li key={a} className="rounded-full border px-2.5 py-0.5 text-[12.5px]">
                  {a}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!scam && (
        <button
          type="button"
          onClick={() => updateOpportunity(place.id, { status: "hidden" })}
          className="justify-self-start text-[12.5px] text-muted-foreground hover:text-foreground"
        >
          Hide this place
        </button>
      )}
    </div>
  );
}

// Everything here is from the API's costs. Move-in is its estimate of what's due before you get the keys.
function Facts({ place }: { place: S["OpportunityDetail"] }) {
  const { data: search } = useSearch();
  const max = search?.dealbreakers.maxTotalMonthly ?? null;
  const c = place.costs;
  const over = max != null && c.totalMonthly > max;
  const [previous, latest] = place.priceHistory.slice(-2);
  const drop = previous && latest && previous.price > latest.price ? previous.price - latest.price : 0;

  const facts = [
    {
      label: "Monthly",
      value: money(c.totalMonthly),
      note: [
        c.monthlyFees > 0 ? `${money(c.rent)} rent + ${money(c.monthlyFees)} fees` : "no monthly fees",
        over && `${money(c.totalMonthly - max)} over your max`,
        drop && `down ${money(drop)}`,
      ]
        .filter(Boolean)
        .join(" · "),
      tone: over ? "text-warning" : "",
    },
    { label: "Move-in", value: c.moveInEstimate != null ? money(c.moveInEstimate) : "Unknown", note: "first month, deposit and fees", tone: "" },
    { label: "Available", value: place.available ? shortDate(place.available) : "Not listed", note: place.available ? "per the listing" : "ask the landlord", tone: "" },
    {
      label: "Broker fee",
      value: { none: "None", tenant: "You pay", unknown: "Unknown" }[c.brokerFee],
      note: c.brokerFee === "unknown" ? "the listing doesn’t say" : c.brokerFee === "none" ? "no fee to you" : "check the amount",
      tone: c.brokerFee === "tenant" ? "text-warning" : "",
    },
  ];

  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
      {facts.map((f) => (
        <div key={f.label} className="min-w-0 bg-background px-3 py-2.5">
          <dt className="text-xs text-muted-foreground">{f.label}</dt>
          <dd className={`text-lg leading-tight font-semibold tracking-tight tabular-nums ${f.tone}`}>
            {f.value}
            <small className="mt-0.5 block text-[11.5px] leading-snug font-normal tracking-normal text-muted-foreground">{f.note}</small>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function List({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <b className="mb-1 block text-xs font-semibold text-muted-foreground">{label}</b>
      <ul className="grid list-disc gap-1 pl-[18px]">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  );
}

function VoteButton({ active, onClick, icon, children }: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-semibold ${
        active ? "border-primary bg-primary text-primary-foreground" : "hover:border-foreground/40"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
