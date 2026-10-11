-- one row per apartment, however many sites list it
CREATE TABLE listings (
  id INTEGER PRIMARY KEY,
  key TEXT UNIQUE,                 -- normalised street + unit (later: bbl + unit)
  street TEXT, unit TEXT, neighbourhood TEXT, borough TEXT, zip TEXT,
  lat REAL, lon REAL,
  price INTEGER, net_effective INTEGER, beds REAL, baths REAL, sqft INTEGER,
  no_fee INTEGER, available TEXT, photos TEXT, agency TEXT, open_house TEXT,
  bbl TEXT, bin TEXT,
  geo_state TEXT DEFAULT 'pending',   -- pending / done / failed
  first_seen INTEGER, last_seen INTEGER, price_history TEXT DEFAULT '[]',
  status TEXT DEFAULT 'active'        -- active / gone
);
CREATE INDEX listings_seen ON listings (last_seen);
CREATE INDEX listings_bbl ON listings (bbl);
CREATE TABLE sightings (
  source TEXT, source_id TEXT, listing_id INTEGER, url TEXT, price INTEGER,
  first_seen INTEGER, last_seen INTEGER, raw TEXT,
  PRIMARY KEY (source, source_id)
);
CREATE INDEX sightings_listing ON sightings (listing_id);
CREATE TABLE buildings (bbl TEXT PRIMARY KEY, score INTEGER, report TEXT, fetched INTEGER);
CREATE TABLE votes (
  listing_id INTEGER, user TEXT, vote INTEGER,   -- 1 like, -1 pass, 0 cleared
  note TEXT, updated INTEGER, PRIMARY KEY (listing_id, user)
);
CREATE TABLE searches (id INTEGER PRIMARY KEY, name TEXT, criteria TEXT, enabled INTEGER DEFAULT 1, updated INTEGER);
CREATE TABLE runs (
  id TEXT PRIMARY KEY, source TEXT, status TEXT, started INTEGER, finished INTEGER,
  items INTEGER, added INTEGER, cost REAL, error TEXT
);
CREATE TABLE login_fail (ip TEXT, at INTEGER);
