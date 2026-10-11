"""Store what the alerts found: one row per apartment however many sites list it,
with the building's Open Data report attached."""
from __future__ import annotations

import re, time

from . import building, db, geo


def _key(loc: dict | None, unit: str, url: str) -> str:
    return f"{loc['bbl']}#{unit or '?'}" if loc else url


def add(con, item: dict) -> tuple[int, bool]:
    """-> (listing id, is_new). The same flat on StreetEasy and RentHop is one row, two sightings."""
    loc = None
    if item.get("address"):
        try:
            loc = geo.locate(item["address"])
        except Exception:
            loc = None
    unit = geo.unit_of(item.get("address") or "")
    key, now = _key(loc, unit, item["url"]), int(time.time())
    row = con.execute("SELECT id, price FROM listings WHERE key=?", (key,)).fetchone()
    if row:
        lid, new = row["id"], False
        con.execute("UPDATE listings SET last_seen=?, price=COALESCE(?, price), photo=COALESCE(photo, ?), "
                    "no_fee=MAX(no_fee, ?) WHERE id=?", (now, item.get("price"), item.get("photo"), int(item.get("no_fee", 0)), lid))
    else:
        cur = con.execute(
            "INSERT INTO listings (key, address, unit, neighbourhood, price, beds, baths, sqft, no_fee, photo, bbl, bin, "
            "lat, lon, first_seen, last_seen) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (key, (loc or {}).get("label") or item.get("address"), unit, (loc or {}).get("neighbourhood"),
             item.get("price"), item.get("beds"), item.get("baths"), item.get("sqft"), int(item.get("no_fee", 0)),
             item.get("photo"), (loc or {}).get("bbl"), (loc or {}).get("bin"), (loc or {}).get("lat"),
             (loc or {}).get("lon"), now, now))
        lid, new = cur.lastrowid, True
    con.execute("INSERT OR IGNORE INTO sightings VALUES (?,?,?,?,?)", (lid, item["source"], item["url"], item.get("price"), now))
    if loc and not db.cached_building(con, loc["bbl"]):
        try:
            db.save_building(con, loc["bbl"], building.report(loc["bbl"], loc.get("bin")))
        except Exception as e:
            print(f"  building check failed for {loc['label']}: {e}")
    con.commit()
    return lid, new


def ranked(con, include_passed: bool = False) -> list[dict]:
    rows = con.execute("SELECT l.*, b.report FROM listings l LEFT JOIN buildings b ON b.bbl = l.bbl "
                       + ("" if include_passed else "WHERE l.status NOT IN ('passed', 'gone') ") +
                       "ORDER BY l.first_seen DESC").fetchall()
    import json
    out = []
    for r in rows:
        d = dict(r)
        rep = json.loads(d.pop("report")) if d.get("report") else None
        d["building_score"] = rep["score"] if rep else None
        d["flags"] = rep["flags"][:3] if rep else []
        d["sources"] = [dict(s) for s in con.execute("SELECT source, url, price FROM sightings WHERE listing_id=?", (d["id"],))]
        out.append(d)
    out.sort(key=lambda d: -(d["building_score"] if d["building_score"] is not None else 50))
    return out
