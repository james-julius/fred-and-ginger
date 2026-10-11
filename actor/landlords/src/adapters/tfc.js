// TF Cornerstone (tfc.com): the React site boots from one CDN JSON with every
// listed unit and property: https://cdn.tfc.com/tfc-com/initial-data.json
// Unit.Price is the net-effective rent; Unit.GrossRent is the gross.
import { makeRow, date } from '../lib.js';

export default async function tfc(cfg, { http }) {
    const d = await http.json(cfg.dataUrl ?? 'https://cdn.tfc.com/tfc-com/initial-data.json');
    const props = new Map((d.Properties?.Data ?? []).map((p) => [p.Code, p]));
    const rows = [];
    for (const u of d.Units?.Data ?? []) {
        if (u.IsListed === false) continue;
        const p = props.get(u.PropertyCode) ?? props.get(u.MarketingPropertyCode) ?? {};
        const gross = u.GrossRent || u.Price;
        const buildingPhotos = (p.Images ?? []).map((i) => i.FullUrl);
        rows.push(makeRow(cfg, {
            sourceId: u.Code,
            url: u.WebUrl,
            street: u.Address ?? p.Address,
            unit: u.Apartment,
            neighbourhood: u.Neighborhood,
            zip: p.Zip,
            city: p.City,
            lat: p.Latitude,
            lon: p.Longitude,
            price: gross,
            netEffective: u.Price,
            beds: u.NumBedrooms,
            baths: u.NumBathrooms,
            sqft: null,
            available: date(u.Availability),
            photos: [...(u.Images ?? []).map((i) => i.FullUrl), u.FloorplanCropped ?? u.Floorplan, ...buildingPhotos],
            listedAt: u.DateListed ? new Date(`${u.DateListed.replace(' ', 'T')}-04:00`).toISOString() : null,
            raw: {
                building: p.Name, propertyCode: u.PropertyCode, monthsFree: u.MonthsFree, monthsFreeTerm: u.MonthsFreeTerm,
                features: u.UnitFeatureCodes, floorplan: u.Floorplan, description: u.Description,
            },
        }));
    }
    return rows;
}
