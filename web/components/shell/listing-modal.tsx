"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Check, ChevronLeft, ChevronRight, CircleCheck, Flag, X } from "lucide-react";
import { FredMark } from "@/components/fred-mark";
import { Gallery } from "@/components/gallery";
import { maxRent, money, partner, scoreTone, shortDate, type Place, type Vote } from "@/lib/places";

const iconButton =
  "grid size-[30px] place-items-center rounded-lg border bg-background hover:bg-muted focus-visible:outline-2 focus-visible:outline-foreground";
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function ListingModal({ place, position, total, myVote, onVote, onStep, onClose, onAsk }: {
  place: Place | null;
  /** 1-based, for the "2 of 4" label. */
  position: number;
  total: number;
  myVote: Vote;
  onVote: (id: string, vote: Vote) => void;
  onStep: (by: 1 | -1) => void;
  onClose: () => void;
  onAsk: (place: Place) => void;
}) {
  return (
    <Dialog.Root open={place !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          // Focus the dialog itself, so the arrow keys work straight away without a ring on the ‹ button.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement | null)?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") onStep(1);
            if (e.key === "ArrowLeft") onStep(-1);
          }}
          className="fixed inset-0 z-50 flex flex-col bg-background text-foreground outline-none sm:inset-auto sm:top-1/2 sm:left-1/2 sm:max-h-[min(900px,calc(100dvh-48px))] sm:w-[min(760px,calc(100vw-48px))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:shadow-2xl"
        >
          {place && (
            <>
              <div className="flex items-center gap-1.5 border-b px-3 py-2.5">
                <button type="button" className={iconButton} onClick={() => onStep(-1)} aria-label="Previous place">
                  <ChevronLeft size={15} strokeWidth={1.25} aria-hidden />
                </button>
                <button type="button" className={iconButton} onClick={() => onStep(1)} aria-label="Next place">
                  <ChevronRight size={15} strokeWidth={1.25} aria-hidden />
                </button>
                <span className="ml-1 text-[12.5px] text-muted-foreground tabular-nums">
                  {position} of {total}
                </span>

                {/* Both your votes, together */}
                <div className="ml-auto flex items-center gap-1.5">
                  {place.theirVote === 1 && (
                    <span className="mr-1 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                      <span className="grid size-5 place-items-center rounded-full bg-stone text-[10px] font-semibold text-highlight-foreground" aria-hidden>
                        {partner[0]}
                      </span>
                      {partner} liked it
                    </span>
                  )}
                  <VoteButton active={myVote === -1} onClick={() => onVote(place.id, myVote === -1 ? null : -1)} icon={<X size={14} strokeWidth={1.5} aria-hidden />}>
                    Pass
                  </VoteButton>
                  <VoteButton active={myVote === 1} onClick={() => onVote(place.id, myVote === 1 ? null : 1)} icon={<Check size={14} strokeWidth={1.5} aria-hidden />}>
                    Like
                  </VoteButton>
                </div>
                <Dialog.Close className={`ml-1 border-transparent ${iconButton}`} aria-label="Close">
                  <X size={15} strokeWidth={1.25} aria-hidden />
                </Dialog.Close>
              </div>

              <div className="grid flex-1 auto-rows-max content-start gap-4 overflow-y-auto px-6 pt-5 pb-6">
                <Gallery key={place.id} photos={place.photos} label={`${place.street}, ${place.neighbourhood}`} />

                <div className="grid gap-0.5">
                  <Dialog.Title className="text-[22px] font-semibold tracking-tight tabular-nums">
                    {money(place.price)} · {place.beds} bed, {place.baths} bath
                  </Dialog.Title>
                  <Dialog.Description className="text-muted-foreground">
                    {[
                      `${place.street}${place.unit ? ` #${place.unit}` : ""}, ${place.neighbourhood}`,
                      place.sqft && `${place.sqft.toLocaleString("en-US")} ft²`,
                      place.agency,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Dialog.Description>
                </div>

                <div className="flex flex-wrap gap-x-3.5 gap-y-2 text-[13px]">
                  {place.fit === "scam" ? (
                    <span className="inline-flex items-center gap-1.5 font-medium text-destructive">
                      <Flag size={14} strokeWidth={1.25} aria-hidden />
                      Flagged: likely scam
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-success">
                      <CircleCheck size={14} strokeWidth={1.25} aria-hidden />
                      Still listed · seen {place.lastSeen}
                    </span>
                  )}
                  <span>On {place.sources.join(" and ")}</span>
                </div>

                {place.fit !== "scam" && <Facts place={place} />}

                <div className="text-sm">
                  <b className="mb-0.5 block text-xs font-semibold text-muted-foreground">{place.whyLabel}</b>
                  {place.why}
                  {place.reasons && (
                    <ul className="grid list-disc gap-1 pl-[18px]">
                      {place.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  )}
                </div>

                {place.building && (
                  <section aria-label="The building" className="grid gap-2.5 rounded-xl border p-3.5">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-semibold text-muted-foreground">The building</span>
                      <span className="ml-auto text-xs text-muted-foreground">from NYC Open Data</span>
                    </div>
                    <div className="flex items-baseline gap-1.5">
                      <span className={`text-3xl leading-none font-semibold tabular-nums ${scoreTone(place.building.score)}`}>
                        {place.building.score}
                      </span>
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

                <div className="grid gap-2.5 rounded-xl border bg-muted p-3.5">
                  <p>{place.ask.question}</p>
                  <div className="flex flex-wrap gap-2">
                    {place.ask.actions.map((a, i) => (
                      <button
                        key={a}
                        type="button"
                        className={`rounded-full border px-[15px] py-[7px] text-[13.5px] font-semibold ${
                          i === 0 ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:border-foreground/40"
                        }`}
                      >
                        {a}
                      </button>
                    ))}
                  </div>
                  <span className="text-[12.5px] text-muted-foreground">{place.ask.note}</span>
                </div>

                {place.fit !== "scam" && (
                  <button type="button" className="justify-self-start text-[12.5px] text-muted-foreground hover:text-foreground">
                    Hide this building
                  </button>
                )}
              </div>

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

// Everything here comes from the listing data. Move-in uses New York's caps:
// a deposit of at most one month, and an application fee of at most $20.
function Facts({ place }: { place: Place }) {
  const last = place.priceHistory.at(-1);
  const previous = place.priceHistory.at(-2);
  const dropped = last && previous && previous[1] > last[1] ? previous[1] - last[1] : 0;
  const over = place.price > maxRent;

  const facts = [
    {
      label: "Rent",
      value: money(place.price),
      note: dropped ? `down ${money(dropped)} this week` : over ? `${money(place.price - maxRent)} over your max` : "no price changes",
      tone: over ? "text-warning" : "",
    },
    { label: "Move-in", value: money(place.price * 2 + 20), note: "first month, 1-month deposit, $20 application", tone: "" },
    {
      label: "Available",
      value: place.available ? shortDate(place.available) : "Not listed",
      note: place.available ? "per the listing" : "ask the landlord",
      tone: "",
    },
    {
      label: "Broker fee",
      value: place.noFee === true ? "None" : place.noFee === false ? "Yes" : "Unknown",
      note: place.noFee === null ? "the listing doesn’t say" : place.agency ?? "",
      tone: "",
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
