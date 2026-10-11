// Listing photos from sites that won't show them on other sites' pages: RentHop's photos don't load
// on ours. The RentHop crawler (nest-renthop, in the private crawlers repo) saves each new listing's
// photos in the Apify store nest-renthop-photos. From there:
// - photoUrl() rewrites those URLs to /api/photo?u=… wherever photos leave the API
// - /api/photo serves the copy in R2, copying it from the Apify store the first time
// - savePhotos() copies listings' photos to R2 ahead of time (cron), since the store is the crawler's
import { APP_URL } from './email';
import { apify, type Env } from './ingest';

const HOSTS = new Set(['photos.renthop.com']);
const STORE = 'jamesjulius~nest-renthop-photos';
/** a failed listing is tried again after this, once the crawler may have saved its photos */
const RETRY_S = 6 * 3600;

const host = (u: string) => { try { return new URL(u).hostname; } catch { return ''; } };
const blocked = (u: string) => HOSTS.has(host(u));

/** The URL to give the app (or an email) for a listing photo. Absolute, so it works in emails too. */
export const photoUrl = (u: string) => (blocked(u) ? `${APP_URL}/api/photo?u=${encodeURIComponent(u)}` : u);

/** A listings.photos column as the URLs to hand out. */
export function photosOf(col: string | null | undefined): string[] {
  try { return (col ? (JSON.parse(col) as string[]) : []).map(photoUrl); } catch { return []; }
}

/** The photo's key in the Apify store and in R2. Must match photoKey() in the nest-renthop crawler. */
export const photoKey = (u: string) =>
  `renthop-${new URL(u).pathname.split('/').pop()!.replace(/\.[a-z]+$/i, '')}`.replace(/[^a-zA-Z0-9!_.'()-]/g, '-').slice(0, 250);

/** Copy one photo from the crawler's store to R2. Null if the crawler hasn't saved it. */
async function copy(env: Env, u: string) {
  const r = await apify(env, `/key-value-stores/${STORE}/records/${encodeURIComponent(photoKey(u))}`);
  const type = r.headers.get('content-type') ?? '';
  if (!r.ok || !type.startsWith('image/')) { await r.body?.cancel(); return null; }
  const body = await r.arrayBuffer();
  await env.PHOTOS!.put(photoKey(u), body, { httpMetadata: { contentType: type }, customMetadata: { source: u } });
  return { body, type };
}

/** GET /api/photo?u=… — public, so alert emails can show it; only for the hosts above. */
export async function servePhoto(req: Request, env: Env): Promise<Response> {
  const u = new URL(req.url).searchParams.get('u') ?? '';
  if (!blocked(u) || !env.PHOTOS) return new Response('not a proxied photo', { status: 400 });
  const headers = (type: string) => ({ 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable' });
  const hit = await env.PHOTOS.get(photoKey(u));
  if (hit) return new Response(hit.body, { headers: headers(hit.httpMetadata?.contentType ?? 'image/jpeg') });
  const got = await copy(env, u).catch(() => null);
  // not saved yet: short cache, so it shows once the next RentHop crawl saves it
  if (!got) return new Response('photo not saved yet', { status: 404, headers: { 'Cache-Control': 'public, max-age=600' } });
  return new Response(got.body, { headers: headers(got.type) });
}

/**
 * Copy the photos of a few listings to R2. listings.photos_saved: 1 = all copied; otherwise the time
 * of the last try, retried after RETRY_S (the crawler saves photos the next time it sees the listing).
 */
export async function savePhotos(env: Env, listings = 3) {
  if (!env.PHOTOS) return;
  const t = Math.floor(Date.now() / 1000);
  const rows = (await env.DB.prepare(`SELECT id, photos FROM listings WHERE status='active' AND photos LIKE '%photos.renthop.com%'
                                       AND (photos_saved IS NULL OR (photos_saved > 1 AND photos_saved < ?))
                                       ORDER BY photos_saved IS NOT NULL, first_seen DESC LIMIT ?`).bind(t - RETRY_S, listings).all<{ id: number; photos: string }>()).results;
  for (const r of rows) {
    const urls = (JSON.parse(r.photos || '[]') as string[]).filter(blocked);
    let ok = 0;
    for (const u of urls) if ((await env.PHOTOS.head(photoKey(u))) || (await copy(env, u).catch(() => null))) ok++;
    await env.DB.prepare('UPDATE listings SET photos_saved=? WHERE id=?').bind(ok === urls.length ? 1 : t, r.id).run();
  }
}
