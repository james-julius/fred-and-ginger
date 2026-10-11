// Brookfield Properties multifamily (rent.brookfieldproperties.com, WordPress).
// The location page inlines `let properties = [...]` (name, address, zip, lat_long,
// siteUrl) for the whole portfolio; each building page embeds a SightMap map that
// lists available units. So: 1 request for the portfolio, then 3 per NYC building.
// cfg: { locations: ['https://rent.brookfieldproperties.com/location/new-york/'] }
import { inNyc, num } from '../lib.js';
import { findEmbed, sightmapData, sightmapRows } from './sightmap.js';

function inlineArray(html, marker) {
    const at = html.indexOf(marker);
    if (at < 0) return null;
    const s = html.slice(at + marker.length);
    let depth = 0, inStr = false, esc = false;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
        if (c === '"') inStr = true;
        else if (c === '[' || c === '{') depth++;
        else if ((c === ']' || c === '}') && --depth === 0) return JSON.parse(s.slice(0, i + 1));
    }
    return null;
}

export default async function brookfield(cfg, { http, log }) {
    const props = new Map();
    for (const loc of cfg.locations ?? ['https://rent.brookfieldproperties.com/location/new-york/']) {
        const list = inlineArray(await http.text(loc), 'let properties = ') ?? [];
        for (const p of list) {
            const zip = String(p.zipCode ?? '').slice(0, 5);
            const [lat, lon] = String(p.lat_long ?? '').split(',').map(num);
            if (p.state !== 'NY' || !inNyc({ zip, lat, lon }) || !p.siteUrl) continue;
            props.set(p.propertyId, { name: p.propertyName, street: p.address, zip, lat, lon, site: /^https?:/.test(p.siteUrl) ? p.siteUrl : `https://${p.siteUrl}` });
        }
    }
    log.info(`brookfield: ${props.size} NYC properties`);
    const rows = [];
    for (const prop of props.values()) {
        try {
            const { embed, url } = await findEmbed(http, prop.site);
            if (!embed) { log.warning(`brookfield ${prop.name}: no sightmap on ${url}`); continue; }
            const r = sightmapRows(cfg, { ...prop, url }, await sightmapData(http, embed));
            log.info(`brookfield ${prop.name}: ${r.length} units`);
            rows.push(...r);
        } catch (e) {
            log.warning(`brookfield ${prop.name}: ${e.message}`);
        }
    }
    return rows;
}
