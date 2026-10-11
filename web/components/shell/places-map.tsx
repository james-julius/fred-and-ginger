"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { LngLatBounds, Map as MapLibreMap, type MapOptions, Marker, NavigationControl, setWorkerUrl } from "maplibre-gl";
import { useEffect, useRef } from "react";

// The worker file is served from public/ (see scripts/copy-maplibre-worker.mjs).
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

export type Pin = { id: string; lat: number; lon: number; label: string; unread: boolean; warn: boolean };

// OpenFreeMap: free vector tiles, no key or account. Attribution is in the corner.
const STYLE = { light: "https://tiles.openfreemap.org/styles/positron", dark: "https://tiles.openfreemap.org/styles/dark" };
const MANHATTAN: [number, number] = [-73.9712, 40.7831];

// A map that follows light and dark mode. Returns it with its cleanup.
function mount(container: HTMLElement, options: Omit<MapOptions, "container" | "style">) {
  const dark = window.matchMedia("(prefers-color-scheme: dark)");
  const m = new MapLibreMap({ container, style: dark.matches ? STYLE.dark : STYLE.light, attributionControl: { compact: true }, ...options });
  const restyle = () => m.setStyle(dark.matches ? STYLE.dark : STYLE.light);
  dark.addEventListener("change", restyle);
  const remove = () => {
    dark.removeEventListener("change", restyle);
    m.remove();
  };
  return { map: m, remove };
}

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
  const framed = useRef(false);
  const open = useRef(onOpen);
  useEffect(() => {
    open.current = onOpen;
  }, [onOpen]);

  // One map for the life of the view.
  useEffect(() => {
    const { map: m, remove } = mount(box.current!, { center: MANHATTAN, zoom: 11 });
    map.current = m;
    framed.current = false;
    return () => {
      remove();
      map.current = null;
    };
  }, []);

  // A pill per place. Frame them all the first time only, so opening, saving or passing one leaves the map where you put it.
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
    if (pins.length && !framed.current) {
      const bounds = new LngLatBounds();
      for (const p of pins) bounds.extend([p.lon, p.lat]);
      m.fitBounds(bounds, { padding: 72, maxZoom: 15, duration: 0 });
      framed.current = true;
    }
    return () => markers.forEach((mk) => mk.remove());
  }, [pins]);

  return <div ref={box} className="size-full" />;
}

/**
 * One place on a small map, in the listing modal. Zoom with the buttons, a double-click or a pinch, and drag to look around.
 * The scroll wheel scrolls the modal and the arrow keys step between places, so the map leaves both alone.
 */
export function MiniMap({ lat, lon }: { lat: number; lon: number }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const { map: m, remove } = mount(box.current!, {
      center: [lon, lat],
      zoom: 14,
      scrollZoom: false,
      keyboard: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    m.touchZoomRotate.disableRotation();
    m.addControl(new NavigationControl({ showCompass: false }), "top-right");
    // The credits start open until you move the map. Fold them to the ⓘ so they don't cover it.
    m.once("load", () => box.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"));
    const dot = document.createElement("div");
    dot.className = "size-3.5 rounded-full border-2 border-background bg-primary shadow";
    new Marker({ element: dot }).setLngLat([lon, lat]).addTo(m);
    return remove;
  }, [lat, lon]);
  return <div ref={box} className="size-full" />;
}
