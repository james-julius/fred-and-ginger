"use client";

import { useEffect, useRef, useState } from "react";
import { resetPane, sizePane, type Pane } from "@/lib/panes";

type Limits = { min: number; max?: number; rest?: number };

// The seam on a pane's right edge: drag it, or focus it and use the arrow keys. Double-click puts it back.
// It sits in a zero-width grid track right after its pane. The pane stays between min and max wide,
// and leaves at least `rest` for the panes to its right.
export function PaneHandle({ pane, label, min, max, rest }: { pane: Pane; label: string } & Limits) {
  const ref = useRef<HTMLDivElement>(null);
  // While dragging: how far the pointer went down from the seam, and whether it has moved since.
  const drag = useRef<{ offset: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);

  const at = () => measure(ref.current!, { min, max, rest });
  const resize = (width: number, save: boolean) => {
    const m = at();
    sizePane(pane, Math.round(Math.min(Math.max(width, m.min), m.max)), m.room, { save });
  };
  const widthAt = (x: number) => x - drag.current!.offset - at().left;

  // Keep the separator's value (the pane's width) current for screen readers, however it changes.
  useEffect(() => {
    const handle = ref.current!;
    const observer = new ResizeObserver(() => {
      const m = measure(handle, { min, max, rest });
      handle.setAttribute("aria-valuenow", String(Math.round(m.width)));
      handle.setAttribute("aria-valuemin", String(m.min));
      handle.setAttribute("aria-valuemax", String(Math.round(m.max)));
    });
    observer.observe(handle.previousElementSibling!);
    return () => observer.disconnect();
  }, [min, max, rest]);

  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      data-pane={pane}
      data-dragging={dragging || undefined}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault(); // no text selection while dragging
        e.currentTarget.setPointerCapture(e.pointerId);
        const m = at();
        drag.current = { offset: e.clientX - (m.left + m.width), moved: false };
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        drag.current.moved = true;
        resize(widthAt(e.clientX), false);
      }}
      onPointerUp={(e) => {
        if (drag.current?.moved) resize(widthAt(e.clientX), true);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
        setDragging(false);
      }}
      onDoubleClick={() => resetPane(pane)}
      onKeyDown={(e) => {
        const step = { ArrowLeft: -16, ArrowRight: 16 }[e.key];
        if (!step) return;
        e.preventDefault();
        resize(at().width + step * (e.shiftKey ? 4 : 1), true);
      }}
      // 8px to grab, mostly right of the seam so it stays off the left pane's scrollbar.
      className="group relative z-10 -ml-0.5 hidden w-2 cursor-col-resize touch-none outline-none lg:block"
    >
      <div className="absolute inset-y-0 left-px w-0.5 transition-colors group-hover:bg-muted-foreground/30 group-focus-visible:bg-ring group-data-dragging:bg-muted-foreground/50" />
    </div>
  );
}

// The pane is the handle's previous sibling. Its room runs from its left edge to the right of the shell.
function measure(handle: HTMLElement, { min, max = Infinity, rest = 0 }: Limits) {
  const box = handle.previousElementSibling!.getBoundingClientRect();
  const room = handle.parentElement!.getBoundingClientRect().right - box.left;
  return { left: box.left, width: box.width, room, min, max: Math.max(min, Math.min(max, room - rest)) };
}
