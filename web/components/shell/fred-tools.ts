// Fred's tool calls as they stream into a chat message, and how to say what each one does.
// Outputs are internal data that may be trimmed (James, board #4), so lean on state and inputs.

/** A tool call from Fred's agent (cloud/src/agent/tools.ts), however it streams: tool-<name> or dynamic-tool. */
export type ToolCall = { id: string; name: string; state: string; input: Record<string, unknown>; output: Record<string, unknown> };

export function asTool(part: { type: string }): ToolCall | null {
  const p = part as { type: string; toolCallId?: string; toolName?: string; state?: string; input?: unknown; output?: unknown };
  const name = p.type === "dynamic-tool" ? p.toolName : p.type.startsWith("tool-") ? p.type.slice(5) : null;
  if (!name) return null;
  return { id: String(p.toolCallId), name, state: String(p.state), input: (p.input ?? {}) as ToolCall["input"], output: (p.output ?? {}) as ToolCall["output"] };
}

/** Tools whose results change the inbox, the search, the sidebar counts, your tours or the Profile page. */
export const changesPlaces = (name: string) =>
  ["addToInbox", "updateSearch", "updatePlace", "requestTour", "updateTour", "setAlerts", "updateMemory", "updateProfile"].includes(name);

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
export const titleCase = (s: string) => s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const humanize = (name: string) => name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^\w/, (c) => c.toUpperCase());

export type Status = "running" | "done" | "failed";
export const statusOf = (t: ToolCall): Status =>
  t.state === "output-error" || typeof t.output.error === "string" ? "failed" : t.state === "output-available" ? "done" : "running";

/** "Upper West Side, Harlem", or "all of NYC" when searchListings had no areas. */
export const areasOf = (t: ToolCall) =>
  Array.isArray(t.input.areas) && t.input.areas.length ? (t.input.areas as string[]).map(titleCase).join(", ") : "all of NYC";

/** What Fred is doing (now) and what it did (done), in plain words. */
export function describe(t: ToolCall): { now: string; done: string } {
  const i = t.input, o = t.output;
  switch (t.name) {
    case "searchListings": {
      const matches = typeof o.matching === "number" ? `: ${plural(o.matching, "match", "matches")}` : "";
      return { now: `Searching ${areasOf(t)}`, done: `Searched ${areasOf(t)}${matches}` };
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
    case "readListingPage":
      return { now: "Reading the full listing page", done: "Read the full listing page" };
    case "researchWeb":
      return typeof i.query === "string" ? { now: `Looking up “${i.query}”`, done: `Looked up “${i.query}”` } : { now: "Searching the web", done: "Searched the web" };
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
