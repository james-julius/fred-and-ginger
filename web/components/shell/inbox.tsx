"use client";

import { Bell, Check, List, Map as MapIcon } from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { BuildingTile } from "@/components/building-tile";
import { updateAlerts, useMe, useOpportunities, usePlaceLocations, type S } from "@/lib/api/client";
import { alertsLabel, buildingType, money, photoAt, toneClass, transitText } from "@/lib/format";
import { arrange, isHidden, type Sort } from "./arrange";
import type { Pin } from "./places-map";

export type View = "list" | "map";
export type PlaceList = "new" | "saved" | "passed";

const LISTS: Record<PlaceList, { title: string; loading: string; empty: string }> = {
  new: { title: "New places", loading: "Loading new places…", empty: "Nothing new yet. Fred is watching and will add places here as they come up." },
  saved: { title: "Saved", loading: "Loading saved places…", empty: "Nothing saved yet. Save a place you like and it stays here." },
  passed: {
    title: "Passed",
    loading: "Loading places you passed on…",
    empty: "You haven’t passed on anything. Places you pass on wait here in case you change your mind.",
  },
};

/** The places in one list. The API has no passed view yet (board #37), so Passed is every place, filtered. */
export function usePlaces(list: PlaceList) {
  const { data, error } = useOpportunities(list === "passed" ? "all" : list, list === "passed" ? 100 : undefined);
  const items = useMemo(() => (list === "passed" ? data?.items.filter((c) => c.status === "passed") : data?.items), [data, list]);
  return { items, error };
}

// The map library is big, so it only loads when you switch to Map.
const PlacesMap = dynamic(() => import("./places-map"), {
  ssr: false,
  loading: () => <p className="p-4 text-sm text-muted-foreground">Loading the map…</p>,
});

export function Inbox({ list = "new", onOpen, openId, view, onView, sort, onSort }: {
  list?: PlaceList;
  onOpen: (id: string) => void;
  openId: string | null;
  view: View;
  onView: (view: View) => void;
  sort: Sort;
  onSort: (sort: Sort) => void;
}) {
  const { items, error } = usePlaces(list);
  const { data: me } = useMe();
  const groups = arrange(items ?? [], sort);
  const copy = LISTS[list];

  return (
    <section
      aria-label={copy.title}
      className={`bg-background px-4 py-5 lg:min-h-0 lg:px-7 ${view === "map" ? "flex flex-col lg:overflow-hidden" : "lg:overflow-y-auto"}`}
    >
      <div className="mx-auto grid w-full max-w-3xl gap-[18px]">
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight">{copy.title}</h1>
            <div role="group" aria-label="Show places as" className="ml-auto inline-flex rounded-lg border p-0.5">
              {(["list", "map"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => onView(v)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium ${
                    view === v ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {v === "list" ? <List size={14} strokeWidth={1.25} aria-hidden /> : <MapIcon size={14} strokeWidth={1.25} aria-hidden />}
                  {v === "list" ? "List" : "Map"}
                </button>
              ))}
            </div>
            {me && list === "new" && <AlertsMenu mode={me.alerts.mode} />}
          </div>
          {view === "list" && items && items.length > 1 && <SortPills sort={sort} onSort={onSort} />}
        </div>

        {error && <p className="text-sm text-destructive">Couldn’t load these places. Try refreshing.</p>}
        {!items && !error && <p className="text-sm text-muted-foreground">{copy.loading}</p>}
        {items?.length === 0 && <p className="text-sm text-muted-foreground">{copy.empty}</p>}

        {view === "list" &&
          groups.map(({ label, items }) => (
            <div key={label} className="grid gap-2">
              {label && <h2 className="mt-1 text-sm font-semibold text-muted-foreground">{label}</h2>}
              <ul className="overflow-hidden rounded-xl border">
                {items.map((card) => (
                  <li key={card.id} className="border-t first:border-t-0">
                    <Row card={card} unread={!card.seen && card.id !== openId} onOpen={() => onOpen(card.id)} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </div>

      {view === "map" && !!items?.length && <MapView cards={items} openId={openId} onOpen={onOpen} />}
    </section>
  );
}

const ALERT_MODES: { mode: S["AlertMode"]; label: string; hint: string }[] = [
  { mode: "instant_strong", label: "Strong fits right away", hint: "An email as soon as Fred finds a strong fit" },
  { mode: "daily", label: "One daily digest", hint: "Everything new in one email a day. Coming soon." },
  { mode: "off", label: "Off", hint: "Only here in the app" },
];

/**
 * How Fred tells you about new places. Only the mode here for now; Fred sets up the email address and
 * its code in the chat (board #33). An email step in this menu needs the v5 contract merged from main.
 */
function AlertsMenu({ mode }: { mode: S["AlertMode"] }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Close on a click outside or Escape.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const pick = async (next: S["AlertMode"]) => {
    setOpen(false);
    if (next === mode) return;
    setFailed(false);
    try {
      await updateAlerts({ mode: next });
    } catch {
      setFailed(true);
    }
  };

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[13px] font-medium text-muted-foreground hover:text-foreground"
      >
        <Bell size={14} strokeWidth={1.25} aria-hidden />
        {alertsLabel[mode]}
      </button>
      {open && (
        <div role="group" aria-label="Alerts" className="absolute right-0 z-30 mt-1.5 grid w-72 gap-0.5 rounded-xl border bg-background p-1.5 shadow-lg">
          {ALERT_MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              aria-pressed={m.mode === mode}
              onClick={() => pick(m.mode)}
              className="flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-muted"
            >
              <Check size={14} strokeWidth={1.75} className={`mt-[3px] shrink-0 ${m.mode === mode ? "" : "invisible"}`} aria-hidden />
              <span>
                <span className="block text-[13.5px] font-medium">{m.label}</span>
                <span className="block text-[12.5px] text-muted-foreground">{m.hint}</span>
              </span>
            </button>
          ))}
          <p className="mt-1 border-t px-2.5 pt-2 pb-1 text-[12px] text-muted-foreground">
            Alerts come by email. To set yours up, tell Fred your email address in the chat.
          </p>
        </div>
      )}
      {failed && (
        <p role="status" className="absolute right-0 mt-1 text-xs whitespace-nowrap text-destructive">
          Couldn’t change your alerts. Try again.
        </p>
      )}
    </div>
  );
}

/** Newest keeps Fred's day groups. Tapping Price again flips it between low to high and high to low. */
function SortPills({ sort, onSort }: { sort: Sort; onSort: (sort: Sort) => void }) {
  const pills: { key: string; label: string; active: boolean; next: Sort }[] = [
    { key: "newest", label: "Newest", active: sort === "newest", next: "newest" },
    {
      key: "price",
      label: sort === "price-up" ? "Price: low to high" : sort === "price-down" ? "Price: high to low" : "Price",
      active: sort === "price-up" || sort === "price-down",
      next: sort === "price-up" ? "price-down" : "price-up",
    },
    { key: "fit", label: "Best fit", active: sort === "fit", next: "fit" },
    { key: "area", label: "Neighborhood", active: sort === "area", next: "area" },
  ];
  return (
    <div role="group" aria-label="Sort places" className="flex flex-wrap gap-1.5">
      {pills.map((p) => (
        <button
          key={p.key}
          type="button"
          aria-pressed={p.active}
          onClick={() => onSort(p.next)}
          className={`rounded-full border px-3 py-1 text-[13px] font-medium ${
            p.active ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:border-foreground/40 hover:text-foreground"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

function MapView({ cards, openId, onOpen }: { cards: S["OpportunityCard"][]; openId: string | null; onOpen: (id: string) => void }) {
  const shown = useMemo(() => cards.filter((c) => !isHidden(c)), [cards]); // a likely scam's address isn't worth mapping
  const { data: locations } = usePlaceLocations(shown.map((c) => c.id));
  const pins = useMemo<Pin[]>(
    () =>
      shown.flatMap((c) => {
        const at = locations?.[c.id];
        return at
          ? [{ id: c.id, lat: at.lat, lon: at.lon, label: money(c.price), unread: !c.seen && c.id !== openId, warn: c.verdict.tone === "warn" }]
          : [];
      }),
    [shown, locations, openId],
  );
  const missing = locations ? shown.length - pins.length : 0;

  return (
    <div className="mx-auto mt-[18px] grid w-full max-w-3xl gap-2 lg:min-h-0 lg:flex-1 lg:grid-rows-[minmax(0,1fr)_auto]">
      <div className="relative h-[65vh] overflow-hidden rounded-xl border bg-muted lg:h-auto lg:min-h-[420px]">
        {locations ? <PlacesMap pins={pins} onOpen={onOpen} /> : <p className="p-4 text-sm text-muted-foreground">Finding where everything is…</p>}
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-primary" aria-hidden /> New
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border border-border bg-background" aria-hidden /> Seen
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border border-warning bg-background" aria-hidden /> Over budget
        </span>
        {missing > 0 && <span>{missing === 1 ? "1 place has" : `${missing} places have`} no map location</span>}
      </p>
    </div>
  );
}

function Row({ card, unread, onOpen }: { card: S["OpportunityCard"]; unread: boolean; onOpen: () => void }) {
  const hidden = isHidden(card);
  const facts = hidden
    ? card.verdict.reason
    : [`${card.beds} bed${card.baths != null ? `, ${card.baths} bath` : ""}`, card.transit && transitText(card.transit), card.highlight, card.feeCallout?.label]
        .filter(Boolean)
        .join(" · ");

  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid w-full grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3.5 px-4 py-3 text-left hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground"
    >
      {card.thumbnail ? (
        <Image src={photoAt(card.thumbnail, 120)} alt="" width={40} height={40} className="size-10 rounded-[9px] object-cover" />
      ) : (
        <BuildingTile type={buildingType(card.listingId)} />
      )}
      <span className="min-w-0">
        <span
          className={`block text-[15px] font-[550] tracking-tight tabular-nums ${hidden ? "text-muted-foreground line-through decoration-destructive/60" : ""}`}
        >
          {money(card.price)} · {card.area}
        </span>
        <span className="block truncate text-[13px] text-muted-foreground">{facts}</span>
      </span>
      <span className="flex items-center gap-2.5 text-[12.5px] whitespace-nowrap">
        <span className={`font-medium ${toneClass[card.verdict.tone]}`}>{card.verdict.label}</span>
        {unread && (
          <span className="size-2 rounded-full bg-primary">
            <span className="sr-only">Unread</span>
          </span>
        )}
      </span>
    </button>
  );
}
