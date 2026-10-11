"use client";

import { FileText } from "lucide-react";
import { usePacket } from "@/lib/api/client";

/**
 * Uploading isn't built on the Worker yet (asked on the board), and /api/packet still serves the
 * example checklist, statuses included. So this shows only what landlords ask for, not whether
 * you've uploaded it. Statuses and an Upload button per item come with the real endpoint.
 */
export function PacketPage() {
  const { data: packet, error } = usePacket();
  return (
    <section aria-label="Application packet" className="bg-background px-4 py-5 lg:min-h-0 lg:overflow-y-auto lg:px-7">
      <div className="mx-auto grid max-w-2xl gap-6">
        <div className="grid gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Application packet</h1>
          <p className="text-[13px] text-muted-foreground">
            Landlords and brokers ask for the same papers on every application. This is where you’ll keep them, so they’re ready the day you find
            the place.
          </p>
        </div>

        <div className="grid gap-3 rounded-xl border p-4">
          <h2 className="font-semibold">What landlords usually ask for</h2>
          {error && <p className="text-sm text-destructive">Couldn’t load the checklist. Try refreshing.</p>}
          {!packet && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
          {packet && (
            <ul className="grid gap-2 text-[14px]">
              {packet.items.map((item) => (
                <li key={item.kind} className="flex items-center gap-2.5">
                  <FileText size={16} strokeWidth={1.25} className="shrink-0 text-muted-foreground" aria-hidden />
                  {item.label}
                </li>
              ))}
            </ul>
          )}
          <p className="border-t pt-3 text-[12.5px] text-muted-foreground">Uploading isn’t ready yet. It’s coming soon.</p>
        </div>
      </div>
    </section>
  );
}
