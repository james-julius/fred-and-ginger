"use client";

import { Check, ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import useSWR, { mutate } from "swr";
import { BuildingTile } from "@/components/building-tile";
import { api, updateOpportunity, type S } from "@/lib/api/client";
import { buildingType, money, photoAt, toneClass } from "@/lib/format";
import { areasOf, describe, plural, statusOf, titleCase, type ToolCall } from "./fred-tools";
import { PassReasons } from "./pass-reasons";

/** A reply gets the search card when Fred looks for places in it. */
export const isSearch = (t: ToolCall) => t.name === "searchListings" || t.name === "addToInbox";

const RESEARCH = ["readListingPage", "researchWeb", "getPlace"];
const STEPS = ["Searching listings", "Reviewing matches", "Picking the best"];

type Phase = "pending" | "active" | "done" | "stopped" | "skipped";

const spinner = "size-[11px] shrink-0 animate-spin rounded-full border-[1.5px] border-border border-t-foreground";
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Open a place's listing. On New places, keep the current view (list or map). */
function useOpenPlace() {
  const router = useRouter();
  return (id: string) => {
    const params = new URLSearchParams(window.location.pathname === "/" ? window.location.search : "");
    params.set("place", id);
    router.push(`/?${params}`, { scroll: false });
  };
}

/**
 * Fred's search, the way Jack & Jill show a job search: numbered steps and a lit-up skyline while
 * Fred works, then the places it picked, to save or pass on without leaving the chat. Fred's
 * written answer follows the card.
 */
export function SearchCard({ tools, scans, places = [], running }: { tools: ToolCall[]; scans: S["DataScan"][]; places?: DataPlaces[]; running: boolean }) {
  const [open, setOpen] = useState(true);

  const searches = tools.filter((t) => t.name === "searchListings");
  const research = tools.filter((t) => RESEARCH.includes(t.name));
  const add = tools.findLast((t) => t.name === "addToInbox");
  const searching = searches.find((t) => statusOf(t) === "running");
  const reading = research.findLast((t) => statusOf(t) === "running");
  // 0 searching, 1 reviewing, 2 picking, 3 finished
  const step = searching ? 0 : add ? (statusOf(add) === "done" ? 3 : 2) : searches.length ? 1 : 0;
  const phase = (i: number): Phase =>
    i < step ? "done" : i > step ? (running ? "pending" : "skipped") : running ? "active" : step === 1 ? "done" : "stopped";
  const status = step === 3 ? "done" : running ? "running" : STEPS.some((_, i) => phase(i) === "stopped") ? "stopped" : "done";

  // The places Fred added. Likely scams go in hidden, so they aren't shown.
  const { ids, scams } = places.length ? fromParts(places) : fromInput(add);

  const checked = scans.reduce((n, s) => n + s.checked, 0);
  const matched = scans.reduce((n, s) => n + s.matched, 0);
  const last = searches.at(-1);
  const filters = last ? filtersOf(last) : [];
  const details = [
    last ? [areasOf(last), ...filters].join(" · ") : "Getting ready",
    reading ? describe(reading).now : matched ? `Comparing ${plural(matched, "match", "matches")}` : "Reading through the results",
    add && Array.isArray(add.input.places) ? `Writing up ${plural(add.input.places.length, "place")}` : "Choosing",
  ];
  // What floats over the skyline: the areas and filters Fred is searching, then listings from the
  // results ("2 bd · $3,400 · Harlem") once they're in, then what it's reading.
  const samples = scans.flatMap((s) => s.samples ?? []);
  const searched = [...searches.flatMap((t) => (Array.isArray(t.input.areas) ? (t.input.areas as string[]).map(titleCase) : ["All of NYC"])), ...filters];
  const labels = [...(samples.length ? samples : searched), ...research.map((t) => describe(t).now)];

  return (
    <section aria-label="Apartment search" className="w-full max-w-[34rem] overflow-hidden rounded-xl border bg-background">
      <header className={`flex items-center gap-3 px-4 py-3 ${open ? "border-b" : ""}`}>
        <h3 className="text-[15px] font-semibold tracking-tight">Apartment search</h3>
        <span aria-live="polite" className="ml-auto">
          {status === "running" && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[13px] font-medium">
              <span className={spinner} aria-hidden />
              Searching
            </span>
          )}
          {status === "done" && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-[13px] font-medium text-success">
              <Check size={13} strokeWidth={2} aria-hidden />
              Done
            </span>
          )}
          {status === "stopped" && <span className="rounded-full bg-muted px-2.5 py-1 text-[13px] font-medium text-muted-foreground">Stopped</span>}
        </span>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronDown size={16} strokeWidth={1.5} className={`transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
          <span className="sr-only">{open ? "Hide the search" : "Show the search"}</span>
        </button>
      </header>

      {open &&
        (ids.length ? (
          <Results ids={ids} scams={scams} />
        ) : (
          <div className="px-4 pt-3 pb-4">
            <div className="flex justify-between text-[12.5px] text-muted-foreground">
              <span>Step</span>
              {checked > 0 && <span>Listings checked</span>}
            </div>
            <ol className="mt-1 grid">
              {STEPS.map((label, i) => (
                <StepRow key={label} n={i + 1} label={label} phase={phase(i)} detail={details[i]} count={i === 0 && checked > 0 ? checked : null} live={running} />
              ))}
            </ol>
            {running && step < 3 && <Skyline labels={labels} />}
            {!running && step === 1 && <p className="mt-2 text-[13px] text-muted-foreground">Nothing worth adding this time.</p>}
          </div>
        ))}
    </section>
  );
}

/** Chat part data-places: the places addToInbox added, best first, and which it hid as likely scams. */
export type DataPlaces = S["DataPlaces"];

function fromParts(parts: DataPlaces[]) {
  const all = [...new Set(parts.flatMap((p) => p.ids))], hidden = new Set(parts.flatMap((p) => p.hidden));
  const ids = all.filter((id) => !hidden.has(id));
  return { ids, scams: all.length - ids.length };
}

/** Before data-places: what Fred asked addToInbox to add. "op_317" ids now, listing ids in older threads. */
function fromInput(add: ToolCall | undefined) {
  const picks = add && statusOf(add) === "done" && Array.isArray(add.input.places) ? (add.input.places as { id?: string; listingId?: number; verdict?: string }[]) : [];
  const all = picks.flatMap((p) => {
    const id = typeof p.id === "string" ? p.id : typeof p.listingId === "number" ? `op_${p.listingId}` : null;
    return id ? [{ id, scam: p.verdict === "likely_scam" }] : [];
  });
  const ids = [...new Set(all.filter((p) => !p.scam).map((p) => p.id))];
  return { ids, scams: all.filter((p) => p.scam).length };
}

/** "under $4,500", "2+ beds", "no fee", from what Fred searched with. */
function filtersOf(t: ToolCall) {
  const i = t.input;
  return [
    typeof i.maxRent === "number" && `under ${money(i.maxRent)}`,
    typeof i.minBeds === "number" && (i.minBeds === 0 ? "studios up" : `${i.minBeds}+ bed`),
    typeof i.minBaths === "number" && `${i.minBaths}+ bath`,
    i.noFeeOnly === true && "no fee",
  ].filter((f): f is string => typeof f === "string");
}

function StepRow({ n, label, phase, detail, count, live }: { n: number; label: string; phase: Phase; detail: string; count: number | null; live: boolean }) {
  const elapsed = useElapsed(phase === "active");
  const shown = useCountUp(count ?? 0, live);
  return (
    <li className="flex min-w-0 items-center gap-3 py-1.5">
      <span
        className={`grid size-7 shrink-0 place-items-center rounded-full border text-[12.5px] tabular-nums ${
          phase === "done" ? "border-foreground/15 text-foreground" : "text-muted-foreground"
        }`}
      >
        {phase === "done" ? <Check size={13} strokeWidth={2} aria-label="Done" /> : n}
      </span>
      <span className={`shrink-0 text-[14px] ${phase === "pending" || phase === "skipped" ? "text-muted-foreground" : "font-medium"}`}>{label}</span>
      {phase === "active" && (
        <>
          <span className={spinner} aria-hidden />
          <span className="min-w-0 truncate text-[13px] text-muted-foreground">
            {detail}
            {elapsed >= 2 ? ` · ${elapsed}s` : ""}
          </span>
        </>
      )}
      {phase === "stopped" && <span className="text-[13px] text-muted-foreground">Stopped</span>}
      {count !== null && <span className="ml-auto font-mono text-[13px] tabular-nums">{shown.toLocaleString("en-US")}</span>}
    </li>
  );
}

/** Seconds since this became true, ticking while it stays true. */
function useElapsed(active: boolean) {
  const [clock, setClock] = useState<{ since: number; now: number } | null>(null);
  useEffect(() => {
    if (!active) return;
    const tick = () => setClock((c) => (c ? { ...c, now: Date.now() } : { since: Date.now(), now: Date.now() }));
    const first = setTimeout(tick, 0), every = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
      setClock(null);
    };
  }, [active]);
  return clock ? Math.round((clock.now - clock.since) / 1000) : 0;
}

/** Counts up to the target while Fred works; a finished reply just shows the number. */
function useCountUp(target: number, live: boolean) {
  const [value, setValue] = useState(live ? 0 : target);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now(), begin = from.current;
    const instant = !live || reducedMotion();
    let raf = requestAnimationFrame(function tick(now) {
      const k = instant ? 1 : Math.min(1, (now - start) / 900);
      const v = Math.round(begin + (target - begin) * (1 - (1 - k) ** 3));
      from.current = v;
      setValue(v);
      if (k < 1) raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [target, live]);
  return value;
}

/** A skyline whose windows light up as Fred looks: the Fred mark's lit panes, as a city. */
function Skyline({ labels }: { labels: string[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current, ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const still = reducedMotion();
    const css = getComputedStyle(el), color = (v: string) => css.getPropertyValue(v).trim();
    const tower = color("--border"), unlit = color("--muted-foreground"), lit = color("--highlight");
    const W = 3, H = 4, GX = 3, GY = 4, PAD = 4, GAP = 5; // window size, the gaps between them, tower padding, street width
    let towers: { x: number; y: number; w: number; h: number }[] = [], wins: { x: number; y: number; glow: number }[] = [];
    let w = 0, h = 0, raf = 0, last = 0;

    const layout = () => {
      const dpr = devicePixelRatio || 1;
      w = el.clientWidth;
      h = el.clientHeight;
      el.width = w * dpr;
      el.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      towers = [];
      wins = [];
      const most = Math.floor((h - PAD * 2 + GY) / (H + GY));
      for (let x = GAP; ; ) {
        const cols = 2 + Math.floor(Math.random() * 4), rows = Math.max(3, Math.round(most * (0.35 + Math.random() * 0.65)));
        const tw = PAD * 2 + cols * (W + GX) - GX, th = PAD * 2 + rows * (H + GY) - GY;
        if (x + tw > w - GAP) break;
        towers.push({ x, y: h - th, w: tw, h: th });
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < cols; c++) wins.push({ x: x + PAD + c * (W + GX), y: h - th + PAD + r * (H + GY), glow: still && Math.random() < 0.08 ? 1 : 0 });
        x += tw + GAP;
      }
    };
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = tower;
      for (const t of towers) ctx.fillRect(t.x, t.y, t.w, t.h);
      for (const win of wins) {
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = unlit;
        ctx.fillRect(win.x, win.y, W, H);
        if (win.glow > 0.02) {
          ctx.globalAlpha = win.glow;
          ctx.fillStyle = lit;
          ctx.fillRect(win.x, win.y, W, H);
        }
      }
      ctx.globalAlpha = 1;
    };
    // Each frame, lit windows fade (half-life a little over a second) and new ones light up, about 50 a second.
    const frame = (t: number) => {
      const dt = last ? Math.min(t - last, 100) : 16;
      last = t;
      const fade = 0.5 ** (dt / 1200);
      for (const win of wins) win.glow *= fade;
      for (let k = Math.floor(dt / 20 + Math.random()); k > 0 && wins.length; k--) wins[Math.floor(Math.random() * wins.length)].glow = 1;
      draw();
      raf = requestAnimationFrame(frame);
    };

    const resized = new ResizeObserver(() => {
      layout();
      if (still) draw();
    });
    resized.observe(el);
    if (!still) raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      resized.disconnect();
    };
  }, []);

  // One label at a time, somewhere over the skyline.
  const [chip, setChip] = useState<{ n: number; x: number; y: number } | null>(null);
  const count = labels.length;
  useEffect(() => {
    if (!count) return;
    const next = () => setChip((c) => ({ n: (c?.n ?? -1) + 1, x: 6 + Math.random() * 40, y: 12 + Math.random() * 46 }));
    const first = setTimeout(next, 300), every = setInterval(next, 1800);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [count]);
  const text = chip && count ? labels[chip.n % count] : null;

  return (
    <div className="relative mt-3 h-36 overflow-hidden rounded-lg bg-muted" aria-hidden>
      <canvas ref={canvas} className="size-full" />
      {chip && text && (
        <span
          key={chip.n}
          className="fred-chip absolute max-w-[60%] truncate rounded-md border bg-background px-2 py-1 text-[12.5px] text-muted-foreground shadow-xs"
          style={{ left: `${chip.x}%`, top: `${chip.y}%` }}
        >
          {text}
        </span>
      )}
    </div>
  );
}

const PEEK = 16; // the results track's left padding (px-4)

type Place = S["OpportunityDetail"];

/**
 * The places Fred picked, in full. The key starts with /api/opportunities, so refreshPlaces() reloads
 * it after any save or pass, here or in the listing. Each one also fills that place's own cache, so
 * opening its listing is instant.
 */
function usePicked(ids: string[]) {
  return useSWR(
    ids.length ? `/api/opportunities?picked=${ids.join(",")}` : null,
    async () => {
      const places = await Promise.all(ids.map((id) => api<Place>(`/api/opportunities/${id}`).catch(() => null)));
      for (const d of places) if (d) void mutate(`/api/opportunities/${d.id}`, d, { revalidate: false });
      return places;
    },
    { revalidateOnFocus: false },
  );
}

/**
 * The places Fred picked, one at a time, with Save and Pass. The next one peeks in from the right.
 * Saving or passing moves on to the next place. A passed place stays, marked passed, with Undo and
 * a one-tap "what put you off?".
 */
function Results({ ids, scams }: { ids: string[]; scams: number }) {
  const router = useRouter();
  const track = useRef<HTMLDivElement>(null);
  const { data: places } = usePicked(ids);
  const [at, setAt] = useState(0);
  // A vote shows the moment you tap it, before the refreshed places come back.
  const [voted, setVoted] = useState<Record<string, S["OpportunityStatus"]>>({});

  const shown = places?.filter((p): p is Place => !!p).map((p) => (voted[p.id] ? { ...p, status: voted[p.id] } : p)) ?? null;
  const count = shown?.length ?? ids.length;
  const current = Math.min(at, Math.max(0, count - 1));

  const go = (i: number) => {
    const el = track.current, slide = el?.children[i] as HTMLElement | undefined;
    if (!el || !slide) return;
    el.scrollTo({ left: slide.offsetLeft - PEEK, behavior: reducedMotion() ? "auto" : "smooth" });
  };
  // Whichever slide's left edge is nearest the scroll position is the current one.
  const onScroll = () => {
    const el = track.current;
    if (!el || !el.children.length) return;
    const off = (i: number) => Math.abs((el.children[i] as HTMLElement).offsetLeft - PEEK - el.scrollLeft);
    const nearest = [...el.children].reduce((best, _, i) => (off(i) < off(best) ? i : best), 0);
    if (nearest !== at) setAt(nearest);
  };

  // Saving or passing moves on to the next place. Tapping Saved again, or Undo on a pass, puts the
  // place back in New, like the listing's own buttons.
  const vote = async (place: Place, i: number, status: S["OpportunityStatus"]) => {
    setVoted((v) => ({ ...v, [place.id]: status }));
    if (status !== "new" && i + 1 < count) setTimeout(() => go(i + 1), 350);
    try {
      await updateOpportunity(place.id, { status });
    } finally {
      setVoted((v) => {
        const rest = { ...v };
        delete rest[place.id];
        return rest;
      });
    }
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 pb-4">
      <div className="flex items-baseline justify-between px-4 pt-3 text-[12px] font-medium tracking-wide text-muted-foreground uppercase">
        <span>
          Found {plural(ids.length, "place")}
          {scams > 0 && <span className="normal-case"> · hid {scams} likely {scams === 1 ? "scam" : "scams"}</span>}
        </span>
        {count > 1 && (
          <span className="tabular-nums">
            {current + 1} of {count}
          </span>
        )}
      </div>

      {shown?.length === 0 ? (
        <p className="px-4 text-[13.5px] text-muted-foreground">{ids.length === 1 ? "This place isn’t" : "These places aren’t"} available anymore.</p>
      ) : (
        <div className="bg-muted/60 py-4">
          <div
            ref={track}
            onScroll={onScroll}
            className="relative flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 [scrollbar-width:none]"
          >
            {shown
              ? shown.map((place, i) => (
                  <Slide
                    key={place.id}
                    place={place}
                    solo={count === 1}
                    onSave={() => vote(place, i, place.status === "saved" ? "new" : "saved")}
                    onPass={() => vote(place, i, "passed")}
                    onUndo={() => vote(place, i, "new")}
                  />
                ))
              : ids.map((id) => <Loading key={id} solo={count === 1} />)}
          </div>
          {count > 1 && (
            <div className="mt-3 flex justify-center gap-2">
              <button type="button" onClick={() => go(current - 1)} disabled={current === 0} className="grid size-9 place-items-center rounded-full border bg-background hover:border-foreground/40 disabled:opacity-40">
                <ChevronLeft size={16} strokeWidth={1.5} aria-hidden />
                <span className="sr-only">Previous place</span>
              </button>
              <button type="button" onClick={() => go(current + 1)} disabled={current === count - 1} className="grid size-9 place-items-center rounded-full border bg-background hover:border-foreground/40 disabled:opacity-40">
                <ChevronRight size={16} strokeWidth={1.5} aria-hidden />
                <span className="sr-only">Next place</span>
              </button>
            </div>
          )}
        </div>
      )}

      <button type="button" onClick={() => router.push("/")} className="mx-4 rounded-lg border py-2 text-[14px] font-medium hover:bg-muted/60">
        View in New places
      </button>
    </div>
  );
}

const slideClass = (solo: boolean) => `flex ${solo ? "w-full" : "w-[85%]"} shrink-0 snap-start flex-col overflow-hidden rounded-xl border bg-background shadow-xs`;

function Loading({ solo }: { solo: boolean }) {
  return (
    <article className={slideClass(solo)} aria-busy>
      <div className="aspect-[16/9] bg-muted" />
      <div className="grid gap-2 p-4">
        <div className="h-4 w-2/3 rounded bg-muted" />
        <div className="h-3.5 w-1/2 rounded bg-muted" />
        <div className="mt-8 h-9 rounded-lg bg-muted" />
      </div>
    </article>
  );
}

function Slide({ place, solo, onSave, onPass, onUndo }: {
  place: Place;
  solo: boolean;
  onSave: () => void;
  onPass: () => void;
  onUndo: () => void;
}) {
  const openPlace = useOpenPlace();
  const where = place.address ? `${place.address}${place.unit ? ` #${place.unit}` : ""}` : place.area;
  const passed = place.status === "passed";
  // Ask what put them off until they've said, in this card or the listing (PassReasons writes "Passed: …" to the note).
  const said = /^Passed: /m.test(place.note ?? "");

  const photo = place.thumbnail ?? place.photos[0] ?? null;
  const size = `${place.beds === 0 ? "Studio" : `${place.beds} bed`}${place.baths != null ? `, ${place.baths} bath` : ""}`;
  const take = place.highlight ?? place.verdict.reason;

  return (
    <article className={slideClass(solo)}>
      <button
        type="button"
        onClick={() => openPlace(place.id)}
        className={`text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground ${passed ? "opacity-50" : ""}`}
      >
        {photo ? (
          <Image src={photoAt(photo, 640)} alt="" width={640} height={360} className="aspect-[16/9] w-full bg-muted object-cover" />
        ) : (
          <span className="grid aspect-[3/1] place-items-center bg-muted">
            <BuildingTile type={buildingType(place.listingId)} />
          </span>
        )}
        <span className="block px-4 pt-3">
          <span className="block text-[15px] font-[550] tracking-tight tabular-nums">
            {money(place.price)} · {place.area}
          </span>
          <span className="block truncate text-[13px] text-muted-foreground">
            {where} · {size}
          </span>
        </span>
      </button>
      <p className={`px-4 pt-2 text-[13.5px] leading-snug ${passed ? "opacity-50" : ""}`}>
        <span className={`font-medium ${toneClass[place.verdict.tone]}`}>{place.verdict.label}</span>
        {take && <span className="text-muted-foreground"> · {take}</span>}
      </p>
      {passed ? (
        <div className="mt-auto grid gap-3 p-4 pt-3">
          {!said && <PassReasons place={place} onDone={() => {}} />}
          <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-[13.5px]">
            <X size={14} strokeWidth={1.75} className="shrink-0 text-muted-foreground" aria-hidden />
            <span className="flex-1 font-semibold">Passed</span>
            <button type="button" onClick={onUndo} className="font-semibold underline decoration-muted-foreground/60 underline-offset-2 hover:decoration-foreground">
              Undo
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-auto grid grid-cols-2 gap-2 p-4 pt-3">
          <button type="button" onClick={onPass} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-muted py-2 text-[13.5px] font-semibold hover:bg-muted/70">
            <X size={14} strokeWidth={1.75} aria-hidden />
            Pass
          </button>
          <button
            type="button"
            aria-pressed={place.status === "saved"}
            onClick={onSave}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary py-2 text-[13.5px] font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <Check size={14} strokeWidth={1.75} aria-hidden />
            {place.status === "saved" ? "Saved" : "Save"}
          </button>
        </div>
      )}
    </article>
  );
}
