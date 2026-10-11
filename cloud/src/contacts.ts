// Who Fred can email about a listing. Only real published addresses: a Compass agent's own email
// from the listing, or a landlord's leasing office from landlord-contacts.json (researched from
// each company's official site; building-specific first, then the company's NYC address).
import landlords from './landlord-contacts.json';

export type Contact = { email: string; name: string | null; source: 'compass-agent' | 'landlord-building' | 'landlord-company'; company?: string };

type Book = Record<string, {
  company: { email: string | null; phone: string | null; url: string | null };
  buildings: { building: string; street: string; email: string | null; phone: string | null; form: string | null; url: string | null; confidence: string; note: string | null }[];
}>;
const book = landlords as unknown as Book;

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export async function contactFor(db: D1Database, listingId: number): Promise<Contact | null> {
  const rows = await db.prepare('SELECT source, raw FROM sightings WHERE listing_id=?').bind(listingId).all<{ source: string; raw: string | null }>();
  for (const r of rows.results) {
    const raw = (() => { try { return JSON.parse(r.raw ?? '{}'); } catch { return {}; } })();
    if (r.source === 'compass' && typeof raw.agentEmail === 'string' && EMAIL.test(raw.agentEmail)) {
      return { email: raw.agentEmail, name: raw.agentName ?? null, source: 'compass-agent' };
    }
    if (r.source.startsWith('landlord:')) {
      const key = r.source.slice('landlord:'.length), entry = book[key];
      if (!entry) continue;
      const building = norm(raw.building ?? raw.buildingGroup ?? raw.rowAddress);
      const hit = entry.buildings.find((b) => b.email && b.confidence !== 'low' && (norm(b.building) === building || (building && norm(b.street) === building)));
      if (hit?.email) return { email: hit.email, name: `${hit.building} leasing`, source: 'landlord-building', company: key };
      if (entry.company.email) return { email: entry.company.email, name: `${raw.company ?? key} leasing`, source: 'landlord-company', company: key };
    }
  }
  return null;
}
