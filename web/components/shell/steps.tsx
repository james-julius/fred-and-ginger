"use client";

import { Check, ChevronRight, X } from "lucide-react";
import { FredMark } from "@/components/fred-mark";
import type { S } from "@/lib/api/client";
import { describe, plural, statusOf, type Status, type ToolCall } from "./fred-tools";
import { isSearch, SearchCard } from "./search-card";

export { asTool, changesPlaces, type ToolCall } from "./fred-tools";

/**
 * One line per reply: live while Fred works ("Searching Brooklyn…"), then a summary you can open.
 * A reply where Fred searches gets the search card instead. Real Fred streams tool calls; the
 * canned replies only send data-scan, so fall back to its steps.
 */
export function Steps({ tools, scans, running }: { tools: ToolCall[]; scans: S["DataScan"][]; running: boolean }) {
  if (tools.some(isSearch)) return <SearchCard tools={tools} scans={scans} running={running} />;

  const shown = tools.filter((t) => t.name !== "suggestReplies"); // the reply pills already show this
  const items: { key: string; text: string; status: Status }[] = shown.length
    ? shown.map((t) => ({ key: t.id, text: statusOf(t) === "running" ? describe(t).now : describe(t).done, status: statusOf(t) }))
    : scans.flatMap((s, i) => s.steps.map((step, j) => ({ key: `${i}-${j}`, text: step.label, status: "done" as const })));
  if (!items.length && !running) return null;

  const checked = scans.reduce((n, s) => n + s.checked, 0);
  const current = shown.findLast((t) => statusOf(t) === "running");

  return (
    <details className="group justify-self-start">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[13.5px] text-muted-foreground [&::-webkit-details-marker]:hidden">
        <FredMark working={running} className="h-[17px] w-[13px]" />
        {running ? (
          <span className="fred-shimmer">{current ? `${describe(current).now}…` : "Thinking…"}</span>
        ) : (
          <span>
            <b className="font-medium text-foreground">{checked ? `Checked ${plural(checked, "listing")}` : plural(items.length, "step")}</b>
            {checked ? ` · ${plural(items.length, "step")}` : ""}
          </span>
        )}
        {items.length > 0 && <ChevronRight size={13} strokeWidth={1.5} className="transition-transform group-open:rotate-90" aria-hidden />}
      </summary>
      <ol className="mt-2 ml-1.5 grid gap-1.5 border-l pl-4 text-[13px] text-muted-foreground">
        {items.map((it) => (
          <li key={it.key} className="flex items-start gap-2">
            {it.status === "done" && <Check size={13} strokeWidth={1.75} className="mt-[3px] shrink-0 text-success" aria-label="Done" />}
            {it.status === "failed" && <X size={13} strokeWidth={1.75} className="mt-[3px] shrink-0 text-destructive" aria-label="Didn’t work" />}
            {it.status === "running" &&
              (running ? (
                <span className="mt-[4px] size-[11px] shrink-0 animate-spin rounded-full border-[1.5px] border-border border-t-foreground" aria-label="Working" />
              ) : (
                <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-muted-foreground/50" aria-label="Stopped" />
              ))}
            <span>{it.text}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}
