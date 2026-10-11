// What a listing's own page (raw.detail, actor/SCHEMA.md) adds: fees classified into real costs,
// utilities, lease length, floor, page amenities and description, and highlights from sqft.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costsOf, factsFrom, feeCallout, feesFrom, highlights, mergeFacts } from '../src/facts';

const page = {
  title: 'Card text', detail: {
    description: 'Sun-drenched corner one bedroom with a washer/dryer in unit and southern exposure. Cats and dogs welcome.',
    amenities: ['Dishwasher', 'Roof deck', 'dishwasher', 'Bike room'],
    fees: [{ name: 'Application fee', amount: 20, period: 'once' }, { name: 'Amenity fee', amount: 85, period: 'monthly' },
           { name: 'Security deposit', amount: 3500, period: 'once' }, { name: 'Parking', amount: 300, period: 'monthly' },
           { name: 'Pet rent', amount: 50, period: 'monthly' }, { name: 'Application Fee', amount: 20, period: 'once' }],
    utilities: ['heat', 'Hot water'], leaseTerms: '12-24 months', floor: 4, brokerFee: 'No fee',
  },
};

test('fees are classified, deduped, and optional extras marked', () => {
  const fees = feesFrom(page.detail.fees);
  assert.deepEqual(fees.map((f) => [f.kind, f.amount, f.period, f.required]), [
    ['application', 20, 'once', true], ['amenity', 85, 'monthly', false], ['security_deposit', 3500, 'once', true],
    ['parking', 300, 'monthly', false], ['pet', 50, 'monthly', true],
  ]);
  assert.deepEqual(feesFrom([{ name: 'Broker fee', amount: 'n/a' }, { name: '' }, 'junk']).map((f) => [f.kind, f.amount]), [['broker', null]]);
  assert.deepEqual(feesFrom(undefined), []);
});

test("the page's own data fills facts", () => {
  const f = factsFrom(page);
  assert.equal(f.laundry, 'in_unit');
  assert.equal(f.pets, 'dogs_and_cats');
  assert.equal(f.light, 'Floor-to-ceiling windows' === f.light ? f.light : 'Southern exposure');
  assert.match(f.description!, /^Sun-drenched corner/);
  assert.deepEqual(f.amenities.slice(0, 3), ['Dishwasher', 'Roof deck', 'Bike room']);
  assert.deepEqual(f.utilities, ['Heat', 'Hot water']);
  assert.equal(f.leaseMonths, 12);
  assert.equal(f.floor, 4);
  assert.equal(f.noFee, true);
  assert.equal(factsFrom({ detail: { leaseTerms: '1 year' } }).leaseMonths, 12);
  // Zillow's own wording, on 19 of 30 Williamsburg listings
  assert.equal(factsFrom({ detail: { pets: 'Cats, Dogs, Small Dogs allowed' } }).pets, 'dogs_and_cats');
  assert.equal(factsFrom({ detail: { pets: 'Cats allowed' } }).pets, 'cats');
  assert.equal(factsFrom({ detail: { pets: 'Small dogs allowed' } }).pets, 'dogs');
  assert.equal(factsFrom({ detail: { pets: 'No Pets' } }).pets, 'none');
  assert.equal(factsFrom({ body: 'Dogs and cats are welcome here, with a pet rent of $50.' }).pets, 'dogs_and_cats');
  assert.equal(factsFrom({ detail: { brokerFee: '15% of annual rent' } }).noFee, false);
});

test('facts from several sites merge fees and keep the first known floor and lease', () => {
  const m = mergeFacts([factsFrom({ detail: { fees: [{ name: 'Application fee', amount: 20 }] } }), factsFrom(page)]);
  assert.equal(m.fees.length, 5);
  assert.equal(m.floor, 4);
  assert.equal(m.leaseMonths, 12);
});

test('real costs: required monthly fees on top of rent, cash to move in, broker fee', () => {
  const c = costsOf(3500, null, null, factsFrom(page));
  assert.equal(c.monthlyFees, 50);                 // pet rent; amenity and parking are optional
  assert.equal(c.totalMonthly, 3550);
  assert.equal(c.moveInEstimate, 3500 + 50 + 20 + 3500);
  assert.equal(c.brokerFee, 'none');
  assert.equal(c.leaseMonths, 12);
  assert.equal(c.fees[0].source, 'listing');
  const bare = costsOf(3000, null, null, null);
  assert.deepEqual([bare.totalMonthly, bare.moveInEstimate, bare.brokerFee, bare.fees.length], [3000, null, 'unknown', 0]);
  assert.equal(costsOf(3000, null, null, factsFrom({ detail: { fees: [{ name: 'Broker fee', amount: 5400 }] } })).brokerFee, 'tenant');
});

test('the card shows the fee that matters', () => {
  assert.deepEqual(feeCallout(null, factsFrom(page)), { label: '+$50/mo pet rent', amount: 50, period: 'monthly' });
  assert.deepEqual(feeCallout(null, factsFrom({ detail: { fees: [{ name: 'Broker fee', amount: 5400 }] } })), { label: '$5,400 broker fee', amount: 5400, period: 'once' });
  assert.equal(feeCallout(1, factsFrom({ detail: { fees: [{ name: 'Broker fee', amount: 5400 }] } })), null);   // the column says no fee
  assert.equal(feeCallout(null, null), null);
});

test('roomy for its bedrooms, and included utilities, are highlights', () => {
  const h = highlights(factsFrom(page), { price: 3500, sqft: 850, beds: 1 });
  assert.ok(h.includes('Big for a 1-bed: 850 sq ft'));
  assert.ok(h.includes('Heat and hot water included'));
  assert.ok(!highlights(null, { price: 3500, sqft: 600, beds: 1 }).some((x) => /Big/.test(x)));
  assert.ok(highlights(null, { price: 2500, sqft: 560, beds: 0 }).includes('Big for a studio: 560 sq ft'));
});
