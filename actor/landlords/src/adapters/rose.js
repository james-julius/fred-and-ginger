// Rose Associates. Each building has its own marketing site (several sit behind
// Cloudflare), but nearly all of them embed the same availability iframe served by
// Rose: https://availability.rosenyc.com/availability/<code>/ — plain server-rendered
// tables (one per bedroom count) with td[data-label] cells: Unit, Bedroom, Bathroom,
// SqFt, Rent (or Gross Rent / Net Rent), Availability, Address, Photos. That host isn't
// bot-protected, so no browser is needed; the per-building codes were read once from
// each site's availability page and live in the config.
//
// cfg: { buildings: [{ name, code, street, zip, neighbourhood?, url (the building's own availability page) }] }
import { cheerio, makeRow, int, num, beds as parseBeds, baths as parseBaths, date, clean } from '../lib.js';

const BASE = 'https://availability.rosenyc.com/availability';

function parse(cfg, b, html) {
    const $ = cheerio.load(html);
    const rows = [];
    const seen = new Set();
    $('tr').each((_, tr) => {
        const r = $(tr);
        const cell = (label) => clean(r.find(`td[data-label="${label}"]`).first().text());
        const unit = cell('Unit');
        if (!unit || seen.has(unit)) return;
        seen.add(unit);
        const gross = int(cell('Gross Rent')) ?? int(cell('Rent'));
        const net = int(cell('Net Rent'));
        const tableBeds = num(r.attr('data-beds') ?? r.closest('table').attr('data-beds'));
        const bedText = cell('Bedroom') ?? cell('Beds');
        const avail = cell('Availability');
        const photos = r.find('td[data-label="Photos"] a[href]').map((__, a) => $(a).attr('href')).get();
        const fp = r.find('td[data-label="Floorplan"] a[href]').attr('href') ?? null;
        const moreId = r.find('a[href^="#unit"]').first().attr('href')?.slice(5) ?? null;
        const addr = cell('Address');
        rows.push(makeRow(cfg, {
            sourceId: `${b.code}-${moreId ?? unit}`,
            url: b.url ?? `${BASE}/${b.code}/`,
            street: b.street ?? addr,
            unit,
            neighbourhood: b.neighbourhood ?? null,
            zip: b.zip,
            price: gross,
            netEffective: net && gross && net < gross ? net : null,
            beds: /studio/i.test(bedText ?? '') ? 0 : (parseBeds(bedText) ?? tableBeds),
            baths: parseBaths(cell('Bathroom')),
            sqft: int(cell('SqFt')),
            available: avail ? date(avail) : null,
            photos,
            raw: {
                building: b.name, rowAddress: addr, floorplan: fp, exposure: cell('Exposure'), terrace: cell('Terrace'),
                collection: cell('Collection'), concession: cell('Concession'), term: cell('Term'), availabilityText: avail,
                iframe: `${BASE}/${b.code}/`,
            },
        }));
    });
    return rows.filter((x) => x.price > 0);
}

export default async function rose(cfg, { http, log }) {
    const rows = [];
    for (const b of cfg.buildings ?? []) {
        try {
            const r = parse(cfg, b, await http.text(`${BASE}/${b.code}/`));
            log.info(`rose ${b.name}: ${r.length} units`);
            rows.push(...r);
        } catch (e) {
            log.warning(`rose ${b.name}: ${e.message}`);
        }
    }
    return rows;
}
