"use client";

import { Check, ChevronRight, X } from "lucide-react";
import { FredMark } from "@/components/fred-mark";
import type { S } from "@/lib/api/client";

/** A tool call from Fred's agent (cloud/src/agent/tools.ts), however it streams: tool-<name> or dynamic-tool. */
export type ToolCall = { id: string; name: string; state: string; input: Record<string, unknown>; output: Record<string, unknown> };

export function asTool(part: { type: string }): ToolCall | null {
  const p = part as { type: string; toolCallId?: string; toolName?: string; state?: string; input?: unknown; output?: unknown };
  const name = p.type === "dynamic-tool" ? p.toolName : p.type.startsWith("tool-") ? p.type.slice(5) : null;
  if (!name) return null;
  return { id: String(p.toolCallId), name, state: String(p.state), input: (p.input ?? {}) as ToolCall["input"], output: (p.output ?? {}) as ToolCall["output"] };
}

/** Tools whose results change the inbox, the search or the sidebar counts. */
export const changesPlaces = (name: string) => ["addToInbox", "updateSearch", "updatePlace", "requestTour", "setAlerts"].includes(name);

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const titleCase = (s: string) => s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const humanize = (name: string) => name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^\w/, (c) => c.toUpperCase());

type Status = "running" | "done" | "failed";
const statusOf = (t: ToolCall): Status =>
  t.state === "output-error" || typeof t.output.error === "string" ? "failed" : t.state === "output-available" ? "done" : "running";

/** What Fred is doing (now) and what it did (done), in plain words. */
function describe(t: ToolCall): { now: string; done: string } {
  const i = t.input, o = t.output;
  switch (t.name) {
    case "searchListings": {
      const areas = Array.isArray(i.areas) && i.areas.length ? (i.areas as string[]).map(titleCase).join(", ") : "all of NYC";
      const matches = typeof o.matching === "number" ? `: ${plural(o.matching, "match", "matches")}` : "";
      return { now: `Searching ${areas}`, done: `Searched ${areas}${matches}` };
    }
    case "addToInbox": {
      const n = Array.isArray(o.added) ? o.added.length : null;
      return { now: "Adding places to your inbox", done: n === null ? "Added places to your inbox" : n ? `Added ${plural(n, "place")} to your inbox` : "Nothing new to add to your inbox" };
    }
    case "updateSearch":
      return { now: "Updating your search", done: typeof o.summary === "string" ? `Updated your search: ${o.summary}` : "Updated your search" };
    case "getSearch":
      return { now: "Checking your search", done: "Checked your search" };
    case "listInbox":
      return { now: "Looking through your inbox", done: "Looked through your inbox" };
    case "getPlace":
      return { now: "Reading a listing", done: "Read a listing" };
    case "updatePlace":
      return { now: "Updating a place", done: "Updated a place" };
    case "requestTour":
      return { now: "Drafting a tour request", done: "Drafted a tour request. Nothing was sent." };
    case "setAlerts":
      return { now: "Changing your alerts", done: "Changed your alerts" };
    default:
      return { now: humanize(t.name), done: humanize(t.name) };
  }
}

/**
 * One line per reply: live while Fred works ("Searching Brooklyn…"), then a summary you can open.
 * Real Fred streams tool calls; the canned replies only send data-scan, so fall back to its steps.
 */
export function Steps({ tools, scans, running }: { tools: ToolCall[]; scans: S["DataScan"][]; running: boolean }) {
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
