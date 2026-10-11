"use client";

import { Pencil, Plus, X } from "lucide-react";
import { useState } from "react";
import { Avatar } from "@/components/avatar";
import { forgetMemory, updateMe, updateMemory, updateSearch, useMe, useMemory, useSearch, type S } from "@/lib/api/client";

const input = "h-9 rounded-lg border bg-background px-3 text-sm outline-none focus:border-foreground/40";
const button = "rounded-full border px-3.5 py-1.5 text-[13px] font-semibold hover:border-foreground/40 disabled:opacity-40";
const primary = "rounded-full bg-primary px-4 py-1.5 text-[13px] font-semibold text-primary-foreground disabled:opacity-40";

export function ProfilePage() {
  const { data: me } = useMe();
  const { data: search } = useSearch();
  // Lives here so "Saved" survives the form starting over from the saved search.
  const [searchStatus, setSearchStatus] = useState<string | null>(null);
  return (
    <section aria-label="Profile" className="bg-background px-4 py-5 lg:min-h-0 lg:overflow-y-auto lg:px-7">
      <div className="mx-auto grid max-w-2xl gap-6">
        <h1 className="text-xl font-semibold tracking-tight">Profile</h1>
        {me ? <You key={me.user.id} user={me.user} /> : <p className="text-sm text-muted-foreground">Loading…</p>}
        {/* Keyed by updatedAt so the form starts over from what's saved, including changes made in the chat. */}
        {search ? <LookingFor key={search.updatedAt} search={search} status={searchStatus} onStatus={setSearchStatus} /> : null}
        <Remembers />
      </div>
    </section>
  );
}

/* ── you ─────────────────────────────────────────────────────────────── */

function You({ user }: { user: S["Me"]["user"] }) {
  const [name, setName] = useState(user.name);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (patch: S["MePatch"], done: string) => {
    setBusy(true);
    setStatus(null);
    try {
      await updateMe(patch);
      setStatus(done);
    } catch {
      setStatus("Couldn’t save that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    try {
      await save({ photo: await squarePhoto(file) }, "Photo updated");
    } catch {
      setStatus("Couldn’t read that photo. Try a JPEG or PNG.");
    }
  };

  return (
    <div className="grid gap-4 rounded-xl border p-4 sm:grid-cols-[auto_1fr] sm:items-center sm:gap-5">
      <div className="grid justify-items-center gap-2">
        <Avatar user={user} size={72} />
        <div className="flex gap-1.5">
          <label className={`${button} cursor-pointer`}>
            {user.photo ? "Change" : "Add photo"}
            <input type="file" accept="image/*" className="sr-only" disabled={busy} onChange={(e) => pickPhoto(e.target.files?.[0])} />
          </label>
          {user.photo && (
            <button type="button" className={button} disabled={busy} onClick={() => save({ photo: null }, "Photo removed")}>
              Remove
            </button>
          )}
        </div>
      </div>

      <form
        className="grid gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && name.trim() !== user.name) void save({ name: name.trim() }, "Name saved");
        }}
      >
        <label htmlFor="profile-name" className="text-xs font-semibold text-muted-foreground">
          Your name
        </label>
        <div className="flex gap-2">
          <input id="profile-name" className={`${input} min-w-0 flex-1`} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          <button type="submit" className={primary} disabled={busy || !name.trim() || name.trim() === user.name}>
            Save
          </button>
        </div>
        <p className="min-h-5 text-[12.5px] text-muted-foreground" role="status">
          {status}
        </p>
      </form>
    </div>
  );
}

/** A square crop of the middle of the photo, 256px, as a small JPEG. */
async function squarePhoto(file: File, size = 256) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", 0.85);
}

/* ── what you're looking for ─────────────────────────────────────────── */

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const title = (s: string) => s.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
const numberOrNull = (s: string) => (s === "" ? null : Number(s));

// Tapping a nice-to-have steps it up: nice, important, dealbreaker, then back to nice.
type Weight = S["Preference"]["weight"];
const nextWeight: Record<Weight, Weight> = { nice: "important", important: "must", must: "nice" };
const weightName: Record<Weight, string> = { nice: "", important: "important", must: "dealbreaker" };
const tapTo: Record<Weight, string> = { nice: "Tap to mark it important", important: "Tap to make it a dealbreaker", must: "Tap to make it nice to have" };
const weightClass: Record<Weight, string> = { nice: "", important: "border-foreground font-medium", must: "border-foreground bg-foreground font-medium text-background" };

function LookingFor({ search, status, onStatus }: { search: S["Search"]; status: string | null; onStatus: (s: string | null) => void }) {
  const [d, setD] = useState(search.dealbreakers);
  const [prefs, setPrefs] = useState(search.preferences);
  const [area, setArea] = useState("");
  const [pref, setPref] = useState("");
  const [busy, setBusy] = useState(false);
  const changed = JSON.stringify([d, prefs]) !== JSON.stringify([search.dealbreakers, search.preferences]);
  const set = <K extends keyof S["Dealbreakers"]>(k: K, v: S["Dealbreakers"][K]) => setD((prev) => ({ ...prev, [k]: v }));

  const addArea = () => {
    const s = slug(area);
    if (s && !d.areas.includes(s)) set("areas", [...d.areas, s]);
    setArea("");
  };
  const addPref = () => {
    if (pref.trim()) setPrefs((p) => [...p, { id: `p_${crypto.randomUUID().slice(0, 8)}`, label: pref.trim(), weight: "nice" }]);
    setPref("");
  };
  const save = async () => {
    setBusy(true);
    onStatus(null);
    try {
      await updateSearch({ dealbreakers: d, preferences: prefs });
      onStatus("Saved. Fred will search with this.");
    } catch {
      onStatus("Couldn’t save. Try again.");
      setBusy(false);
    }
  };

  return (
    <form
      className="grid gap-5 rounded-xl border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div>
        <h2 className="font-semibold">What you’re looking for</h2>
        <p className="text-[13px] text-muted-foreground">Fred searches with this. You can also change it by telling Fred in the chat.</p>
      </div>

      <Field label="Where" htmlFor="profile-area">
        <div className="flex flex-wrap items-center gap-1.5">
          {d.areas.map((a) => (
            <span key={a} className="inline-flex items-center gap-1 rounded-full border py-0.5 pr-1 pl-2.5 text-[13px]">
              {title(a)}
              <button type="button" aria-label={`Remove ${title(a)}`} onClick={() => set("areas", d.areas.filter((x) => x !== a))} className="rounded-full p-0.5 text-muted-foreground hover:text-foreground">
                <X size={13} strokeWidth={1.5} aria-hidden />
              </button>
            </span>
          ))}
          <input
            id="profile-area"
            className={`${input} h-8 w-48`}
            placeholder="Add a neighborhood"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addArea();
              }
            }}
          />
          <button type="button" aria-label="Add neighborhood" onClick={addArea} className="rounded-full border p-1.5 text-muted-foreground hover:text-foreground">
            <Plus size={14} strokeWidth={1.5} aria-hidden />
          </button>
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Monthly budget" htmlFor="profile-budget">
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <input
              id="profile-budget"
              className={`${input} w-full pl-6 tabular-nums`}
              inputMode="numeric"
              value={d.maxTotalMonthly ?? ""}
              onChange={(e) => set("maxTotalMonthly", numberOrNull(e.target.value.replace(/\D/g, "")))}
            />
          </div>
          <span className="text-[12px] text-muted-foreground">Rent plus required fees</span>
        </Field>
        <Field label="Bedrooms" htmlFor="profile-beds">
          <select id="profile-beds" className={input} value={d.minBeds ?? ""} onChange={(e) => set("minBeds", numberOrNull(e.target.value))}>
            <option value="">Any</option>
            <option value="0">Studio or more</option>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}+
              </option>
            ))}
          </select>
        </Field>
        <Field label="Bathrooms" htmlFor="profile-baths">
          <select id="profile-baths" className={input} value={d.minBaths ?? ""} onChange={(e) => set("minBaths", numberOrNull(e.target.value))}>
            <option value="">Any</option>
            {[1, 1.5, 2, 2.5, 3].map((n) => (
              <option key={n} value={n}>
                {n}+
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Pets" htmlFor="profile-pets">
          <select
            id="profile-pets"
            className={input}
            value={d.pets ?? ""}
            onChange={(e) => set("pets", (e.target.value || null) as S["Dealbreakers"]["pets"])}
          >
            <option value="">No pets</option>
            <option value="dogs">A dog</option>
            <option value="cats">A cat</option>
            <option value="dogs_and_cats">Dogs and cats</option>
          </select>
        </Field>
        <Field label="Move by" htmlFor="profile-move">
          <input id="profile-move" type="date" className={input} value={d.moveBy ?? ""} onChange={(e) => set("moveBy", e.target.value || null)} />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" className="size-4 accent-foreground" checked={d.noBrokerFee} onChange={(e) => set("noBrokerFee", e.target.checked)} />
          No broker fee
        </label>
      </div>

      <Field label="Nice to have" htmlFor="profile-pref" hint="Tap once for important, twice for a dealbreaker">
        <div className="flex flex-wrap items-center gap-1.5">
          {prefs.map((p) => (
            <span key={p.id} className={`inline-flex items-center gap-1 rounded-full border py-0.5 pr-1 pl-2.5 text-[13px] ${weightClass[p.weight]}`}>
              <button
                type="button"
                title={tapTo[p.weight]}
                onClick={() => setPrefs((all) => all.map((x) => (x.id === p.id ? { ...x, weight: nextWeight[x.weight] } : x)))}
              >
                {p.label}
                {p.weight !== "nice" && <span className="opacity-70"> · {weightName[p.weight]}</span>}
              </button>
              <button type="button" aria-label={`Remove ${p.label}`} onClick={() => setPrefs((all) => all.filter((x) => x.id !== p.id))} className="rounded-full p-0.5 opacity-70 hover:opacity-100">
                <X size={13} strokeWidth={1.5} aria-hidden />
              </button>
            </span>
          ))}
          <input
            id="profile-pref"
            className={`${input} h-8 w-52`}
            placeholder="e.g. Lots of light"
            value={pref}
            onChange={(e) => setPref(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addPref();
              }
            }}
          />
          <button type="button" aria-label="Add nice-to-have" onClick={addPref} className="rounded-full border p-1.5 text-muted-foreground hover:text-foreground">
            <Plus size={14} strokeWidth={1.5} aria-hidden />
          </button>
        </div>
      </Field>

      <div className="flex items-center gap-3 border-t pt-4">
        <button type="submit" className={primary} disabled={busy || !changed}>
          Save changes
        </button>
        {changed && (
          <button
            type="button"
            className={button}
            onClick={() => {
              setD(search.dealbreakers);
              setPrefs(search.preferences);
            }}
          >
            Undo
          </button>
        )}
        <p className="text-[12.5px] text-muted-foreground" role="status">
          {status}
        </p>
      </div>
    </form>
  );
}

/* ── what Fred remembers ─────────────────────────────────────────────── */

const kinds: [S["MemoryKind"], string][] = [
  ["needs", "Needs"],
  ["likes", "Likes"],
  ["dislikes", "Dislikes"],
  ["timing", "Timing"],
  ["life", "About you"],
  ["working_style", "How you like Fred to work"],
];
const quiet = "rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40";

// Fred writes these himself as you chat. You can reword or delete any of them.
function Remembers() {
  const { data, error } = useMemory();
  const notes = data?.items ?? [];
  return (
    <section aria-labelledby="remembers" className="grid gap-4 rounded-xl border p-4">
      <div>
        <h2 id="remembers" className="font-semibold">
          What Fred remembers
        </h2>
        <p className="text-[13px] text-muted-foreground">Notes Fred keeps from your chats and uses in every search. Fix or delete anything that’s wrong.</p>
      </div>
      {!data ? (
        <p className="text-sm text-muted-foreground">{error ? "Couldn’t load Fred’s notes." : "Loading…"}</p>
      ) : notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing yet. As you chat, Fred notes what matters to you.</p>
      ) : (
        kinds.map(([kind, label]) => {
          const group = notes.filter((n) => n.kind === kind);
          if (!group.length) return null;
          return (
            <div key={kind} className="grid gap-0.5">
              <h3 className="text-xs font-semibold text-muted-foreground">{label}</h3>
              <ul className="grid">
                {group.map((n) => (
                  <Note key={n.id} note={n} />
                ))}
              </ul>
            </div>
          );
        })
      )}
    </section>
  );
}

function Note({ note }: { note: S["Memory"] }) {
  const [draft, setDraft] = useState<string | null>(null); // null while not editing
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setFailed(false);
    try {
      await work();
      setDraft(null);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (draft !== null) {
    const text = draft.trim();
    return (
      <li>
        <form
          className="flex items-center gap-2 py-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (text === note.text) setDraft(null);
            else void run(() => updateMemory(note.id, { text }));
          }}
        >
          <input
            autoFocus
            aria-label="Edit note"
            maxLength={160}
            className={`${input} min-w-0 flex-1`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setDraft(null)}
          />
          <button type="submit" className={primary} disabled={busy || text.length < 3}>
            Save
          </button>
          <button type="button" className={button} onClick={() => setDraft(null)}>
            Cancel
          </button>
        </form>
        {failed && <p className="pb-1 text-[12.5px] text-destructive">Couldn’t save that. Try again.</p>}
      </li>
    );
  }

  return (
    <li className="flex items-start gap-1 py-0.5 text-sm">
      <p className="flex-1 py-1">
        {note.text}
        {note.from === "inferred" && (
          <span className="text-muted-foreground" title="Fred guessed this from the places you saved and passed">
            {" "}
            · Fred’s guess
          </span>
        )}
        {failed && <span className="text-destructive"> · Couldn’t delete. Try again.</span>}
      </p>
      <button type="button" className={quiet} aria-label={`Edit: ${note.text}`} onClick={() => setDraft(note.text)}>
        <Pencil size={14} strokeWidth={1.25} aria-hidden />
      </button>
      <button type="button" className={quiet} aria-label={`Forget: ${note.text}`} disabled={busy} onClick={() => run(() => forgetMemory(note.id))}>
        <X size={14} strokeWidth={1.25} aria-hidden />
      </button>
    </li>
  );
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid content-start gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-semibold text-muted-foreground">
        {label}
        {hint && <span className="font-normal"> · {hint}</span>}
      </label>
      {children}
    </div>
  );
}
