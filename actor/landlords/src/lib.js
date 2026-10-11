// Shared helpers for platform adapters: polite HTTP, row shaping, parsing.
import * as cheerio from 'cheerio';
import { ProxyAgent } from 'undici';

export { cheerio };

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One HTTP client per company: requests are serial, spaced `delayMs` apart, retried on 5xx/429.
// Some hosts drop connections from cloud IPs: after a network-level failure ("fetch failed")
// that host is retried through `proxyUrl()` (the datacenter proxy on Apify) for the rest of the run.
const proxiedHosts = new Set();
export function makeHttp({ delayMs = 1500, log = console, timeoutMs = 30000, proxyUrl = null } = {}) {
    let last = 0;
    let count = 0;
    let agent = null;
    async function request(url, { method = 'GET', headers = {}, body, json, retries = 2 } = {}) {
        for (let attempt = 0; ; attempt++) {
            const wait = last + delayMs - Date.now();
            if (wait > 0) await sleep(wait);
            last = Date.now();
            count++;
            const h = { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9', accept: json ? 'application/json, text/plain, */*' : 'text/html,application/xhtml+xml,*/*;q=0.8', ...headers };
            let payload = body;
            if (body && typeof body === 'object' && !(body instanceof URLSearchParams)) {
                payload = JSON.stringify(body);
                h['content-type'] ??= 'application/json';
            }
            try {
                const host = new URL(url).hostname;
                let dispatcher;
                if (proxyUrl && proxiedHosts.has(host)) {
                    agent ??= new ProxyAgent(await proxyUrl());
                    dispatcher = agent;
                }
                const res = await fetch(url, { method, headers: h, body: payload, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), dispatcher });
                const text = await res.text();
                if ((res.status >= 500 || res.status === 429) && attempt < retries) {
                    log.warning?.(`${res.status} on ${url}, retrying`);
                    await sleep(3000 * (attempt + 1));
                    continue;
                }
                if (res.status >= 400) throw new Error(`HTTP ${res.status} on ${url}`);
                return { status: res.status, url: res.url, text, headers: res.headers };
            } catch (e) {
                if (proxyUrl && !/HTTP \d/.test(e.message) && !proxiedHosts.has(new URL(url).hostname)) {
                    log.info?.(`${new URL(url).hostname}: ${e.cause?.code ?? e.message}, switching to proxy`);
                    proxiedHosts.add(new URL(url).hostname);
                    continue;
                }
                if (attempt < retries && !/HTTP 4\d\d/.test(e.message)) {
                    log.warning?.(`${e.message} on ${url}, retrying`);
                    await sleep(3000 * (attempt + 1));
                    continue;
                }
                throw e;
            }
        }
    }
    return {
        request,
        get count() { return count; },
        async html(url, opts) { return cheerio.load((await request(url, opts)).text); },
        async text(url, opts) { return (await request(url, opts)).text; },
        async json(url, opts = {}) { return JSON.parse((await request(url, { ...opts, json: true })).text); },
    };
}

// ---- value parsing -------------------------------------------------------

export function num(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const m = String(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : null;
}

export function int(v) {
    const n = num(v);
    return n == null ? null : Math.round(n);
}

// "Studio" -> 0, "1 Bed" -> 1, "1.5 Bedroom" -> 1.5, "Junior 4" -> null
export function beds(v) {
    if (v == null) return null;
    if (typeof v === 'number') return v;
    const s = String(v);
    if (/studio|\bstd\b|^s$/i.test(s) && !/\d\s*(br|bd|bed)/i.test(s)) return 0;
    const m = s.match(/(\d+(\.\d+)?)\s*(-|\s)?\s*(br|bd|bed|bedroom)/i) || s.match(/^\s*(\d+(\.\d+)?)\s*$/);
    return m ? Number(m[1]) : null;
}

export function baths(v) {
    if (v == null) return null;
    if (typeof v === 'number') return v;
    const m = String(v).match(/(\d+(\.\d+)?)\s*(ba|bath)/i) || String(v).match(/^\s*(\d+(\.\d+)?)\s*$/);
    return m ? Number(m[1]) : null;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// "Now" / "Available Now" -> today; "10/22" -> next 10/22; "10/22/2026"; "2026-10-22T00:00:00"; "Oct 22, 2026"
export function date(v, now = new Date()) {
    if (v == null || v === '') return null;
    const s = String(v).trim();
    const today = iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
    if (/^(available\s*)?(now|immediately|today|immediate)\b/i.test(s)) return today;
    let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) { const out = iso(m[1], m[2], m[3]); return out < today ? today : out; }
    m = s.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
    if (m) {
        let y = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : now.getFullYear();
        const mo = Number(m[1]), d = Number(m[2]);
        if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
        if (!m[3] && iso(y, mo, d) < iso(now.getFullYear(), now.getMonth() + 1, 1)) y++;
        const out = iso(y, mo, d);
        return out < today ? today : out;
    }
    m = s.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?/);
    if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) {
        const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
        let y = m[3] ? Number(m[3]) : now.getFullYear();
        if (!m[3] && iso(y, mo, 1) < iso(now.getFullYear(), now.getMonth() + 1, 1)) y++;
        const out = iso(y, mo, Number(m[2]));
        return out < today ? today : out;
    }
    return null;
}

// "4B", "Apt 4B", "#4B", "Unit 4B" -> "4B"
export function unit(v) {
    if (v == null) return null;
    const s = String(v).replace(/^(apartment|apt\.?|unit|residence|#)\s*/i, '').replace(/^#/, '').trim();
    return s || null;
}

const BOROUGH_ZIPS = [
    [10001, 10282, 'Manhattan'], [10301, 10314, 'Staten Island'], [10451, 10475, 'Bronx'],
    [11201, 11256, 'Brooklyn'], [11004, 11005, 'Queens'], [11101, 11109, 'Queens'], [11351, 11697, 'Queens'],
];
export function boroughFromZip(zip) {
    const z = Number(String(zip ?? '').slice(0, 5));
    if (!z) return null;
    for (const [a, b, name] of BOROUGH_ZIPS) if (z >= a && z <= b) return name;
    return null;
}

const BOROUGH_WORDS = { manhattan: 'Manhattan', 'new york': 'Manhattan', brooklyn: 'Brooklyn', queens: 'Queens', bronx: 'Bronx', 'staten island': 'Staten Island', 'long island city': 'Queens', astoria: 'Queens', 'jamaica': 'Queens', flushing: 'Queens', 'forest hills': 'Queens', 'rego park': 'Queens', 'jackson heights': 'Queens', 'sunnyside': 'Queens', 'woodside': 'Queens', 'elmhurst': 'Queens', 'corona': 'Queens', 'ridgewood': 'Queens', 'roosevelt island': 'Manhattan' };
export function boroughFromCity(city) {
    if (!city) return null;
    return BOROUGH_WORDS[String(city).trim().toLowerCase()] ?? null;
}

// "535 West 23rd Street, New York, NY 10011" -> { street, city, state, zip }
export function splitAddress(s) {
    if (!s) return {};
    const t = String(s).replace(/\s+/g, ' ').trim();
    const zip = t.match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1] ?? t.match(/\bNY\s+(\d{5})/i)?.[1] ?? null;
    const parts = t.split(',').map((x) => x.trim()).filter(Boolean);
    const street = parts[0] ?? null;
    const city = parts.length > 2 ? parts[1] : (parts[1]?.replace(/\bNY\b.*$/i, '').trim() || null);
    return { street, city, zip };
}

// Rough NYC bounding box, used to drop out-of-town properties from national portfolios.
export function inNyc({ lat, lon, zip, state, city } = {}) {
    if (zip) return !!boroughFromZip(zip);
    if (lat != null && lon != null) return lat > 40.49 && lat < 40.92 && lon > -74.27 && lon < -73.68;
    if (state && !/^(NY|New York)$/i.test(state)) return false;
    if (city) return !!boroughFromCity(city);
    return true;
}

export const clean = (s) => (s == null ? null : String(s).replace(/\s+/g, ' ').trim() || null);

// Build a schema row; every field present, unknowns null.
export function makeRow(cfg, r) {
    const zip = r.zip ? String(r.zip).slice(0, 5) : null;
    const price = int(r.price);
    const sqft = int(r.sqft);
    return {
        source: `landlord:${cfg.slug}`,
        sourceId: String(r.sourceId),
        url: r.url ?? null,
        street: clean(r.street),
        unit: unit(r.unit),
        neighbourhood: clean(r.neighbourhood),
        borough: r.borough ?? boroughFromZip(zip) ?? boroughFromCity(r.city) ?? null,
        zip,
        lat: num(r.lat),
        lon: num(r.lon),
        price,
        netEffective: int(r.netEffective) && int(r.netEffective) !== price ? int(r.netEffective) : null,
        beds: typeof r.beds === 'number' ? r.beds : beds(r.beds),
        baths: typeof r.baths === 'number' ? r.baths : baths(r.baths),
        sqft: sqft && sqft > 0 ? sqft : null,
        noFee: r.noFee ?? cfg.noFee ?? null,
        available: r.available ?? null,
        photos: (r.photos ?? []).filter(Boolean).slice(0, 8),
        agency: r.agency ?? cfg.company,
        listedAt: r.listedAt ?? null,
        scrapedAt: new Date().toISOString(),
        raw: { company: cfg.company, platform: cfg.platform, ...(r.raw ?? {}) },
    };
}

export function absUrl(u, base) {
    if (!u) return null;
    try { return new URL(u, base).toString(); } catch { return null; }
}
