"use client";

import { Bell, List, Map as MapIcon } from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useMemo } from "react";
import { BuildingTile } from "@/components/building-tile";
import { useMe, useOpportunities, usePlaceLocations, type S } from "@/lib/api/client";
import { alertsLabel, buildingType, money, photoAt, toneClass, transitText } from "@/lib/format";
import { arrange, isHidden, type Sort } from "./arrange";
import type { Pin } from "./places-map";

export type View = "list" | "map";

// The map library is big, so it only loads when you switch to Map.
const PlacesMap = dynamic(() => import("./places-map"), {
  ssr: false,
  loading: () => <p className="p-4 text-sm text-muted-foreground">Loading the map…</p>,
});

export function Inbox({ onOpen, openId, view, onView, sort, onSort }: {
  onOpen: (id: string) => void;
  openId: string | null;
  view: View;
  onView: (view: View) => void;
  sort: Sort;
  onSort: (sort: Sort) => void;
}) {
  const { data: page, error } = useOpportunities("new");
  const { data: me } = useMe();
  const groups = arrange(page?.items ?? [], sort);

  return (
    <section
      aria-label="New places"
      className={`bg-background px-4 py-5 lg:min-h-0 lg:px-7 ${view === "map" ? "flex flex-col lg:overflow-hidden" : "lg:overflow-y-auto"}`}
    >
      <div className="mx-auto grid w-full max-w-3xl gap-[18px]">
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight">New places</h1>
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
            {me && (
              <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[13px] font-medium text-muted-foreground hover:text-foreground">
                <Bell size={14} strokeWidth={1.25} aria-hidden />
                {alertsLabel[me.alerts.mode]}
              </button>
            )}
          </div>
          {view === "list" && page && page.items.length > 1 && <SortPills sort={sort} onSort={onSort} />}
        </div>

        {error && <p className="text-sm text-destructive">Couldn’t load new places. Try refreshing.</p>}
        {!page && !error && <p className="text-sm text-muted-foreground">Loading new places…</p>}
        {page && page.items.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing new yet. Fred is watching and will add places here as they come up.</p>
        )}

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

      {view === "map" && page && page.items.length > 0 && <MapView cards={page.items} openId={openId} onOpen={onOpen} />}
    </section>
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
