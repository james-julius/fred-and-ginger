// Listing photos from sites that won't show them on our pages. RentHop puts a Cloudflare bot check in
// front of photos.renthop.com, so an <img> pointing there gets a 403 page instead of the picture. A
// request with a browser's user agent and a RentHop referer gets the image, so we fetch it ourselves:
// - photoUrl() rewrites those URLs to /api/photo?u=… wherever photos leave the API
// - /api/photo serves the copy in R2, fetching and storing it the first time
// - savePhotos() copies new listings' photos ahead of time (cron), so they outlive the listing on the site
import { APP_URL } from './email';

const HOSTS = new Set(['photos.renthop.com']);
const REFERER: Record<string, string> = { 'photos.renthop.com': 'https://www.renthop.com/' };
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const host = (u: string) => { try { return new URL(u).hostname; } catch { return ''; } };
const blocked = (u: string) => HOSTS.has(host(u));

/** The URL to give the app (or an email) for a listing photo. Absolute, so it works in emails too. */
export const photoUrl = (u: string) => (blocked(u) ? `${APP_URL}/api/photo?u=${encodeURIComponent(u)}` : u);

/** A listings.photos column as the URLs to hand out. */
export function photosOf(col: string | null | undefined): string[] {
  try { return (col ? (JSON.parse(col) as string[]) : []).map(photoUrl); } catch { return []; }
}

async function key(u: string) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(u));
  return `${host(u)}/${[...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Fetch one photo from its site and keep it in R2. Returns the stored object, or null if the site said no. */
async function copy(bucket: R2Bucket, u: string) {
  const r = await fetch(u, { headers: { 'User-Agent': UA, Referer: REFERER[host(u)] ?? `https://${host(u)}/`, Accept: 'image/avif,image/webp,image/*,*/*;q=0.8' } });
  const type = r.headers.get('content-type') ?? '';
  if (!r.ok || !type.startsWith('image/')) return null;
  const body = await r.arrayBuffer();
  await bucket.put(await key(u), body, { httpMetadata: { contentType: type }, customMetadata: { source: u } });
  return { body, type };
}

/** GET /api/photo?u=… — public, so alert emails can show it; only for the hosts above. */
export async function servePhoto(req: Request, bucket: R2Bucket | undefined): Promise<Response> {
  const u = new URL(req.url).searchParams.get('u') ?? '';
  if (!blocked(u)) return new Response('not a proxied photo host', { status: 400 });
  const headers = (type: string) => ({ 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable' });
  if (bucket) {
    const hit = await bucket.get(await key(u));
    if (hit) return new Response(hit.body, { headers: headers(hit.httpMetadata?.contentType ?? 'image/jpeg') });
  }
  const got = bucket ? await copy(bucket, u) : null;
  if (!got) return new Response('photo unavailable', { status: 502 });
  return new Response(got.body, { headers: headers(got.type) });
}

/** Copy the photos of a few listings that have blocked-host photos and haven't been copied yet. */
export async function savePhotos(db: D1Database, bucket: R2Bucket | undefined, listings = 2) {
  if (!bucket) return;
  const rows = (await db.prepare(`SELECT id, photos FROM listings WHERE photos_saved IS NULL AND status='active' AND photos LIKE '%photos.renthop.com%'
                                   ORDER BY first_seen DESC LIMIT ?`).bind(listings).all<{ id: number; photos: string }>()).results;
  for (const r of rows) {
    let ok = 0;
    const urls = (JSON.parse(r.photos || '[]') as string[]).filter(blocked);
    for (const u of urls) {
      if (await bucket.head(await key(u))) { ok++; continue; }
      if (await copy(bucket, u).catch(() => null)) ok++;
    }
    // 1 = all copied; 0 = some failed, tried again by the proxy when someone opens it
    await db.prepare('UPDATE listings SET photos_saved=? WHERE id=?').bind(ok === urls.length ? 1 : 0, r.id).run();
  }
}
