"""python -m nest building "170 N 10th St, Brooklyn"     what the city knows about it
python -m nest ingest [--eml DIR]                      read new alert emails (IMAP, or saved .eml files)
python -m nest list [--all]                            listings, best first
"""
from __future__ import annotations

import argparse, json, sys

from . import alerts, building, db, geo, listings


def cmd_building(a):
    loc = geo.locate(a.address)
    if not loc:
        sys.exit(f"couldn't find {a.address!r} in NYC")
    con = db.connect()
    rep = None if a.fresh else db.cached_building(con, loc["bbl"])
    if not rep:
        rep = building.report(loc["bbl"], loc.get("bin"))
        db.save_building(con, loc["bbl"], rep)
    if a.json:
        print(json.dumps({"location": loc, **rep}, indent=2)); return
    f = rep["facts"]
    print(f"{loc['label']}  ·  {loc.get('neighbourhood') or ''}  ·  BBL {loc['bbl']}")
    print(f"building score {rep['score']}/100" + (f"  ·  {f['units']} units" if f.get("units") else ""))
    for m in rep["flags"]:
        print(f"  ✗ {m}")
    for m in rep["good"]:
        print(f"  ✓ {m}")
    if f.get("owner"):
        print(f"  owner: {f['owner']}")
    for x in f.get("open_violation_examples") or []:
        print(f"    · {x}")


def cmd_ingest(a):
    con = db.connect()
    seen = {r[0] for r in con.execute("SELECT msgid FROM emails")}
    mails = alerts.from_files(a.eml) if a.eml else alerts.from_imap(seen)
    total = fresh = 0
    for m in mails:
        if m["msgid"] in seen:
            continue
        for item in m["listings"]:
            _, new = listings.add(con, item)
            total += 1; fresh += new
        con.execute("INSERT OR IGNORE INTO emails VALUES (?,?,?,?,?)",
                    (m["msgid"], m["source"], m["subject"], int(__import__("time").time()), len(m["listings"])))
        con.commit()
        print(f"{m['source']:>12}  {len(m['listings']):>3} listings  {m['subject'][:70]}")
    print(f"{len(mails)} emails, {total} listings, {fresh} new")


def cmd_list(a):
    con = db.connect()
    for d in listings.ranked(con, a.all):
        beds = "studio" if d["beds"] == 0 else (f"{d['beds']:g} bd" if d["beds"] is not None else "? bd")
        bs = f"bldg {d['building_score']}" if d["building_score"] is not None else "bldg ?"
        fee = " no fee" if d["no_fee"] else ""
        print(f"${d['price'] or 0:>6,}  {beds:<7} {bs:<9} {(d['address'] or '')[:46]:<46} {d['neighbourhood'] or ''}{fee}")
        for f in d["flags"]:
            print(f"{'':>27}✗ {f}")
        print(f"{'':>27}" + "  ".join(f"{s['source']}: {s['url']}" for s in d["sources"]))


def main(argv=None):
    ap = argparse.ArgumentParser(prog="nest")
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("building", help="Open Data report for an address")
    b.add_argument("address"); b.add_argument("--json", action="store_true"); b.add_argument("--fresh", action="store_true")
    b.set_defaults(fn=cmd_building)
    i = sub.add_parser("ingest", help="read new listing alert emails")
    i.add_argument("--eml", help="a folder of .eml files instead of IMAP"); i.set_defaults(fn=cmd_ingest)
    l = sub.add_parser("list", help="listings, best building first")
    l.add_argument("--all", action="store_true"); l.set_defaults(fn=cmd_list)
    a = ap.parse_args(argv)
    a.fn(a)


if __name__ == "__main__":
    main()
