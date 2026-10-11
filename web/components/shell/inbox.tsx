"use client";

import { Bell, CalendarDays, ChevronRight } from "lucide-react";
import Image from "next/image";
import { BuildingTile } from "@/components/building-tile";
import { useMe, useOpportunities, useTours, type S } from "@/lib/api/client";
import { alertsLabel, buildingType, dayLabel, money, photoAt, toneClass, tourTime, transitText } from "@/lib/format";

export function Inbox({ onOpen, openId }: { onOpen: (id: string) => void; openId: string | null }) {
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
    <section aria-label="New places" className="bg-background px-4 py-5 lg:min-h-0 lg:overflow-y-auto lg:px-7">
      <div className="mx-auto grid max-w-3xl gap-[18px]">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-xl font-semibold tracking-tight">New places</h1>
          {me && (
            <button type="button" className="ml-auto inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[13px] font-medium text-muted-foreground hover:text-foreground">
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

        {groups.map(({ day, items }) => (
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
    </section>
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
