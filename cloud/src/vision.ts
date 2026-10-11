// Fred looks at a listing's photos with a vision model: what's really in them (light, kitchen,
// laundry, condition), whether they match the listing (rooms, beds), and signs they aren't the
// real apartment (renders, stock or virtually staged photos, another unit's pictures). Gemini by
// default; when a model is busy or fails, the next one in visionModels() tries. Results are cached
// per listing, photo set and question, so each look is paid once.
import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import type { Env } from './ingest';
import { photosOf } from './photos';

const MAX_PHOTOS = 8;

/** VISION_MODEL first if set, then Gemini 3.8 Flash and 3.5 Flash (Google key), then Claude (Anthropic key). */
export function visionModels(env: Env) {
  const m: string[] = [];
  if (env.VISION_MODEL) m.push(env.VISION_MODEL);
  if (env.GOOGLE_GENERATIVE_AI_API_KEY) m.push('google/gemini-3.8-flash', 'google/gemini-3.5-flash');
  if (env.ANTHROPIC_API_KEY) m.push('anthropic/claude-sonnet-5-5');
  return [...new Set(m)];
}

const yesNo = z.enum(['yes', 'no', 'unknown']);
export const Examination = z.object({
  summary: z.string().describe('Two or three plain sentences: what the photos show, as a friend who walked through would say it'),
  photos: z.array(z.object({
    n: z.number().int().describe('1-based photo number'),
    shows: z.enum(['living', 'bedroom', 'kitchen', 'bathroom', 'closet', 'laundry', 'outdoor', 'view', 'exterior', 'building_amenity', 'floorplan', 'other']),
    note: z.string().describe('One short line of what you see'),
  })),
  light: z.object({ rating: z.enum(['bright', 'average', 'dim', 'unknown']), evidence: z.string() }),
  kitchen: z.object({ seen: z.boolean(), updated: yesNo, dishwasher: yesNo, note: z.string() }),
  laundry: z.enum(['in_unit', 'not_seen']).describe('in_unit only if a washer/dryer is visible in the apartment'),
  outdoor: z.string().nullable().describe('Balcony, terrace, yard or roof access seen, or null'),
  condition: z.object({ overall: z.enum(['renovated', 'good', 'worn', 'poor', 'unknown']), issues: z.array(z.string()).describe('Visible problems: water stains, mould, cracks, damaged floors, old fixtures') }),
  matchesListing: z.object({
    bedroomsSeen: z.number().int().nullable(), bathroomsSeen: z.number().nullable(),
    consistent: yesNo, note: z.string().describe('Whether the photos fit the listed beds, baths and size'),
  }),
  redFlags: z.array(z.string()).describe('Signs these may not be this apartment: renders, virtual staging, stock photos, other sites\' watermarks, photos of different units or seasons mixed, exterior of a different building'),
  answer: z.string().nullable().describe('The answer to the question asked, from the photos only; null if no question'),
});
export type Examination = z.infer<typeof Examination>;

const INSTRUCTIONS = `You inspect rental listing photos for someone deciding whether to see an apartment in New York.
Only report what you can actually see. Say "unknown" or leave a list empty rather than guess. Be specific and brief.
Number photos in the order given, starting at 1. Point out anything a renter would want to know before a viewing.`;

async function hash(s: string) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(h)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Look at one listing's photos. Returns the examination, from cache when the photos and question are unchanged. */
export async function examine(env: Env, listingId: number, question?: string | null): Promise<(Examination & { model: string; photosLooked: number; cached: boolean }) | { error: string }> {
  const models = visionModels(env);
  if (!models.length) return { error: 'No vision model is set up (add GOOGLE_GENERATIVE_AI_API_KEY, or set VISION_MODEL)' };
  const r = await env.DB.prepare('SELECT id, street, unit, neighbourhood, borough, price, beds, baths, sqft, photos, facts FROM listings WHERE id=?')
    .bind(listingId).first<any>();
  if (!r) return { error: `No listing ${listingId}` };
  const urls = photosOf(r.photos).slice(0, MAX_PHOTOS);
  if (!urls.length) return { error: 'This listing has no photos' };

  const q = question?.trim() || null;
  const key = `vision:${listingId}:${await hash(`${urls.join('|')}|${q ?? ''}`)}`;
  const hit = await env.DB.prepare('SELECT v FROM meta WHERE k=?').bind(key).first<{ v: string }>();
  if (hit) return { ...JSON.parse(hit.v), cached: true };

  const facts = r.facts ? JSON.parse(r.facts) : null;
  const listing = [
    `${r.street ?? 'Address not given'}${r.unit ? ` #${r.unit}` : ''}, ${r.neighbourhood ?? r.borough ?? 'New York'}`,
    `$${r.price}/mo · ${r.beds ?? '?'} bed · ${r.baths ?? '?'} bath${r.sqft ? ` · ${r.sqft} ft²` : ''}`,
    facts ? `The listing claims: ${JSON.stringify(facts).slice(0, 1500)}` : '',
  ].filter(Boolean).join('\n');

  const content = [
    { type: 'text' as const, text: `${listing}\n\n${urls.length} photos follow.${q ? `\n\nQuestion: ${q}` : ''}` },
    ...urls.map((u) => ({ type: 'image' as const, image: new URL(u) })),
  ];
  let out: (Examination & { model: string; photosLooked: number }) | null = null, last: unknown = null;
  for (const model of models) {
    try {
      const agent = new Agent({ id: 'fred-vision', name: 'Fred vision', instructions: INSTRUCTIONS, model });
      // one retry each: on a busy model, the next model is quicker than waiting it out
      const res = await agent.generate([{ role: 'user', content }], { structuredOutput: { schema: Examination }, modelSettings: { maxRetries: 1 } });
      if (res.object) { out = { ...(res.object as Examination), model, photosLooked: urls.length }; break; }
    } catch (e) { last = e; console.log('vision: model failed', model, String(e).slice(0, 200)); }
  }
  if (!out) return { error: `Couldn't look at the photos right now (${String(last ?? 'no answer').slice(0, 160)})` };
  await env.DB.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').bind(key, JSON.stringify(out)).run();
  return { ...out, cached: false };
}
