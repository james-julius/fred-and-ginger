-- Messages Fred writes to landlords and agents for someone (src/outbox.ts). Fred drafts; nothing
-- is sent until the person approves it in a later message or with the app's Send button.
CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  user TEXT NOT NULL,
  listing_id INTEGER NOT NULL,
  to_email TEXT NOT NULL, to_name TEXT,
  contact_source TEXT NOT NULL,                  -- where the address came from, e.g. landlord-building, compass-agent
  subject TEXT NOT NULL, body TEXT NOT NULL,
  reply_to TEXT NOT NULL,                        -- the person's verified email: replies go straight to them
  status TEXT NOT NULL DEFAULT 'draft',          -- draft | sent | failed | cancelled
  created INTEGER NOT NULL, created_turn TEXT,   -- the chat turn that drafted it; sending needs a later turn
  sent_at INTEGER, message_id TEXT, error TEXT
);
CREATE INDEX outbox_user ON outbox (user, created);
CREATE INDEX outbox_listing ON outbox (user, listing_id, status);
