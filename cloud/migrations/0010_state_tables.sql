-- Each person's state in rows instead of one JSON blob (meta mock:<user>), so a change writes only
-- what it touched and two writers no longer overwrite each other. src/store.ts reads and writes
-- these; the blob is copied in on first load and left as a backup.

-- one row per person: profile, alerts, and any state fields added later, as JSON
CREATE TABLE people (user TEXT PRIMARY KEY, profile TEXT, alerts TEXT, extra TEXT, migrated_at INTEGER);

-- the saved search; rev goes up on every write, so a stale write can be caught and merged
CREATE TABLE saved_searches (user TEXT PRIMARY KEY, search TEXT NOT NULL, rev INTEGER NOT NULL DEFAULT 1);

-- a place's state for one person, and Fred's card when he added it
CREATE TABLE places (
  user TEXT NOT NULL, id TEXT NOT NULL,
  state TEXT,              -- { seen, status, note, savedAt }
  card TEXT,               -- the card Fred created, or null
  added_at INTEGER,        -- when Fred added it (ms); newest first
  PRIMARY KEY (user, id)
);

CREATE TABLE threads (user TEXT NOT NULL, id TEXT NOT NULL, title TEXT, updated_at TEXT, PRIMARY KEY (user, id));
CREATE TABLE messages (user TEXT NOT NULL, thread TEXT NOT NULL, idx INTEGER NOT NULL, message TEXT NOT NULL, PRIMARY KEY (user, thread, idx));

CREATE TABLE tours (user TEXT NOT NULL, id TEXT NOT NULL, tour TEXT NOT NULL, pos INTEGER NOT NULL, PRIMARY KEY (user, id));

-- newest first, by the note's own updatedAt
CREATE TABLE memories (user TEXT NOT NULL, id TEXT NOT NULL, note TEXT NOT NULL, PRIMARY KEY (user, id));
