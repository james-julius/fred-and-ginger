"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpRight, Check, ChevronLeft, ChevronRight, CircleCheck, Flag, Share, X } from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useState } from "react";
import { FredMark } from "@/components/fred-mark";
import { Gallery } from "@/components/gallery";
import { updateOpportunity, useOpportunity, useSearch, type S } from "@/lib/api/client";
import { money, photoAt, scoreTone, shortDate, siteName, toneClass } from "@/lib/format";
import { PassReasons } from "./pass-reasons";

// MapLibre is big, so it loads with the first listing that has a location.
const MiniMap = dynamic(() => import("./places-map").then((m) => m.MiniMap), {
  ssr: false,
  loading: () => <div className="size-full bg-muted" />,
});

// Stepping between places and closing are the main moves, so they get big, thumb-sized buttons.
// The steppers sit at the bottom middle, where a thumb rests on a phone.
const bigButton =
  "grid size-10 shrink-0 place-items-center rounded-full border bg-background hover:bg-muted focus-visible:outline-2 focus-visible:outline-foreground";
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function ListingModal({ id, preview, position = 0, total = 0, onStep, onClose, onAsk }: {
  id: string | null;
  /** The place's card from the list, if there is one: its photo, price and verdict show while the details load. */
  preview?: S["OpportunityCard"];
  /** 1-based, for the "2 of 4" label. 0 when the open place isn't in the list, say one opened from the chat. */
  position?: number;
  total?: number;
  /** Leave out where there's no list to step through, like a tour's place. */
  onStep?: (by: 1 | -1) => void;
  onClose: () => void;
  onAsk: (place: S["OpportunityDetail"]) => void;
}) {
  const { data: place, error } = useOpportunity(id);
  // The place you just passed on. The bar under the header keeps its Undo, and asks what put you off.
  const [passed, setPassed] = useState<{ id: string; label: string; note: string | null; said: boolean } | null>(null);
  // Closing starts the next open fresh.
  const [wasOpen, setWasOpen] = useState(id !== null);
  if ((id !== null) !== wasOpen) {
    setWasOpen(id !== null);
    if (id === null) setPassed(null);
  }

  // Save and pass map to the API's status, and tapping the active one puts the place back in New.
  // Passing moves on to the next place in the list, before the refresh drops this one from it.
  const vote = (current: S["OpportunityDetail"], status: S["OpportunityStatus"]) => {
    const next = current.status === status ? "new" : status;
    if (next === "passed") {
      setPassed({ id: current.id, label: `${current.address}${current.unit ? ` #${current.unit}` : ""}`, note: current.note, said: false });
      if (onStep && position > 0 && total > 1) onStep(1);
    } else if (passed?.id === current.id) setPassed(null);
    return updateOpportunity(current.id, { status: next });
  };
  const undo = async () => {
    if (!passed) return;
    await updateOpportunity(passed.id, { status: "new" });
    setPassed(null);
  };

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
          // On a phone it's a sheet with a strip of the page showing above it: tap there to close, like outside a dialog.
          className="fixed inset-x-0 top-10 bottom-0 z-50 flex flex-col rounded-t-2xl bg-background text-foreground outline-none sm:inset-auto sm:top-1/2 sm:left-1/2 sm:max-h-[min(900px,calc(100dvh-48px))] sm:w-[min(760px,calc(100vw-48px))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:shadow-2xl"
        >
          <div className="flex items-center gap-1.5 border-b px-3 py-2.5">
            {place ? <Votes place={place} onVote={(status) => vote(place, status)} /> : !error && <VotesSkeleton />}
            <Dialog.Close className={`${place || !error ? "ml-1" : "ml-auto"} border-transparent ${bigButton}`} aria-label="Close">
              <X size={20} strokeWidth={1.5} aria-hidden />
            </Dialog.Close>
          </div>
          {passed && (
            <div className="grid gap-2.5 border-b bg-muted/40 px-4 py-3">
              <div className="flex items-center gap-2 text-[13.5px]">
                <X size={14} strokeWidth={1.75} className="shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  <b className="font-semibold">Passed</b> · {passed.label}
                </span>
                <button type="button" onClick={undo} className="font-semibold underline decoration-muted-foreground/60 underline-offset-2 hover:decoration-foreground">
                  Undo
                </button>
                <button type="button" onClick={() => setPassed(null)} aria-label="Dismiss" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                  <X size={14} strokeWidth={1.5} aria-hidden />
                </button>
              </div>
              {!passed.said && <PassReasons place={{ id: passed.id, note: passed.note }} onDone={() => setPassed((p) => p && { ...p, said: true })} />}
            </div>
          )}

          {!place && error ? (
            <div className="grid flex-1 place-items-center p-10 text-sm text-muted-foreground">
              <Dialog.Title className="sr-only">Listing</Dialog.Title>
              Couldn’t load this place. Try again in a moment.
            </div>
          ) : !place ? (
            <DetailsSkeleton preview={preview?.id === id ? preview : undefined} />
          ) : (
            <Details place={place} />
          )}
          {/* The steppers stay put while the next place loads, so tapping › again lands on the same spot. */}
          {((onStep && total > 0) || place) && (
            <div className="grid gap-1.5 border-t px-3.5 py-2.5">
              {onStep && total > 0 && (
                <div className="flex items-center justify-center gap-3">
                  <button type="button" className={bigButton} onClick={() => onStep(-1)} aria-label="Previous place">
                    <ChevronLeft size={20} strokeWidth={1.5} aria-hidden />
                  </button>
                  {position > 0 && (
                    <span className="min-w-16 text-center text-[12.5px] text-muted-foreground tabular-nums">
                      {position} of {total}
                    </span>
                  )}
                  <button type="button" className={bigButton} onClick={() => onStep(1)} aria-label="Next place">
                    <ChevronRight size={20} strokeWidth={1.5} aria-hidden />
                  </button>
                </div>
              )}
              {place && (
                <div className="flex">
                  <button
                    type="button"
                    onClick={() => onAsk(place)}
                    className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13.5px] font-medium hover:bg-muted"
                  >
                    <FredMark className="h-[17px] w-[13px]" />
                    Ask Fred about this place
                  </button>
                  <ShareButton place={place} />
                </div>
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Shares the listing's own page (StreetEasy and the like), since that opens for anyone, where a Fred
 * link would ask them to sign in. Browsers that can't share copy it instead.
 */
function ShareButton({ place }: { place: S["OpportunityDetail"] }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const address = `${place.address}${place.unit ? ` #${place.unit}` : ""}`;
    const text = `${money(place.price)} · ${place.beds} bed${place.baths != null ? `, ${place.baths} bath` : ""} in ${place.area}: ${address}`;
    const url = place.sources[0]?.url ?? window.location.href;
    if (navigator.share) return navigator.share({ title: address, text, url }).catch(() => {}); // closing the share sheet rejects
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };
  return (
    <button type="button" onClick={share} className="ml-auto inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13.5px] font-medium hover:bg-muted">
      {copied ? <Check size={16} strokeWidth={1.5} aria-hidden /> : <Share size={16} strokeWidth={1.25} aria-hidden />}
      <span aria-live="polite">{copied ? "Link copied" : "Share"}</span>
    </button>
  );
}

function Votes({ place, onVote }: { place: S["OpportunityDetail"]; onVote: (status: S["OpportunityStatus"]) => void }) {
  return (
    <div className="ml-auto flex items-center gap-1.5">
      <VoteButton active={place.status === "passed"} onClick={() => onVote("passed")} icon={<X size={14} strokeWidth={1.5} aria-hidden />}>
        Pass
      </VoteButton>
      <VoteButton active={place.status === "saved"} onClick={() => onVote("saved")} icon={<Check size={14} strokeWidth={1.5} aria-hidden />}>
        Save
      </VoteButton>
    </div>
  );
}

const pulse = "bg-muted motion-safe:animate-pulse";

/**
 * The listing's shape while its details load, so nothing jumps when they arrive. What the list already
 * knows (the photo, price, rooms and verdict) shows straight away.
 */
function DetailsSkeleton({ preview }: { preview?: S["OpportunityCard"] }) {
  return (
    <div aria-busy="true" className="grid flex-1 auto-rows-max content-start gap-4 overflow-hidden px-6 pt-5 pb-6">
      <div className="grid gap-2">
        {preview?.thumbnail ? (
          <Image src={photoAt(preview.thumbnail, 1280)} alt="" width={1280} height={800} priority className="aspect-[16/10] w-full rounded-xl bg-muted object-cover" />
        ) : (
          <div className={`aspect-[16/10] rounded-xl ${pulse}`} />
        )}
        <div className="grid grid-cols-4 gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={`aspect-[16/10] rounded-md ${pulse}`} />
          ))}
        </div>
      </div>

      <div className="grid gap-1.5">
        {preview ? (
          <Dialog.Title className="text-[22px] font-semibold tracking-tight tabular-nums">
            {money(preview.price)} · {preview.beds} bed{preview.baths != null && `, ${preview.baths} bath`}
          </Dialog.Title>
        ) : (
          <>
            <Dialog.Title className="sr-only">Loading the listing</Dialog.Title>
            <div className={`h-7 w-60 max-w-full rounded-md ${pulse}`} />
          </>
        )}
        <div className={`h-5 w-80 max-w-full rounded-md ${pulse}`} />
      </div>

      <div className="flex items-center text-[13px]">
        {preview ? (
          <span className={`inline-flex items-center gap-1.5 font-medium ${toneClass[preview.verdict.tone]}`}>
            {preview.verdict.tone === "bad" ? <Flag size={14} strokeWidth={1.25} aria-hidden /> : <CircleCheck size={14} strokeWidth={1.25} aria-hidden />}
            {preview.verdict.label}
          </span>
        ) : (
          <div className={`h-4 w-32 rounded-md ${pulse}`} />
        )}
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="grid gap-1.5 bg-background px-3 py-2.5">
            <div className={`h-3 w-14 rounded ${pulse}`} />
            <div className={`h-5 w-20 rounded ${pulse}`} />
            <div className={`h-3 w-24 max-w-full rounded ${pulse}`} />
          </div>
        ))}
      </div>

      <div className="grid gap-2">
        <div className={`h-3.5 w-24 rounded ${pulse}`} />
        {["w-3/4", "w-2/3", "w-1/2"].map((w) => (
          <div key={w} className={`h-4 rounded ${w} ${pulse}`} />
        ))}
      </div>
    </div>
  );
}

/** Where Pass and Save go, so the header doesn't shift when they arrive. */
function VotesSkeleton() {
  return (
    <div className="ml-auto flex items-center gap-1.5" aria-hidden>
      <div className={`h-[30px] w-[72px] rounded-full ${pulse}`} />
      <div className={`h-[30px] w-[72px] rounded-full ${pulse}`} />
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
