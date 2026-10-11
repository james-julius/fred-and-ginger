"""One SQLite file: listings (deduped by address + unit), buildings (Open Data
reports, cached), and which alert emails have been read."""
from __future__ import annotations

import json, sqlite3, time

from .config import DATA

DB = DATA / "nest.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY,
  key TEXT UNIQUE,              -- normalised address + unit, or the url when there's no address
  address TEXT, unit TEXT, neighbourhood TEXT,
  price INTEGER, beds REAL, baths REAL, sqft INTEGER, no_fee INTEGER,
  photo TEXT, bbl TEXT, bin TEXT, lat REAL, lon REAL,
  first_seen INTEGER, last_seen INTEGER, status TEXT DEFAULT 'new'   -- new / shortlisted / passed / gone
);
CREATE TABLE IF NOT EXISTS sightings (   -- every place a listing showed up
  listing_id INTEGER, source TEXT, url TEXT, price INTEGER, seen INTEGER,
  UNIQUE (listing_id, url)
);
CREATE TABLE IF NOT EXISTS buildings (bbl TEXT PRIMARY KEY, report TEXT, fetched INTEGER);
CREATE TABLE IF NOT EXISTS emails (msgid TEXT PRIMARY KEY, source TEXT, subject TEXT, read_at INTEGER, found INTEGER);
"""


def connect() -> sqlite3.Connection:
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    return con


def cached_building(con, bbl: str, max_age: float = 7 * 86400) -> dict | None:
    r = con.execute("SELECT report, fetched FROM buildings WHERE bbl=?", (bbl,)).fetchone()
    return json.loads(r["report"]) if r and time.time() - r["fetched"] < max_age else None


def save_building(con, bbl: str, report: dict):
    con.execute("INSERT OR REPLACE INTO buildings VALUES (?,?,?)", (bbl, json.dumps(report), int(time.time())))
    con.commit()
