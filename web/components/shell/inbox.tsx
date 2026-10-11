"use client";

import { Bell, CalendarDays, ChevronRight, List, Map as MapIcon } from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useMemo } from "react";
import { BuildingTile } from "@/components/building-tile";
import { useMe, useOpportunities, usePlaceLocations, useTours, type S } from "@/lib/api/client";
import { alertsLabel, buildingType, dayLabel, money, photoAt, toneClass, tourTime, transitText } from "@/lib/format";
import type { Pin } from "./places-map";

export type View = "list" | "map";

// The map library is big, so it only loads when you switch to Map.
const PlacesMap = dynamic(() => import("./places-map"), {
  ssr: false,
  loading: () => <p className="p-4 text-sm text-muted-foreground">Loading the map…</p>,
});

const isHidden = (c: S["OpportunityCard"]) => c.status === "hidden" || c.verdict.kind === "likely_scam";

export function Inbox({ onOpen, openId, view, onView }: {
  onOpen: (id: string) => void;
  openId: string | null;
  view: View;
  onView: (view: View) => void;
}) {
  const { data: page, error } = useOpportunities("new");
  const { data: me } = useMe();
  const { data: tours } = useTours();
  const nextTour = tours?.find((t) => t.startsAt && t.status !== "cancelled");

  // Group by the day Fred found each place, newest first (the API sends them in that order).
  const groups: { day: string; items: S["OpportunityCard"][] }[] = [];
  for (const card of page?.items ?? []) {
    const day = dayLabel(card.foundAt);
    if (groups.at(-1)?.day === day) groups.at(-1)!.items.push(card);
    else groups.push({ day, items: [card] });
  }

  return (
    <section
      aria-label="New places"
      className={`bg-background px-4 py-5 lg:min-h-0 lg:px-7 ${view === "map" ? "flex flex-col lg:overflow-hidden" : "lg:overflow-y-auto"}`}
    >
      <div className="mx-auto grid w-full max-w-3xl gap-[18px]">
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

        {nextTour?.startsAt && (
          <button
            type="button"
            onClick={() => onOpen(nextTour.opportunityId)}
            className="flex items-center gap-2.5 rounded-[10px] border px-3.5 py-2.5 text-left text-[13.5px] hover:bg-muted/60"
          >
            <CalendarDays size={16} strokeWidth={1.25} aria-hidden />
            <span>
              <b className="font-semibold">Tour {tourTime(nextTour.startsAt).replace(/^(Today|Tomorrow)/, (d) => d.toLowerCase())}</b> · {nextTour.address}
            </span>
            <ChevronRight size={14} strokeWidth={1.25} className="ml-auto text-muted-foreground" aria-hidden />
          </button>
        )}

        {error && <p className="text-sm text-destructive">Couldn’t load new places. Try refreshing.</p>}
        {!page && !error && <p className="text-sm text-muted-foreground">Loading new places…</p>}
        {page && page.items.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing new yet. Fred is watching and will add places here as they come up.</p>
        )}

        {view === "list" &&
          groups.map(({ day, items }) => (
            <div key={day} className="grid gap-2">
              <h2 className="mt-1 text-sm font-semibold text-muted-foreground">{day}</h2>
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
  const hidden = card.status === "hidden" || card.verdict.kind === "likely_scam";
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
