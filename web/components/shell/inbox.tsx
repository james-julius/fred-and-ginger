import { Bell, CalendarDays, ChevronRight } from "lucide-react";
import { BuildingTile } from "@/components/building-tile";
import { money, partner, scoreTone, shortDate, type Fit, type Place, type Vote } from "@/lib/places";

const fitLabel: Record<Fit, { text: string; className: string }> = {
  strong: { text: "Strong fit", className: "text-success" },
  "over-budget": { text: "Over budget", className: "text-warning" },
  scam: { text: "Likely scam", className: "text-destructive" },
};

// One line of facts, all from the listing data.
function summary(p: Place) {
  if (p.fit === "scam") return p.reasons?.[0] ?? "";
  return [
    `${p.beds} bed, ${p.baths} bath`,
    p.sqft && `${p.sqft.toLocaleString("en-US")} ft²`,
    p.available && `Available ${shortDate(p.available)}`,
    p.noFee && "No fee",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function Inbox({ places, unread, myVotes, onOpen }: {
  places: Place[];
  unread: ReadonlySet<string>;
  myVotes: Record<string, Vote>;
  onOpen: (id: string) => void;
}) {
  const groups = (["Today", "Yesterday"] as const).map((day) => ({ day, items: places.filter((p) => p.listed === day) }));
  const toured = places[0];

  return (
    <section aria-label="New places" className="bg-background px-4 py-5 lg:min-h-0 lg:overflow-y-auto lg:px-7">
      <div className="mx-auto grid max-w-3xl gap-[18px]">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-xl font-semibold tracking-tight">New places</h1>
          <button type="button" className="ml-auto inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[13px] font-medium text-muted-foreground hover:text-foreground">
            <Bell size={14} strokeWidth={1.25} aria-hidden />
            Alerts: strong fits right away
          </button>
        </div>

        <button
          type="button"
          onClick={() => onOpen(toured.id)}
          className="flex items-center gap-2.5 rounded-[10px] border px-3.5 py-2.5 text-left text-[13.5px] hover:bg-muted/60"
        >
          <CalendarDays size={16} strokeWidth={1.25} aria-hidden />
          <span>
            <b className="font-semibold">Tour tomorrow, 8:30 AM</b> · {toured.street}, {toured.neighbourhood}
          </span>
          <ChevronRight size={14} strokeWidth={1.25} className="ml-auto text-muted-foreground" aria-hidden />
        </button>

        {groups.map(({ day, items }) => (
          <div key={day} className="grid gap-2">
            <h2 className="mt-1 text-sm font-semibold text-muted-foreground">{day}</h2>
            <ul className="overflow-hidden rounded-xl border">
              {items.map((p) => (
                <li key={p.id} className="border-t first:border-t-0">
                  <button
                    type="button"
                    onClick={() => onOpen(p.id)}
                    className="grid w-full grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3.5 px-4 py-3 text-left hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground"
                  >
                    <BuildingTile type={p.buildingType} />
                    <span className="min-w-0">
                      <span
                        className={`block text-[15px] font-[550] tracking-tight tabular-nums ${
                          p.fit === "scam" ? "text-muted-foreground line-through decoration-destructive/60" : ""
                        }`}
                      >
                        {money(p.price)} · {p.neighbourhood}
                      </span>
                      <span className="block truncate text-[13px] text-muted-foreground">{summary(p)}</span>
                    </span>
                    <span className="grid justify-items-end gap-0.5 text-[12.5px] whitespace-nowrap">
                      <span className="flex items-center gap-2.5">
                        <span className={`font-medium ${fitLabel[p.fit].className}`}>{fitLabel[p.fit].text}</span>
                        {unread.has(p.id) && (
                          <span className="size-2 rounded-full bg-primary">
                            <span className="sr-only">Unread</span>
                          </span>
                        )}
                      </span>
                      <span className="text-muted-foreground">
                        <Votes mine={myVotes[p.id] ?? null} theirs={p.theirVote} />
                        {p.building && (
                          <>
                            Building <b className={`font-semibold tabular-nums ${scoreTone(p.building.score)}`}>{p.building.score}</b>
                          </>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function Votes({ mine, theirs }: { mine: Vote; theirs: Vote }) {
  const text =
    mine === 1 && theirs === 1 ? "You both like" : mine === 1 ? "You like" : theirs === 1 ? `${partner} likes` : mine === -1 ? "You passed" : null;
  return text ? <span className="text-foreground">{text} · </span> : null;
}
