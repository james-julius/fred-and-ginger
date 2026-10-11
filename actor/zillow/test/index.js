// node --test actor/zillow/test  (or `npm test` in actor/zillow) — parser checks against real (trimmed) Zillow page payloads
// saved from a probe run on 2026-10-11 (test/fixtures/*.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    parseDetailPage, applyDetail, sqftFromText, laundryFromText, noFeeFromText, utilitiesFromText, floorFromText,
} from '../src/detail.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const load = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));

test('unit page: 215 Maujer St #4A (no fee, laundry in building, $20 application fee)', () => {
    const r = parseDetailPage(load('unit-215-maujer-4a.json'));
    assert.equal(r.kind, 'unit');
    assert.match(r.detail.description, /^Magnificent large 2 bdrm/);
    assert.ok(!/\s{2,}|\n/.test(r.detail.description), 'whitespace collapsed');
    assert.ok(r.detail.amenities.includes('Dishwasher'));
    assert.ok(r.detail.amenities.includes('Balcony'));
    assert.equal(r.detail.pets, 'Cats, Dogs, Small Dogs allowed');
    assert.equal(r.detail.laundry, 'Laundry in building');
    assert.deepEqual(r.detail.fees, [{ name: 'Application fee', amount: 20, period: 'once' }]);
    assert.equal(r.detail.brokerFee, 'No fee');
    assert.equal(r.top.noFee, true);
    assert.equal(r.top.baths, 1);
    assert.equal(r.top.available, '2026-10-15');
    assert.equal(r.top.photos.length, 8);
    assert.match(r.top.photos[0], /^https:\/\/photos\.zillowstatic\.com\//);
    assert.equal(r.detail.leaseTerms, undefined, '"Contact For Details" is not a lease term');
});

test('unit page: 138 Scholes St #3 (livingArea 800, no pets)', () => {
    const r = parseDetailPage(load('unit-138-scholes-3.json'));
    assert.equal(r.top.sqft, 800);
    assert.equal(r.detail.sqftSource, undefined, 'structured sqft, not from text');
    assert.equal(r.detail.pets, 'No Pets');
    assert.equal(r.top.available, undefined);
});

test('unit page: 91 Graham Ave #3C (laundry "In Unit" from the facts table)', () => {
    const r = parseDetailPage(load('unit-91-graham-3c.json'));
    assert.equal(r.detail.laundry, 'Washer/dryer in unit');
    assert.ok(r.detail.amenities.includes('Central Air'));
});

test('unit page: 348 S 4th St #4R (utilities and floor from the listing text)', () => {
    const r = parseDetailPage(load('unit-348-s4th-4r.json'));
    assert.deepEqual(r.detail.utilities, ['Heat', 'Hot water']);
    assert.equal(r.detail.floor, 4);
    assert.equal(r.top.available, '2026-11-01');
});

test('building page: 250 N 10th St (managed building: amenities, pets, laundry, utilities, units)', () => {
    const r = parseDetailPage(load('building-250-n-10th.json'));
    assert.equal(r.kind, 'building');
    for (const a of ['Concierge', 'Fitness center', 'Doorman', 'Elevator', 'Dishwasher']) assert.ok(r.detail.amenities.includes(a), a);
    assert.equal(r.detail.pets, 'Cats, Small dogs allowed');
    assert.equal(r.detail.laundry, 'Shared laundry, washer/dryer');
    assert.deepEqual(r.detail.utilities, ['Garbage', 'Gas', 'Sewer', 'Water']);
    assert.equal(r.detail.units.length, 2);
    assert.deepEqual(r.detail.units[0], { unit: '228', beds: 0, baths: 1, price: 4040, available: '2026-10-15', zpid: '2101199193' });
});

test('building page: 229 Wythe Ave (description, units by bed count)', () => {
    const r = parseDetailPage(load('building-229-wythe.json'));
    assert.match(r.detail.description, /^PRIME WILLIAMSBURG LUXURY RENTALS/);
    assert.ok(r.detail.description.length <= 4000);
    const beds = r.detail.units.map((u) => u.beds);
    assert.ok(beds.includes(0) && beds.includes(1) && beds.includes(2));
    assert.ok(r.detail.units.every((u) => u.price > 1000), 'only FOR_RENT units with a price');
});

test('building page: 212 Grand St (only rentals become units; roster size is buildingUnits)', () => {
    const r = parseDetailPage(load('building-212-grand.json'));
    assert.equal(r.detail.units.length, 2);
    assert.equal(r.detail.buildingUnits, 19);
});

test('applyDetail: unit row takes page sqft/baths/available and gets raw.detail', () => {
    const rec = { fetchedAt: '2026-10-11T00:00:00.000Z', ...parseDetailPage(load('unit-138-scholes-3.json')) };
    const row = { sourceId: '2091642253', sqft: null, baths: 1, noFee: null, available: null, photos: ['a'], raw: { isBuilding: false } };
    const out = applyDetail(row, rec);
    assert.equal(out.sqft, 800);
    assert.equal(out.raw.detail.fetchedAt, '2026-10-11T00:00:00.000Z');
    assert.equal(out.raw.detail.pets, 'No Pets');
    assert.equal(out.photos.length, 8);
    assert.equal(row.raw.detail, undefined, 'input row not mutated');
});

test('applyDetail: building row keeps only its bed count units; sqft = smallest when they differ', () => {
    const rec = {
        fetchedAt: '2026-10-11T00:00:00.000Z',
        kind: 'building',
        top: {},
        detail: { amenities: ['Elevator'], units: [
            { unit: '1A', beds: 1, baths: 1, sqft: 650, price: 4000, available: '2026-11-01' },
            { unit: '2A', beds: 1, baths: 1, sqft: 600, price: 4100, available: '2026-10-20' },
            { unit: '3A', beds: 2, baths: 2, sqft: 900, price: 5200 },
        ] },
    };
    const row = { sourceId: 'b1-1br', beds: 1, sqft: null, baths: null, available: null, photos: [], raw: { isBuilding: true } };
    const out = applyDetail(row, rec);
    assert.equal(out.raw.detail.units.length, 2);
    assert.equal(out.sqft, 600);
    assert.equal(out.baths, 1);
    assert.equal(out.available, '2026-10-20');
    assert.deepEqual(out.raw.detail.amenities, ['Elevator']);
});

test('applyDetail: no record leaves the row as is', () => {
    const row = { sqft: null, raw: {} };
    assert.equal(applyDetail(row, null), row);
});

test('text extractors only take what the text states', () => {
    assert.equal(sqftFromText('Spacious 1,100 sq ft two bedroom'), 1100);
    assert.equal(sqftFromText('approx. 750 square feet'), 750);
    assert.equal(sqftFromText('650 SF unit with a 1,000 sf roof deck'), null, 'ambiguous');
    assert.equal(sqftFromText('$3,500 a month'), null);
    assert.equal(laundryFromText('W/D IN UNIT!!'), 'Washer/dryer in unit');
    assert.equal(laundryFromText('Laundry on Every Floor'), 'Laundry in building');
    assert.equal(laundryFromText('Hardwood floors, dishwasher'), null);
    assert.equal(noFeeFromText('NO FEE! Private balcony'), 'No fee');
    assert.equal(noFeeFromText('No application fee, no broker\'s fee!'), 'No fee');
    assert.equal(noFeeFromText('Great light'), null);
    assert.deepEqual(utilitiesFromText('Heat and hot water included'), ['Heat', 'Hot water']);
    assert.deepEqual(utilitiesFromText('nice place'), []);
    assert.equal(floorFromText('Situated on the top (4th) floor'), 4);
    assert.equal(floorFromText('on the 3rd floor of a walk-up'), 3);
    assert.equal(floorFromText('second-floor walkup'), 2);
});
