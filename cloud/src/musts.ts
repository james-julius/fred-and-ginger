// Must-haves ("has to have a washer/dryer") checked against what a listing actually says. A place
// that clearly lacks one never reaches the person, whoever is looking: the inbox, Fred's search,
// or Fred adding it. A listing that doesn't say stays in, marked unconfirmed, because most sites
// don't say and dropping unknowns would empty the inbox.
import type { Facts } from './facts';

type Rule = { label: RegExp; has: (f: Facts) => boolean | null };

// true: it has it. false: the listing says otherwise. null: the listing doesn't say.
const RULES: Rule[] = [
  { label: /in.?unit|w\/d|washer|dryer/i, has: (f) => (f.laundry === 'in_unit' ? true : f.laundry === 'in_building' ? false : null) },
  { label: /laundry/i, has: (f) => (f.laundry ? true : null) },
  { label: /private.*(outdoor|balcony|terrace|patio|yard|garden)|balcony|terrace|patio/i, has: (f) => (f.outdoor === 'private' ? true : f.outdoor === 'shared' ? false : null) },
  { label: /outdoor|yard|garden|roof/i, has: (f) => (f.outdoor ? true : null) },
  { label: /elevator|no walk.?up/i, has: (f) => (f.elevator ? true : f.walkUp ? false : null) },
  { label: /dishwasher/i, has: (f) => (f.dishwasher ? true : null) },
  { label: /doorman|door attendant|concierge/i, has: (f) => (f.doorman ? true : null) },
  { label: /\bgym\b|fitness/i, has: (f) => (f.gym ? true : null) },
  { label: /rent.?stabili[sz]ed/i, has: (f) => (f.rentStabilized ? true : null) },
];

export type MustCheck = { lacks: string[]; unconfirmed: string[] };

/** What a listing clearly lacks, and what it doesn't say, of these must-haves. */
export function checkMusts(musts: string[], facts: Facts | null): MustCheck {
  const out: MustCheck = { lacks: [], unconfirmed: [] };
  for (const m of musts) {
    const rule = RULES.find((r) => r.label.test(m)), has = rule && facts ? rule.has(facts) : null;
    if (has === false) out.lacks.push(m);
    else if (has === null) out.unconfirmed.push(m);
  }
  return out;
}

/** the must-have labels in a saved search */
export const mustsOf = (s: { preferences?: { label: string; weight: string }[] }) => (s.preferences ?? []).filter((p) => p.weight === 'must').map((p) => p.label);
