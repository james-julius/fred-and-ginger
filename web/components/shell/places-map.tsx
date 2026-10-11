"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { LngLatBounds, Map as MapLibreMap, Marker, setWorkerUrl } from "maplibre-gl";
import { useEffect, useRef } from "react";

// The worker file is served from public/ (see scripts/copy-maplibre-worker.mjs).
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

export type Pin = { id: string; lat: number; lon: number; label: string; unread: boolean; warn: boolean };

// OpenFreeMap: free vector tiles, no key or account. Attribution is in the corner.
const STYLE = { light: "https://tiles.openfreemap.org/styles/positron", dark: "https://tiles.openfreemap.org/styles/dark" };
const MANHATTAN: [number, number] = [-73.9712, 40.7831];

const pinClass = (p: Pin) =>
  [
    "block cursor-pointer rounded-full border px-2 py-0.5 text-[12.5px] font-semibold tabular-nums shadow-sm transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-foreground",
    p.unread ? "border-primary bg-primary text-primary-foreground" : "bg-background text-foreground",
    p.warn ? "border-warning" : p.unread ? "" : "border-border",
  ].join(" ");

/** The inbox as price pills on a map. Loaded only when you switch to Map. */
export default function PlacesMap({ pins, onOpen }: { pins: Pin[]; onOpen: (id: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const open = useRef(onOpen);
  useEffect(() => {
    open.current = onOpen;
  }, [onOpen]);

  // One map for the life of the view; it follows light and dark mode.
  useEffect(() => {
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    const m = new MapLibreMap({
      container: box.current!,
      style: dark.matches ? STYLE.dark : STYLE.light,
      center: MANHATTAN,
      zoom: 11,
      attributionControl: { compact: true },
    });
    map.current = m;
    const restyle = () => m.setStyle(dark.matches ? STYLE.dark : STYLE.light);
    dark.addEventListener("change", restyle);
    return () => {
      dark.removeEventListener("change", restyle);
      m.remove();
      map.current = null;
    };
  }, []);

  // A pill per place, and frame them all.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const markers = pins.map((p) => {
      // MapLibre positions the outer element with a transform, so the pill (and its hover grow) lives inside it.
      const el = document.createElement("div");
      el.className = "hover:z-10";
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = pinClass(p);
      pill.textContent = p.label;
      pill.setAttribute("aria-label", `${p.label}${p.unread ? ", new" : ""}. Open listing`);
      pill.addEventListener("click", (e) => {
        e.stopPropagation();
        open.current(p.id);
      });
      el.append(pill);
      return new Marker({ element: el, anchor: "bottom" }).setLngLat([p.lon, p.lat]).addTo(m);
    });
    if (pins.length) {
      const bounds = new LngLatBounds();
      for (const p of pins) bounds.extend([p.lon, p.lat]);
      m.fitBounds(bounds, { padding: 72, maxZoom: 15, duration: 0 });
    }
    return () => markers.forEach((mk) => mk.remove());
  }, [pins]);

  return <div ref={box} className="size-full" />;
}
