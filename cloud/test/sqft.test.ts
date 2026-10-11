// Square feet from a listing's own description, when no site gives it. Phrases are from real
// listings in production (Oct 11): the size of the apartment counts; outdoor space, the building's
// amenities and "an extra 250 sq ft" don't.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sqftFromText } from '../src/facts';

test('the ways listings state their size', () => {
  assert.equal(sqftFromText('740 sq. ft.', 1), 740);
  assert.equal(sqftFromText('✨ONE of a Kind - Approx 1500 Sq Ft✨', 2), 1500);
  assert.equal(sqftFromText('Heights, Yonkers. Approximately 1,050 sq ft.', 3), 1050);
  assert.equal(sqftFromText('This brand-new 461.73 SQFT bright one-bedroom', 1), 462);
  assert.equal(sqftFromText('Spacious 1000+ square feet, three bedrooms', 3), 1000);
  assert.equal(sqftFromText('This bright 1-bedroom condo has nearly 600 SF of living space, a private balcony', 1), 600);
  assert.equal(sqftFromText('805 Sq Feet of living space make this second floor', 2), 805);
  assert.equal(sqftFromText('2-bedroom ground-level, 775 square feet, hardwood floors', 2), 775);
  assert.equal(sqftFromText('This approximately 950 square foot 2nd floor apartment', 1), 950);
  assert.equal(sqftFromText('1 bed 1 bath, 750 Sqft', 1), 750);
});

test("other space isn't the apartment's size", () => {
  assert.equal(sqftFromText('more than 50,000 square feet of indoor and outdoor amenities', 2), null);
  assert.equal(sqftFromText('incredible private backyard oasis spanning over 800 square feet', 1), null);
  assert.equal(sqftFromText("exposed piping. But it's an extra 250 sq FT of space, and that counts", 2), null);
  assert.equal(sqftFromText('a 1,200 sq ft roof deck for residents', 1), null);
  // a Craigslist post that also carries a renter's wish list (listing 1720, Oct 11)
  assert.equal(sqftFromText('Looking for walkable, near public transit, not by busy/loud streets, 500+ sqft, easy access to a washer and dryer. My budget is $1400', 2), null);
  assert.equal(sqftFromText("I'm looking for a quiet place. This one is 640 sq ft with a dishwasher.", 1), 640);   // the next sentence is the listing
  // the outdoor space is named in a different clause: the apartment's size still counts
  assert.equal(sqftFromText('Private terrace. The apartment itself is 820 sq ft, with a dishwasher', 1), 820);
});

test('sizes that make no sense for the bedrooms are left out', () => {
  assert.equal(sqftFromText('Studio, 3500 sq ft', 0), null);
  assert.equal(sqftFromText('4 bedroom, 150 sq ft', 4), null);
  assert.equal(sqftFromText('no size here, just a square kitchen', 1), null);
  assert.equal(sqftFromText(null, 1), null);
});
