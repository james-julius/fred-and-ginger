"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, Maximize2, X } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { photoAt } from "@/lib/format";

const overlayButton =
  "grid size-9 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm hover:bg-black/75 focus-visible:outline-2 focus-visible:outline-white";

// One big photo with thumbnails under it, and a full-screen viewer.
// Key it by listing so it starts at the first photo each time.
export function Gallery({ photos, label }: { photos: string[]; label: string }) {
  const [index, setIndex] = useState(0);
  const [fullScreen, setFullScreen] = useState(false);
  const go = (by: number) => setIndex((i) => (i + by + photos.length) % photos.length);
  const alt = (i: number) => `${label}, photo ${i + 1} of ${photos.length}`;

  if (!photos.length) return null;
  return (
    <div className="grid gap-2">
      <div className="relative overflow-hidden rounded-xl bg-muted">
        <button type="button" onClick={() => setFullScreen(true)} className="block w-full cursor-zoom-in" aria-label="View photos full screen">
          <Image src={photoAt(photos[index], 1280)} alt={alt(index)} width={1280} height={800} priority className="aspect-[16/10] w-full object-cover" />
        </button>
        {photos.length > 1 && (
          <>
            <button type="button" onClick={() => go(-1)} aria-label="Previous photo" className={`${overlayButton} absolute top-1/2 left-2.5 -translate-y-1/2`}>
              <ChevronLeft size={18} strokeWidth={1.5} aria-hidden />
            </button>
            <button type="button" onClick={() => go(1)} aria-label="Next photo" className={`${overlayButton} absolute top-1/2 right-2.5 -translate-y-1/2`}>
              <ChevronRight size={18} strokeWidth={1.5} aria-hidden />
            </button>
          </>
        )}
        <button type="button" onClick={() => setFullScreen(true)} aria-label="View photos full screen" className={`${overlayButton} absolute top-2.5 right-2.5 size-8 rounded-lg`}>
          <Maximize2 size={15} strokeWidth={1.5} aria-hidden />
        </button>
        <span className="absolute bottom-2.5 left-2.5 rounded-md bg-black/55 px-2 py-0.5 text-xs text-white tabular-nums backdrop-blur-sm">
          {index + 1} / {photos.length}
        </span>
      </div>

      {photos.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-0.5">
          {photos.map((src, i) => (
            <button
              key={src}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Show photo ${i + 1}`}
              aria-current={i === index}
              className={`shrink-0 overflow-hidden rounded-lg ring-offset-2 ring-offset-background ${i === index ? "ring-2 ring-foreground" : "opacity-70 hover:opacity-100"}`}
            >
              <Image src={photoAt(src, 160)} alt="" width={80} height={56} className="h-14 w-20 object-cover" />
            </button>
          ))}
        </div>
      )}

      <Dialog.Root open={fullScreen} onOpenChange={setFullScreen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[60] bg-black" />
          <Dialog.Content
            aria-describedby={undefined}
            // Arrow keys move between photos here, not between listings in the modal behind.
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "ArrowRight") go(1);
              if (e.key === "ArrowLeft") go(-1);
            }}
            className="fixed inset-0 z-[70] flex flex-col text-white outline-none"
          >
            <div className="flex items-center gap-3 px-4 py-3">
              <Dialog.Title className="text-sm font-medium">{label}</Dialog.Title>
              <span className="text-sm text-white/60 tabular-nums">
                {index + 1} / {photos.length}
              </span>
              <Dialog.Close className={`ml-auto ${overlayButton}`} aria-label="Close full screen">
                <X size={18} strokeWidth={1.5} aria-hidden />
              </Dialog.Close>
            </div>
            <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-6 sm:px-16">
              <Image
                src={photoAt(photos[index], 2400)}
                alt={alt(index)}
                width={2400}
                height={1600}
                className="max-h-full w-auto max-w-full rounded-lg object-contain"
              />
              {photos.length > 1 && (
                <>
                  <button type="button" onClick={() => go(-1)} aria-label="Previous photo" className={`${overlayButton} absolute left-3 sm:left-5`}>
                    <ChevronLeft size={20} strokeWidth={1.5} aria-hidden />
                  </button>
                  <button type="button" onClick={() => go(1)} aria-label="Next photo" className={`${overlayButton} absolute right-3 sm:right-5`}>
                    <ChevronRight size={20} strokeWidth={1.5} aria-hidden />
                  </button>
                </>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
