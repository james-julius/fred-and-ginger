"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ArrowUp, Mic, Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { FredMark } from "@/components/fred-mark";
import { refreshPlaces, useThread, useThreads, type S } from "@/lib/api/client";
import { dealbreakerChips } from "@/lib/format";
import { useDictation } from "./dictation";
import { linkPlaces, placeIdsIn, usePlaceNames } from "./place-links";
import type { DataPlaces } from "./search-card";
import { asTool, changesPlaces, Steps } from "./steps";

// Fred's custom chat parts, as the API streams them (data-<key> in the AI SDK).
type FredData = {
  "search-updated": S["DataSearchUpdated"];
  scan: S["DataScan"];
  suggestions: S["DataSuggestions"];
  watch: S["DataWatch"];
  places: DataPlaces;
};
type FredMessage = UIMessage<unknown, FredData>;
type Context = { id: string; label: string } | null;

export function ChatPanel(props: { context: Context; onClearContext: () => void; composerRef: RefObject<HTMLTextAreaElement | null> }) {
  const { data: threads, error } = useThreads();
  // Keep talking in the latest thread; start one if there isn't any yet.
  const [newThreadId] = useState(() => `thread_${crypto.randomUUID().slice(0, 8)}`);
  const threadId = threads ? (threads[0]?.id ?? newThreadId) : null;
  const { data: thread } = useThread(threads?.length ? threadId : null);
  const ready = threadId !== null && (threads?.length === 0 || thread !== undefined);

  return (
    <section aria-label="Conversation with Fred" className="flex flex-col border-b bg-chat lg:min-h-0 lg:border-r lg:border-b-0">
      {ready ? (
        <Thread key={threadId} threadId={threadId} initial={(thread?.messages ?? []) as FredMessage[]} {...props} />
      ) : (
        <p className="p-5 text-sm text-muted-foreground">{error ? "Couldn’t load your conversation." : "Loading…"}</p>
      )}
    </section>
  );
}

function Thread({ threadId, initial, context, onClearContext, composerRef }: {
  threadId: string;
  initial: FredMessage[];
  context: Context;
  onClearContext: () => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const [draft, setDraft] = useState("");
  const dictation = useDictation(setDraft);
  const router = useRouter();
  // Open a place's modal from a link in Fred's text. On New places, keep the current view (list or map).
  const openPlace = (id: string) => {
    const params = new URLSearchParams(window.location.pathname === "/" ? window.location.search : "");
    params.set("place", id);
    router.push(`/?${params}`, { scroll: false });
  };
  const [transport] = useState(
    () =>
      new DefaultChatTransport<FredMessage>({
        api: "/api/chat",
        // The server keeps the history, so send only the newest message, plus the listing you're asking about.
        prepareSendMessagesRequest: ({ id, messages, body }) => ({
          body: { threadId: id, message: messages.at(-1), context: body?.context ?? null },
        }),
      }),
  );
  const { messages, sendMessage, status } = useChat<FredMessage>({
    id: threadId,
    messages: initial,
    transport,
    // A reply can change the search, so the inbox may have changed too.
    onFinish: () => refreshPlaces(),
  });
  const busy = status === "submitted" || status === "streaming";
  const last = messages.at(-1);
  // Until the reply shows anything (a step, a chip, words), say Fred is on it.
  const pending = status === "submitted" || (status === "streaming" && last?.role === "assistant" && !last.parts.some(shows));

  // Fred's tools change the inbox mid-reply (adding places, editing the search): refresh as each one lands.
  const [refreshed] = useState(() => new Set(initial.flatMap((m) => m.parts.map(asTool)).flatMap((t) => (t ? [t.id] : []))));
  useEffect(() => {
    for (const m of messages)
      for (const part of m.parts) {
        const t = asTool(part);
        if (t && t.state === "output-available" && changesPlaces(t.name) && !refreshed.has(t.id)) {
          refreshed.add(t.id);
          void refreshPlaces();
        }
      }
  }, [messages, refreshed]);

  const body = { context: context ? { opportunityId: context.id } : null };
  const send = (text: string) => {
    if (!text.trim() || busy) return;
    dictation.cancel();
    sendMessage({ text: text.trim() }, { body });
    setDraft("");
  };
  // Editing replaces that message and everything after it, then Fred answers again.
  const edit = (messageId: string, text: string) => {
    if (!busy) sendMessage({ text, messageId }, { body });
  };

  // Keep the newest message in view.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages]);

  const lastAssistant = messages.findLast((m) => m.role === "assistant");

  return (
    <>
      <div ref={scroller} className="relative grid content-start gap-3.5 px-5 pt-5 pb-2 lg:flex-1 lg:overflow-y-auto">
        {messages.length === 0 && (
          <p className="max-w-[60ch] text-[15px] leading-relaxed text-muted-foreground">
            Tell Fred what you’re looking for, like “2 bed under $4,000 in Brooklyn, near the L, and I have a dog.”
          </p>
        )}
        {messages.map((m) =>
          m.role === "user" ? (
            <UserMessage key={m.id} message={m} disabled={busy} onEdit={(text) => edit(m.id, text)} />
          ) : (
            <Reply key={m.id} message={m} latest={m === lastAssistant} busy={busy} streaming={status === "streaming" && m === last} onPick={send} onPlace={openPlace} />
          ),
        )}
        {pending && (
          <p className="inline-flex items-center gap-2 text-[13px]">
            <FredMark working className="h-[17px] w-[13px] text-muted-foreground" />
            <span className="fred-shimmer">Fred is on it…</span>
          </p>
        )}
        {status === "error" && <p className="text-sm text-destructive">Fred couldn’t reply. Try sending that again.</p>}
      </div>

      <form
        className="px-4 pt-2 pb-4"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <div className="grid gap-3.5 rounded-[14px] border bg-background px-3.5 pt-3 pb-2.5 shadow-xs focus-within:border-foreground/30">
          {context && (
            <span className="inline-flex items-center gap-1.5 justify-self-start rounded-full bg-muted py-0.5 pr-1 pl-2.5 text-[12.5px] text-muted-foreground">
              About <b className="font-medium text-foreground">{context.label}</b>
              <button type="button" onClick={onClearContext} aria-label="Stop asking about this place" className="rounded-full p-0.5 hover:text-foreground">
                <X size={13} strokeWidth={1.5} aria-hidden />
              </button>
            </span>
          )}
          <label htmlFor="composer" className="sr-only">
            Message Fred
          </label>
          <textarea
            id="composer"
            ref={composerRef}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(draft);
              }
            }}
            placeholder={context ? "Ask Fred about this place…" : "Tell Fred what you want…"}
            className="max-h-40 resize-none bg-transparent outline-none field-sizing-content placeholder:text-muted-foreground"
          />
          <div className="flex items-center gap-3 text-muted-foreground">
            {/* "Add a listing link" comes back once Fred can read a listing you paste (asked on the board). */}
            <span role="status" className="min-w-0 truncate text-[12.5px]">
              {dictation.status && <span className={dictation.status.live ? "fred-shimmer" : undefined}>{dictation.status.text}</span>}
            </span>
            {dictation.supported && (
              <button
                type="button"
                aria-label={dictation.listening ? "Stop and write it down" : "Talk to Fred"}
                aria-pressed={dictation.listening}
                disabled={dictation.writing}
                onClick={() => {
                  if (dictation.listening) return dictation.stop();
                  void dictation.start(draft);
                  // Keep the composer focused, so Enter sends what you said.
                  composerRef.current?.focus();
                }}
                className={`ml-auto disabled:opacity-40 ${dictation.listening ? "text-destructive" : "hover:text-foreground"}`}
              >
                <Mic size={18} strokeWidth={1.25} aria-hidden />
              </button>
            )}
            <button
              type="submit"
              aria-label="Send"
              disabled={!draft.trim() || busy}
              className="grid size-8 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
            >
              <ArrowUp size={15} strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        </div>
      </form>
    </>
  );
}

function UserMessage({ message, disabled, onEdit }: { message: FredMessage; disabled: boolean; onEdit: (text: string) => void }) {
  const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(text);
  const cancel = () => {
    setValue(text);
    setEditing(false);
  };
  const save = () => {
    if (value.trim() && value.trim() !== text) onEdit(value.trim());
    setEditing(false);
  };

  if (editing)
    return (
      <form
        className="grid w-full max-w-[88%] gap-2 justify-self-end"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label htmlFor={`edit-${message.id}`} className="sr-only">
          Edit your message
        </label>
        <textarea
          id={`edit-${message.id}`}
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              save();
            }
            if (e.key === "Escape") cancel();
          }}
          className="resize-none rounded-[14px] border border-foreground/30 bg-background px-3.5 py-2.5 outline-none field-sizing-content"
        />
        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto text-xs text-muted-foreground">Fred will answer again from here.</span>
          <button type="button" onClick={cancel} className="rounded-full border bg-background px-3 py-1 text-[13px] font-semibold">
            Cancel
          </button>
          <button type="submit" disabled={!value.trim()} className="rounded-full bg-primary px-3 py-1 text-[13px] font-semibold text-primary-foreground disabled:opacity-40">
            Send
          </button>
        </div>
      </form>
    );

  return (
    <div className="group flex max-w-[88%] items-start gap-1 justify-self-end">
      {!disabled && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label="Edit message"
          className="mt-1.5 rounded-md p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 pointer-coarse:opacity-100"
        >
          <Pencil size={14} strokeWidth={1.25} aria-hidden />
        </button>
      )}
      <p className="rounded-[14px] border bg-background px-3.5 py-2.5 whitespace-pre-line shadow-xs">{text}</p>
    </div>
  );
}

/**
 * Fred names places as [72 West 126th St #B2](place:op_532): those become buttons that open the listing.
 * Plain web links work too. A link still streaming in shows only its text until it's complete.
 */
function withLinks(text: string, onPlace: (id: string) => void): ReactNode {
  const tidy = text.replace(/\[([^\]]*)\]\([^)\s]*$/, "$1").replace(/\[([^\]]*)$/, "$1");
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of tidy.matchAll(/\[([^\]]+)\]\((place:([\w-]+)|https?:\/\/[^)\s]+)\)/g)) {
    out.push(tidy.slice(last, m.index));
    const [, label, target, placeId] = m;
    out.push(
      placeId ? (
        <button
          key={m.index}
          type="button"
          onClick={() => onPlace(placeId)}
          className="font-medium underline decoration-muted-foreground/60 underline-offset-2 hover:decoration-foreground"
        >
          {label}
        </button>
      ) : (
        <a key={m.index} href={target} target="_blank" rel="noopener" className="underline decoration-muted-foreground/60 underline-offset-2 hover:decoration-foreground">
          {label}
        </a>
      ),
    );
    last = m.index + m[0].length;
  }
  out.push(tidy.slice(last));
  return out.map((piece, k) => <Fragment key={k}>{piece}</Fragment>);
}

/** Parts that put something on screen. message-metadata and suggestReplies calls don't. */
const shows = (p: FredMessage["parts"][number]) =>
  (p.type === "text" && p.text.trim() !== "") || p.type.startsWith("data-") || (asTool(p) !== null && asTool(p)!.name !== "suggestReplies");

// One of Fred's replies. Each custom part becomes a piece of the design.
function Reply({ message, latest, busy, streaming, onPick, onPlace }: {
  message: FredMessage;
  latest: boolean;
  busy: boolean;
  /** This reply is still coming in. */
  streaming: boolean;
  onPick: (text: string) => void;
  onPlace: (id: string) => void;
}) {
  const tools = message.parts.map(asTool).filter((t) => t !== null);
  const scans = message.parts.flatMap((p) => (p.type === "data-scan" ? [p.data] : []));
  const named = usePlaceNames(placeIdsIn(message.parts)); // so the addresses Fred writes open their places
  const places = message.parts.flatMap((p) => (p.type === "data-places" ? [p.data] : []));
  // Reply pills and "Watching…" go under the words, even though Fred decides on them before it writes.
  const atEnd = (p: FredMessage["parts"][number]) => p.type === "data-suggestions" || p.type === "data-watch";
  const parts = [...message.parts.filter((p) => !atEnd(p)), ...message.parts.filter(atEnd)];
  const firstStep = parts.findIndex((p) => p.type === "data-scan" || asTool(p) !== null);
  // Fred should write once, after its last tool call. Text before a later tool call is a draft it
  // may go on to correct, so only what follows the last tool shows. If nothing follows it once the
  // reply is done, the last thing Fred wrote is the answer.
  const lastTool = parts.findLastIndex((p) => asTool(p) !== null);
  const lastText = parts.findLastIndex((p) => p.type === "text" && p.text.trim() !== "");
  const answering = lastText > lastTool;
  const textFrom = answering || streaming ? lastTool + 1 : lastText;
  // Live until Fred starts writing the answer; after that it's the summary.
  const working = streaming && !answering;

  return (
    <div className="grid gap-3.5">
      {parts.map((part, i) => {
        if (i === firstStep) return <Steps key={i} tools={tools} scans={scans} places={places} running={working} />;
        if (part.type === "data-scan" || part.type === "data-places" || asTool(part)) return null;
        switch (part.type) {
          case "data-search-updated":
            return (
              <div key={i} className="-mt-1.5 flex max-w-[92%] flex-wrap items-center justify-end gap-1.5 justify-self-end">
                <span className="mr-0.5 text-xs text-muted-foreground">Dealbreakers</span>
                {dealbreakerChips(part.data.dealbreakers).map((d) => (
                  <span key={d} className="rounded-full border bg-background px-2.5 py-0.5 text-[12.5px]">
                    {d}
                  </span>
                ))}
              </div>
            );
          case "text":
            if (i < textFrom) return null;
            return part.text.split(/\n{2,}/).map((para, j) => (
              <p key={`${i}-${j}`} className="max-w-[60ch] text-[15px] leading-relaxed">
                {withLinks(linkPlaces(para, named), onPlace)}
              </p>
            ));
          case "data-suggestions":
            return latest ? (
              <div key={i} className="-mt-1 flex flex-wrap gap-2">
                {part.data.options.map((o, j) => (
                  <button
                    key={o.label}
                    type="button"
                    disabled={busy}
                    onClick={() => onPick(o.label)}
                    className={`rounded-full border bg-background px-3.5 py-1.5 text-[13.5px] font-medium hover:border-foreground disabled:opacity-50 ${
                      j === part.data.options.length - 1 && !o.patch ? "text-muted-foreground" : ""
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            ) : null;
          case "data-watch":
            return latest ? (
              <p key={i} className="mt-1.5 inline-flex items-center gap-2 text-[13px]">
                <FredMark working={part.data.state !== "paused"} className="h-[17px] w-[13px] text-muted-foreground" />
                <span className={part.data.state === "paused" ? "text-muted-foreground" : "fred-shimmer"}>
                  {part.data.state === "paused" ? "Paused. Fred isn’t checking for new places." : part.data.state === "checking" ? "Checking for new places now…" : "Watching for new places…"}
                </span>
              </p>
            ) : null;
          default:
            return null;
        }
      })}
    </div>
  );
}
