// Where and when each person hears about new places: settings, verifying an email address or
// phone number with a 6-digit code, and test alerts. Nothing goes to an address until it's
// verified. Email sends through Cloudflare; texts aren't available yet, so phone numbers can be
// saved but not verified.
import type * as S from '@fng/api';
import type { z } from '@hono/zod-openapi';
import { alertEmail, codeEmail, sendEmail, type AlertPlace } from './email';
import { detail } from './agent/listings';
import type { inbox } from './places';

type Alerts = z.infer<typeof S.Alerts>;
type Patch = z.infer<typeof S.AlertsPatch>;
export type Channel = 'email' | 'sms';
type Env = { DB: D1Database; SESSION_KEY: string; EMAIL?: SendEmail; FRED_DEV?: string };

const SMS_AVAILABLE = false;           // flip when an SMS provider is set up
const CODE_TTL = 10 * 60, MAX_TRIES = 5, RESEND_GAP = 60, SENDS_PER_HOUR = 5;
const now = () => Math.floor(Date.now() / 1000);

/** A friendly error the API returns as { error } with this status. */
export class AlertError extends Error {
  constructor(public status: 400 | 429 | 501, message: string) { super(message); }
}

type Row = { mode: string; quiet_start: string | null; quiet_end: string | null; email: string | null; email_verified: number; email_enabled: number; phone: string | null; phone_verified: number; sms_enabled: number };

async function row(db: D1Database, user: string): Promise<Row> {
  return (await db.prepare('SELECT * FROM alert_settings WHERE user=?').bind(user).first<Row>())
    ?? { mode: 'instant_strong', quiet_start: '22:00', quiet_end: '08:00', email: null, email_verified: 0, email_enabled: 0, phone: null, phone_verified: 0, sms_enabled: 0 };
}

const shape = (r: Row): Alerts => ({
  mode: r.mode as Alerts['mode'],
  quietHours: r.quiet_start && r.quiet_end ? { start: r.quiet_start, end: r.quiet_end } : null,
  email: { address: r.email, enabled: !!r.email_enabled, verified: !!r.email_verified, available: true },
  sms: { number: r.phone, enabled: !!r.sms_enabled, verified: !!r.phone_verified, available: SMS_AVAILABLE },
});

export const getAlerts = async (db: D1Database, user: string) => shape(await row(db, user));

async function store(db: D1Database, user: string, r: Row) {
  await db.prepare(`INSERT OR REPLACE INTO alert_settings (user, mode, quiet_start, quiet_end, email, email_verified, email_enabled, phone, phone_verified, sms_enabled, updated)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(user, r.mode, r.quiet_start, r.quiet_end, r.email, r.email_verified, r.email_enabled, r.phone, r.phone_verified, r.sms_enabled, now()).run();
}

/** "(212) 555-1234", "212.555.1234", "+44 20 7946 0958" → E.164. US numbers may skip the +1. */
export function normalizePhone(input: string): string {
  const digits = input.replace(/[^\d+]/g, '');
  const e164 = digits.startsWith('+') ? digits : digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith('1') ? `+${digits}` : null;
  if (!e164 || !/^\+[1-9]\d{7,14}$/.test(e164)) throw new AlertError(400, "That doesn't look like a phone number. US numbers can be 10 digits; others need the country code, like +44.");
  return e164;
}

export function mask(channel: Channel, dest: string) {
  if (channel === 'sms') return `•••-•••-${dest.slice(-4)}`;
  const [name, domain] = dest.split('@');
  return `${name.slice(0, 1)}•••@${domain}`;
}

/** Save changes. A new address or number is unverified; a new email address gets a code right away. */
export async function patchAlerts(env: Env, user: string, p: Patch) {
  const r = await row(env.DB, user);
  let codeTo: string | null = null;
  if (p.mode) r.mode = p.mode;
  if (p.quietHours !== undefined) { r.quiet_start = p.quietHours?.start ?? null; r.quiet_end = p.quietHours?.end ?? null; }
  if (p.email?.address !== undefined) {
    const address = p.email.address.trim().toLowerCase();
    if (address !== r.email) { r.email = address; r.email_verified = 0; codeTo = address; }
  }
  if (p.email?.enabled !== undefined) r.email_enabled = p.email.enabled ? 1 : 0;
  if (p.sms?.number !== undefined) {
    const number = normalizePhone(p.sms.number);
    if (number !== r.phone) { r.phone = number; r.phone_verified = 0; }
  }
  if (p.sms?.enabled !== undefined) r.sms_enabled = p.sms.enabled ? 1 : 0;
  await store(env.DB, user, r);
  const sent = codeTo ? await sendCode(env, user, 'email').catch((e) => (e instanceof AlertError ? null : Promise.reject(e))) : null;
  return { alerts: shape(r), codeSent: sent };
}

async function hash(env: Env, s: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function rateLimit(db: D1Database, user: string, kind: 'code' | 'test', channel: Channel) {
  const recent = await db.prepare('SELECT count(*) n, max(at) last FROM alert_log WHERE user=? AND kind=? AND channel=? AND at>?')
    .bind(user, kind, channel, now() - 3600).first<{ n: number; last: number | null }>();
  if (recent?.last && now() - recent.last < RESEND_GAP) throw new AlertError(429, `Wait ${RESEND_GAP - (now() - recent.last)} seconds before asking again.`);
  if ((recent?.n ?? 0) >= SENDS_PER_HOUR) throw new AlertError(429, 'Too many sends this hour. Try again later.');
}

/** Send a fresh 6-digit code to the saved address. Returns where it went and when it expires. */
export async function sendCode(env: Env, user: string, channel: Channel) {
  if (channel === 'sms' && !SMS_AVAILABLE) throw new AlertError(501, "Texts aren't available yet. Email alerts work now.");
  const r = await row(env.DB, user);
  const dest = channel === 'email' ? r.email : r.phone;
  if (!dest) throw new AlertError(400, channel === 'email' ? 'Add an email address first.' : 'Add a phone number first.');
  if (channel === 'email' ? r.email_verified : r.phone_verified) throw new AlertError(400, 'That address is already verified.');
  await rateLimit(env.DB, user, 'code', channel);
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
  const expires = now() + CODE_TTL;
  await env.DB.prepare('INSERT OR REPLACE INTO alert_codes (user, channel, dest, code_hash, expires, attempts) VALUES (?,?,?,?,?,0)')
    .bind(user, channel, dest, await hash(env, `${user}:${channel}:${dest}:${code}`), expires).run();
  const res = await sendEmail(env, dest, codeEmail(code));
  await env.DB.prepare('INSERT INTO alert_log (user, channel, kind, dest, message_id, error, at) VALUES (?,?,?,?,?,?,?)')
    .bind(user, channel, 'code', dest, res.messageId, res.error ?? null, now()).run();
  if (res.error) throw new Error(`Couldn't send the code: ${res.error}`);
  // local dev only: evals read the code from here instead of an inbox
  if (env.FRED_DEV === '1') await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)").bind(`dev:code:${user}:${channel}`, code).run();
  return { sentTo: mask(channel, dest), expiresAt: new Date(expires * 1000).toISOString() };
}

/** Check a code. On success the address is verified and alerts there are switched on. */
export async function verifyCode(env: Env, user: string, channel: Channel, code: string) {
  const c = await env.DB.prepare('SELECT * FROM alert_codes WHERE user=? AND channel=?').bind(user, channel)
    .first<{ dest: string; code_hash: string; expires: number; attempts: number }>();
  if (!c) throw new AlertError(400, 'No code was sent. Ask for a new one.');
  if (c.expires < now()) throw new AlertError(400, 'That code has expired. Ask for a new one.');
  if (c.attempts >= MAX_TRIES) throw new AlertError(429, 'Too many wrong codes. Ask for a new one.');
  const r = await row(env.DB, user);
  const current = channel === 'email' ? r.email : r.phone;
  if (current !== c.dest) throw new AlertError(400, 'The address changed since that code was sent. Ask for a new one.');
  if (await hash(env, `${user}:${channel}:${c.dest}:${code}`) !== c.code_hash) {
    await env.DB.prepare('UPDATE alert_codes SET attempts=attempts+1 WHERE user=? AND channel=?').bind(user, channel).run();
    throw new AlertError(400, `That code isn't right. ${MAX_TRIES - c.attempts - 1} tries left.`);
  }
  if (channel === 'email') { r.email_verified = 1; r.email_enabled = 1; } else { r.phone_verified = 1; r.sms_enabled = 1; }
  await store(env.DB, user, r);
  await env.DB.prepare('DELETE FROM alert_codes WHERE user=? AND channel=?').bind(user, channel).run();
  return shape(r);
}

/** Send an example alert with real places, so they can see what alerts look like. */
export async function sendTest(env: Env, user: string, channel: Channel, places: AlertPlace[], searchLine: string) {
  if (channel === 'sms' && !SMS_AVAILABLE) throw new AlertError(501, "Texts aren't available yet. Email alerts work now.");
  const r = await row(env.DB, user);
  const dest = channel === 'email' ? r.email : r.phone;
  if (!dest || !(channel === 'email' ? r.email_verified : r.phone_verified)) throw new AlertError(400, 'Verify the address first.');
  await rateLimit(env.DB, user, 'test', channel);
  if (!places.length) throw new AlertError(400, 'There are no places in the inbox to show yet.');
  const res = await sendEmail(env, dest, alertEmail(places.slice(0, 3), { searchLine, example: true }));
  await env.DB.prepare('INSERT INTO alert_log (user, channel, kind, dest, message_id, error, at) VALUES (?,?,?,?,?,?,?)')
    .bind(user, channel, 'test', dest, res.messageId, res.error ?? null, now()).run();
  if (res.error) throw new Error(`Couldn't send the example: ${res.error}`);
  return { sentTo: mask(channel, dest) };
}

/** The best few new places in someone's inbox, shaped for an alert email. */
export async function examplePlaces(db: D1Database, cards: Awaited<ReturnType<typeof inbox>>): Promise<AlertPlace[]> {
  const top = cards.filter((x) => x.status === 'new').sort((a, b) => b.fit - a.fit).slice(0, 3);
  return Promise.all(top.map(async (card) => {
    const d = await detail(db, card);
    return { id: card.id, price: card.price, area: card.area, address: [d?.address, d?.unit && `#${d.unit}`].filter(Boolean).join(' ') || card.area,
      beds: card.beds, baths: card.baths, buildingScore: d?.building?.score ?? null, verdict: card.verdict.label,
      why: card.highlight ?? card.verdict.reason, photo: card.thumbnail ?? d?.photos[0] ?? null, url: d?.sources[0]?.url ?? null };
  }));
}
