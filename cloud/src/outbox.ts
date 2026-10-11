// Messages Fred sends to leasing offices and agents for someone. Fred drafts; the person approves.
// A draft can be sent only from a later chat turn than the one that wrote it (the person has seen
// it and said yes) or from the app's Send button. Replies go straight to the person: Reply-To is
// their verified email, so Fred never sits in the middle of the conversation (yet).
import { AlertError, getAlerts } from './alerts';
import { contactFor } from './contacts';
import { sendEmail, type Email } from './email';

type Env = { DB: D1Database; EMAIL?: SendEmail; FRED_DEV?: string };
export type OutboxRow = {
  id: string; user: string; listing_id: number; to_email: string; to_name: string | null; contact_source: string;
  subject: string; body: string; reply_to: string; status: 'draft' | 'sent' | 'failed' | 'cancelled';
  created: number; created_turn: string | null; sent_at: number | null; message_id: string | null; error: string | null;
};

const PER_DAY = 10, PER_LISTING_HOURS = 24;
const now = () => Math.floor(Date.now() / 1000);

export const shape = (r: OutboxRow) => ({
  id: r.id, placeId: `op_${r.listing_id}`, to: { email: r.to_email, name: r.to_name }, subject: r.subject, body: r.body,
  replyTo: r.reply_to, status: r.status, createdAt: new Date(r.created * 1000).toISOString(),
  sentAt: r.sent_at ? new Date(r.sent_at * 1000).toISOString() : null, error: r.error,
});

/** Draft a message about a listing. Fails clearly when there's no email for it or the person has no verified email. */
export async function draft(env: Env, user: string, o: { listingId: number; subject: string; body: string; turn: string | null }) {
  const contact = await contactFor(env.DB, o.listingId);
  if (!contact) throw new AlertError(400, "There's no email address for this listing. Only Compass agents and some landlord leasing offices publish one.");
  const alerts = await getAlerts(env.DB, user);
  if (!alerts.email.address || !alerts.email.verified) throw new AlertError(400, 'Verify your email first: replies from the landlord go straight to you.');
  const id = `msg_${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare(`INSERT INTO outbox (id, user, listing_id, to_email, to_name, contact_source, subject, body, reply_to, status, created, created_turn)
                        VALUES (?,?,?,?,?,?,?,?,?,'draft',?,?)`)
    .bind(id, user, o.listingId, contact.email, contact.name, contact.source, o.subject.trim(), o.body.trim(), alerts.email.address, now(), o.turn).run();
  return shape((await get(env.DB, user, id))!);
}

export async function get(db: D1Database, user: string, id: string) {
  return db.prepare('SELECT * FROM outbox WHERE user=? AND id=?').bind(user, id).first<OutboxRow>();
}

export async function list(db: D1Database, user: string, limit = 50) {
  return (await db.prepare('SELECT * FROM outbox WHERE user=? ORDER BY created DESC LIMIT ?').bind(user, limit).all<OutboxRow>()).results.map(shape);
}

export async function cancel(db: D1Database, user: string, id: string) {
  const r = await get(db, user, id);
  if (!r) throw new AlertError(400, 'No such message.');
  if (r.status !== 'draft') throw new AlertError(400, `That message is already ${r.status}.`);
  await db.prepare("UPDATE outbox SET status='cancelled' WHERE user=? AND id=?").bind(user, id).run();
  return shape({ ...r, status: 'cancelled' });
}

/** The email the landlord receives: Fred's text, signed for the person, Reply-To them. */
function letter(r: OutboxRow, senderName: string): Email {
  const footer = `Sent by Fred, ${senderName}'s apartment-hunting assistant. Reply to this email to reach ${senderName} directly.`;
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  return {
    subject: r.subject,
    text: `${r.body}\n\n--\n${footer}`,
    html: `<div style="font:15px/1.55 -apple-system,Helvetica,Arial,sans-serif;color:#141413;max-width:560px">${esc(r.body).replace(/\n/g, '<br>')}`
      + `<p style="margin-top:24px;padding-top:12px;border-top:1px solid #e7e6e1;font-size:12px;color:#6b6a64">${esc(footer)}</p></div>`,
  };
}

/**
 * Send an approved draft. `turn` is the chat turn asking to send, or null for the app's Send
 * button; a draft can't be sent from the turn that wrote it, so the person always sees it first.
 */
export async function send(env: Env, user: string, id: string, o: { turn: string | null; senderName: string }) {
  const r = await get(env.DB, user, id);
  if (!r) throw new AlertError(400, 'No such message.');
  if (r.status !== 'draft') throw new AlertError(400, `That message is already ${r.status}.`);
  if (o.turn && r.created_turn === o.turn) throw new AlertError(400, 'Show the draft to them first; send it only after they say yes in their next message.');
  const today = await env.DB.prepare("SELECT count(*) n FROM outbox WHERE user=? AND status='sent' AND sent_at>?").bind(user, now() - 86400).first<{ n: number }>();
  if ((today?.n ?? 0) >= PER_DAY) throw new AlertError(429, `That's ${PER_DAY} messages today, the daily limit. Try again tomorrow.`);
  const recent = await env.DB.prepare("SELECT count(*) n FROM outbox WHERE user=? AND listing_id=? AND status='sent' AND sent_at>?").bind(user, r.listing_id, now() - PER_LISTING_HOURS * 3600).first<{ n: number }>();
  if ((recent?.n ?? 0) > 0) throw new AlertError(429, 'You already messaged them about this place in the last day. Give them time to reply.');
  // claim it first, so a double click or a retry can't send it twice
  const claim = await env.DB.prepare("UPDATE outbox SET status='sent', sent_at=? WHERE user=? AND id=? AND status='draft'").bind(now(), user, id).run();
  if (!claim.meta.changes) throw new AlertError(400, 'That message was just sent or cancelled.');
  const res = await sendEmail(env, r.to_email, letter(r, o.senderName), { replyTo: r.reply_to, fromName: `Fred, for ${o.senderName}` });
  if (res.error) {
    await env.DB.prepare("UPDATE outbox SET status='failed', error=? WHERE user=? AND id=?").bind(res.error, user, id).run();
    return shape({ ...r, status: 'failed', error: res.error });
  }
  await env.DB.prepare('UPDATE outbox SET message_id=? WHERE user=? AND id=?').bind(res.messageId, user, id).run();
  return shape((await get(env.DB, user, id))!);
}

