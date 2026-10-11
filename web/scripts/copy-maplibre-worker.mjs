// MapLibre runs map work in a web worker it loads by URL, and the bundler doesn't ship that file.
// Copy it (and the code it imports) to public/maplibre/ before dev and build; places-map.tsx points
// MapLibre at it. Git-ignored, so the repo doesn't carry the copy.
import { copyFileSync, mkdirSync } from "node:fs";

const from = new URL("../node_modules/maplibre-gl/dist/", import.meta.url);
const to = new URL("../public/maplibre/", import.meta.url);
mkdirSync(to, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) copyFileSync(new URL(file, from), new URL(file, to));
