// Equity Residential (equityapartments.com). Every page sits behind a Cloudflare
// challenge, so this runs on the browser path (browser: true).
//
// 1. The NYC metro search page (/new-york-city-apartments) links each property's
//    brochure page. New Jersey properties are skipped by URL.
// 2. Each brochure page inlines `ea5.property` (address, zip, lat/lon) and
//    `ea5.unitAvailability` (every available unit: unit id, beds, baths, sqft,
//    available date, best-term price, floor plan, photos) in the HTML itself, so
//    all sub-resources (scripts, css, XHR, third parties) are blocked to keep the
//    residential-proxy traffic down to the documents plus Cloudflare's challenge.
import { makeRow, date, inNyc, absUrl } from '../lib.js';

const BASE = 'https://www.equityapartments.com';
// let through only Equity documents and Cloudflare's same-origin /cdn-cgi/ script.
// Turnstile (challenges.cloudflare.com, ~1 MB) is blocked: headless never passes it,
// and a blocked first load just fails fast and is retried on a fresh session.
const BLOCK = /^(?!https:\/\/www\.equityapartments\.com\/(new-york-city|cdn-cgi))/;
const NJ = /jersey-city|hoboken|edgewater|weehawken|fort-lee|west-new-york|newport|harrison/i;

// JSON object assigned to `name = {...}` in inline script (string-aware brace match)
function inlineJson(html, name) {
    const at = html.indexOf(`${name} = {`);
    if (at < 0) return null;
    const from = html.indexOf('{', at);
    let depth = 0, inStr = false, esc = false;
    for (let i = from; i < html.length; i++) {
        const c = html[i];
        if (inStr) {
            if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false;
            continue;
        }
        if (c === '"') inStr = true;
        else if (c === '{') depth++;
        else if (c === '}' && --depth === 0) {
            try { return JSON.parse(html.slice(from, i + 1)); } catch { return null; }
        }
    }
    return null;
}

export default async function equity(cfg, { browser, log, limit }) {
    if (!browser) throw new Error('equity needs browser: true');
    const metro = cfg.metroUrl ?? `${BASE}/new-york-city-apartments`;
    const srp = await browser.page(metro, { block: BLOCK, settleMs: 500 });
    let links = [...new Set([...srp.html.matchAll(/href="(\/new-york-city\/[a-z0-9-]+\/[a-z0-9-]+-apartments)(?:##unit-availability-tile)?"/g)].map((m) => m[1]))];
    const skipped = links.filter((l) => NJ.test(l));
    links = links.filter((l) => !NJ.test(l));
    log.info(`equity: ${links.length} NYC properties (${skipped.length} NJ skipped)`);
    if (!links.length) throw new Error('equity: no property links on metro page');

    const rows = [];
    // one at a time with a pause: bursts trip Cloudflare's Turnstile (which headless Chrome fails)
    const pages = [];
    for (const l of links) {
        try {
            pages.push({ status: 'fulfilled', value: await browser.page(absUrl(l, BASE), { block: BLOCK, settleMs: 300 }) });
        } catch (reason) {
            pages.push({ status: 'rejected', reason });
        }
        await new Promise((r) => setTimeout(r, cfg.pauseMs ?? 4000));
    }
    pages.forEach((res, i) => {
        const url = absUrl(links[i], BASE);
        if (res.status === 'rejected') return log.warning(`equity: ${links[i]}: ${res.reason.message}`);
        const html = res.value.html;
        const p = inlineJson(html, 'ea5.property') ?? {};
        const ua = inlineJson(html, 'ea5.unitAvailability');
        if (!ua) return log.warning(`equity: no unitAvailability on ${links[i]}`);
        const lat = Number(html.match(/"Latitude"\s*:\s*(-?[\d.]+)/)?.[1]) || null;
        const lon = Number(html.match(/"Longitude"\s*:\s*(-?[\d.]+)/)?.[1]) || null;
        if (!inNyc({ zip: p.Zip, state: p.State, lat, lon })) return;
        const noFee = /no broker fee/i.test(html) ? true : null;
        const hood = links[i].split('/')[2]?.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        for (const bt of ua.BedroomTypes ?? []) {
            for (const u of bt.AvailableUnits ?? []) {
                rows.push(makeRow(cfg, {
                    sourceId: `${p.PropertyId ?? html.match(/ea5\.DocumentId = '(\w+)'/)?.[1] ?? links[i]}-${u.LedgerId ?? u.UnitId}`,
                    url,
                    street: p.Address,
                    unit: u.UnitId,
                    neighbourhood: hood,
                    zip: p.Zip,
                    city: p.City,
                    borough: /^(Manhattan|Brooklyn|Queens|Bronx|Staten Island)$/i.test(p.City ?? '') ? p.City : undefined,
                    lat, lon,
                    price: u.BestTerm?.Price ?? u.Terms?.[0]?.Price,
                    beds: u.Bed ?? bt.BedroomCount,
                    baths: u.Bath,
                    sqft: u.SqFt,
                    available: date(u.AvailableDate),
                    noFee,
                    photos: [...(u.Photos ?? []).map((x) => x.ImageUrl), u.Floorplan].map((x) => x?.trim()),
                    raw: {
                        building: p.Name, floor: u.Floor, floorPlan: u.FloorplanName, bestTerm: u.BestTerm,
                        terms: u.Terms, special: u.Special?.Active ? u.Special : null, description: u.Description,
                    },
                }));
            }
        }
    });
    return rows.slice(0, limit);
}
