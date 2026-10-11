// "Try the demo": one click at /demo signs a visitor in as a fresh demo person (demo_xxxxxxxx), so
// judges and friends can use the real app, real listings and real Fred without anyone's password.
// Each visit gets its own person, so two people trying it at once don't collide. Nothing leaves
// the building for a demo person: landlord emails, alert emails and codes are simulated
// (src/outbox.ts, src/alerts.ts), and chat is capped per day so a demo can't run up the model bill.
import { applySearch, load, save, view } from './mock';

export const isDemo = (user: string) => /^demo_[a-z0-9]{8}$/.test(user);

/** The verification code a demo person types: nothing is emailed, so it's always this. */
export const DEMO_CODE = '123456';

export const DEMO_CHAT_TURNS_PER_DAY = 40;

/** A new demo person with an example search, so the inbox fills with real places straight away. */
export async function createDemo(db: D1Database) {
  const user = `demo_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
  const st = await load(db, user);
  st.profile = { name: 'Guest' };
  st.search = applySearch(view(st).search, {
    dealbreakers: { areas: ['williamsburg', 'greenpoint', 'east-village'], maxTotalMonthly: 4500, minBeds: 1, minBaths: null, pets: null, noBrokerFee: false, moveBy: null },
    preferences: [
      { id: 'p_demo1', label: 'Washer/dryer in unit', weight: 'important' },
      { id: 'p_demo2', label: 'Lots of natural light', weight: 'nice' },
    ],
  });
  await save(db, user, st);
  return user;
}

/** Counts a demo chat turn; false once the day's allowance is used. */
export async function demoTurnAllowed(db: D1Database, user: string) {
  const key = `demo:turns:${user}:${new Date().toISOString().slice(0, 10)}`;
  const r = await db.prepare('SELECT v FROM meta WHERE k=?').bind(key).first<{ v: string }>();
  const n = Number(r?.v ?? 0);
  if (n >= DEMO_CHAT_TURNS_PER_DAY) return false;
  await db.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').bind(key, String(n + 1)).run();
  return true;
}

/** What Fred is told each turn when he's talking to a demo person. */
export const DEMO_NOTE = "(This is a demo account: someone trying Fred out. Nothing is really sent. Landlord emails and alert emails are simulated, and the email verification code is always 123456. When it comes up, say so plainly.)";
