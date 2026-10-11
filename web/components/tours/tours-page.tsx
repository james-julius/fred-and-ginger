"use client";

import { CalendarDays } from "lucide-react";
import { useState } from "react";
import { FredMark } from "@/components/fred-mark";
import { ListingModal } from "@/components/shell/listing-modal";
import { useAskFred } from "@/components/shell/shell";
import { updateTour, useTours, type S } from "@/lib/api/client";
import { fromNycInput, nycInputValue, tourStatusLabel, tourTime } from "@/lib/format";

const input = "h-8 rounded-lg border bg-background px-2.5 text-[13px] outline-none focus:border-foreground/40 disabled:opacity-40";
const button = "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-semibold hover:border-foreground/40";
const STATUSES = Object.keys(tourStatusLabel) as S["Tour"]["status"][];

/** Fred notes the times you asked for as ISO dates ("Asked for: 2026-10-14T22:00:00Z"); say them like the rest of the app. */
const readable = (notes: string) =>
  notes.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?/g, (iso) => (Number.isNaN(Date.parse(iso)) ? iso : tourTime(iso)));

export function ToursPage() {
  const { data: upcoming, error } = useTours("upcoming");
  const { data: past } = useTours("past");
  const [openId, setOpenId] = useState<string | null>(null);
  const askFred = useAskFred();
  const ask = (place: { id: string; label: string }) => {
    setOpenId(null);
    askFred(place);
  };

  return (
    <>
      <section aria-label="Tours" className="bg-background px-4 py-5 lg:min-h-0 lg:overflow-y-auto lg:px-7">
        <div className="mx-auto grid max-w-2xl gap-6">
          <div className="grid gap-1">
            <h1 className="text-xl font-semibold tracking-tight">Tours</h1>
            <p className="text-[13px] text-muted-foreground">
              Ask Fred about a place to set up a tour. He drafts the request for you to send, and nothing goes out on its own. Keep each tour’s status and
              time here as you hear back.
            </p>
          </div>

          {error && <p className="text-sm text-destructive">Couldn’t load your tours. Try refreshing.</p>}
          {!upcoming && !error && <p className="text-sm text-muted-foreground">Loading tours…</p>}
          {upcoming?.length === 0 && (
            <p className="text-sm text-muted-foreground">No tours coming up. Open a place and tap “Ask Fred about this place” to set one up.</p>
          )}
          {!!upcoming?.length && <Tours label="Coming up" tours={upcoming} onOpen={setOpenId} onAsk={ask} />}
          {!!past?.length && <Tours label="Past" tours={past} onOpen={setOpenId} onAsk={ask} />}
        </div>
      </section>
      <ListingModal id={openId} onClose={() => setOpenId(null)} onAsk={(place) => ask({ id: place.id, label: place.address })} />
    </>
  );
}

function Tours({ label, tours, onOpen, onAsk }: {
  label: string;
  tours: S["Tour"][];
  onOpen: (placeId: string) => void;
  onAsk: (place: { id: string; label: string }) => void;
}) {
  return (
    <div className="grid gap-2">
      <h2 className="text-sm font-semibold text-muted-foreground">{label}</h2>
      <ul className="overflow-hidden rounded-xl border">
        {tours.map((t) => (
          <Tour key={t.id} tour={t} onOpen={() => onOpen(t.opportunityId)} onAsk={() => onAsk({ id: t.opportunityId, label: t.address })} />
        ))}
      </ul>
    </div>
  );
}

function Tour({ tour, onOpen, onAsk }: { tour: S["Tour"]; onOpen: () => void; onAsk: () => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const when = tour.startsAt ? nycInputValue(tour.startsAt) : "";

  const save = async (patch: S["TourPatch"]) => {
    setBusy(true);
    setProblem(null);
    try {
      await updateTour(tour.id, patch);
    } catch {
      setProblem("Couldn’t save that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="grid gap-3 border-t px-4 py-3.5 first:border-t-0">
      <div className="flex items-start gap-3">
        <CalendarDays size={18} strokeWidth={1.25} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <p className={`font-[550] tracking-tight ${tour.status === "cancelled" ? "text-muted-foreground line-through" : ""}`}>
            {tour.startsAt ? tourTime(tour.startsAt) : "No time yet"}
          </p>
          <p className="truncate text-[13.5px] text-muted-foreground">{[tour.address, tour.contact].filter(Boolean).join(" · ")}</p>
          {tour.notes && <p className="mt-1 text-[13px]">{readable(tour.notes)}</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:pl-[30px]">
        <label htmlFor={`tour-status-${tour.id}`} className="sr-only">
          Status
        </label>
        <select
          id={`tour-status-${tour.id}`}
          className={input}
          value={tour.status}
          disabled={busy}
          onChange={(e) => save({ status: e.target.value as S["Tour"]["status"] })}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {tourStatusLabel[s]}
            </option>
          ))}
        </select>
        <label htmlFor={`tour-time-${tour.id}`} className="sr-only">
          Time, in New York time
        </label>
        {/* Keyed by the saved time, so it starts over from what's saved after each change. */}
        <input
          key={when}
          id={`tour-time-${tour.id}`}
          type="datetime-local"
          title="New York time"
          className={input}
          defaultValue={when}
          disabled={busy}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          onBlur={(e) => {
            const value = e.target.value;
            if (value !== when) void save({ startsAt: value ? fromNycInput(value) : null });
          }}
        />
        <span className="flex gap-2 sm:ml-auto">
          <button type="button" onClick={onOpen} className={button}>
            Open the listing
          </button>
          <button type="button" onClick={onAsk} className={button}>
            <FredMark className="h-[15px] w-[11px]" />
            Ask Fred
          </button>
        </span>
      </div>
      {problem && (
        <p role="status" className="text-[12.5px] text-destructive sm:pl-[30px]">
          {problem}
        </p>
      )}
    </li>
  );
}
