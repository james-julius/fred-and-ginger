"use client";

import { useState } from "react";
import { updateOpportunity, type S } from "@/lib/api/client";

const REASONS = ["Price", "Location", "Too small", "Photos", "Building"];
const chip = "rounded-full border bg-background px-3 py-1 text-[13px] hover:border-foreground/40 disabled:opacity-50";

/**
 * After a pass, ask what put them off, in one tap. The answer joins the place's note
 * ("Passed: location"), which Fred's memory reads when it picks places and explains them.
 */
export function PassReasons({ place, onDone }: { place: Pick<S["OpportunityDetail"], "id" | "note">; onDone: () => void }) {
  const [other, setOther] = useState<string | null>(null); // typing "something else"
  const [saving, setSaving] = useState(false);

  const save = async (reason: string) => {
    if (!reason.trim()) return;
    setSaving(true);
    const line = `Passed: ${reason.trim()}`;
    try {
      await updateOpportunity(place.id, { note: place.note?.trim() ? `${place.note.trim()}\n${line}` : line });
      onDone();
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-2">
      <p className="text-[13.5px] font-medium">What put you off?</p>
      <div className="flex flex-wrap gap-1.5">
        {REASONS.map((r) => (
          <button key={r} type="button" disabled={saving} onClick={() => save(r.toLowerCase())} className={chip}>
            {r}
          </button>
        ))}
        <button type="button" disabled={saving} onClick={() => setOther("")} aria-pressed={other !== null} className={chip}>
          Something else
        </button>
      </div>
      {other !== null && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save(other);
          }}
          className="flex gap-2"
        >
          <input
            autoFocus
            value={other}
            onChange={(e) => setOther(e.target.value)}
            placeholder="Tell Fred why"
            aria-label="What put you off"
            className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-1.5 text-[13.5px] outline-none focus:border-foreground/40"
          />
          <button type="submit" disabled={saving || !other.trim()} className="rounded-lg bg-primary px-3 text-[13px] font-semibold text-primary-foreground disabled:opacity-40">
            Save
          </button>
        </form>
      )}
    </div>
  );
}
