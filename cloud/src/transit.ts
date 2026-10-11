// Walking distance to the subway, from the MTA's station list (data.ny.gov 39hk-dx4f, one row per
// station complex: name, daytime lines, lat, lon). Regenerate stations.json when lines change.
import stations from './stations.json';

type Station = [name: string, lines: string[], lat: number, lon: number];
const LIST = stations as unknown as Station[];

const metres = (a: number, b: number, c: number, d: number) => {
  const r = Math.PI / 180, x = (d - b) * r * Math.cos(((a + c) / 2) * r), y = (c - a) * r;
  return Math.sqrt(x * x + y * y) * 6371000;
};
// streets aren't straight lines: about 1.3x the crow-flies distance, at 80 m a minute
const walk = (m: number) => Math.max(1, Math.round((m * 1.3) / 80));

export type Transit = { lines: string[]; station: string; walkMinutes: number };

/** Stations within a 15-minute walk, nearest first, each line listed once at its nearest stop. */
export function nearby(lat: number | null | undefined, lon: number | null | undefined, maxMinutes = 15): Transit[] {
  if (lat == null || lon == null) return [];
  const near = LIST.map(([station, lines, a, b]) => ({ station, lines, walkMinutes: walk(metres(lat, lon, a, b)) }))
    .filter((s) => s.walkMinutes <= maxMinutes).sort((x, y) => x.walkMinutes - y.walkMinutes);
  const seen = new Set<string>();
  return near.flatMap((s) => {
    const lines = s.lines.filter((l) => !seen.has(l));
    lines.forEach((l) => seen.add(l));
    return lines.length ? [{ ...s, lines }] : [];
  }).slice(0, 4);
}

/** "4 min to the L at Morgan Av" */
export const transitLabel = (t: Transit) => `${t.walkMinutes} min to the ${t.lines.join('/')} at ${t.station}`;
