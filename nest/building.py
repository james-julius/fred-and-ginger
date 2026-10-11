"""What the city knows about a building, from NYC Open Data (Socrata, no key needed;
set socrata_app_token for higher rate limits).

  HPD violations      wvxf-dwi5   open problems the city has cited (class C = immediately hazardous)
  HPD complaints      ygpa-z7cr   tenant complaints by category (heat, pests, leaks, ...)
  311 requests        erm2-nwe9   noise, heat, rodents, illegal construction reported at the address
  Bedbug filings      wz6d-d3jb   landlords' annual bedbug reports
  Evictions           6z8x-wfk4   marshal-executed evictions
  DOB permits         ipu4-2q9a   construction at the building (scaffolding, gut renos, demolition)
  HPD registrations   tesw-yqqr + feu5-w2e2   owner and managing agent

report(bbl, bin) -> {"score": 0-100, "flags": [...], "good": [...], "facts": {...}}
"""
from __future__ import annotations

import datetime as dt, json, urllib.parse, urllib.request
from collections import Counter

from .config import CFG, UA

SODA = "https://data.cityofnewyork.us/resource/{}.json"


def _q(dataset: str, where: str, select: str | None = None, group: str | None = None,
       order: str | None = None, limit: int = 5000) -> list[dict]:
    p = {"$where": where, "$limit": limit}
    if select: p["$select"] = select
    if group: p["$group"] = group
    if order: p["$order"] = order
    h = {"User-Agent": UA}
    if CFG.get("socrata_app_token"):
        h["X-App-Token"] = CFG["socrata_app_token"]
    url = SODA.format(dataset) + "?" + urllib.parse.urlencode(p)
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=40) as r:
        return json.load(r)


def _ago(days: int) -> str:
    return (dt.date.today() - dt.timedelta(days=days)).isoformat() + "T00:00:00"


PESTS = ("PESTS", "MICE", "ROACH", "RAT", "BED BUG", "BEDBUG", "VERMIN", "RODENT")


def facts(bbl: str, bin_: str | None = None) -> dict:
    bbl = str(bbl)
    boro, block, lot = bbl[0], str(int(bbl[1:6])), str(int(bbl[6:10]))
    f: dict = {"bbl": bbl, "bin": bin_}

    v = _q("wvxf-dwi5", f"bbl='{bbl}' AND violationstatus='Open'", select="class, novdescription, inspectiondate",
           order="inspectiondate DESC")
    f["open_violations"] = dict(Counter(x.get("class") for x in v))
    f["open_violation_examples"] = [x.get("novdescription", "")[:140] for x in v if x.get("class") == "C"][:5]
    v3 = _q("wvxf-dwi5", f"bbl='{bbl}' AND inspectiondate > '{_ago(3 * 365)}'", select="class, count(*) AS n", group="class")
    f["violations_3y"] = {x["class"]: int(x["n"]) for x in v3}

    c = _q("ygpa-z7cr", f"bbl='{bbl}' AND received_date > '{_ago(365)}'",
           select="major_category, minor_category, count(*) AS n", group="major_category, minor_category")
    hc: dict = {}
    for x in c:      # "UNSANITARY CONDITION / PESTS": the minor category is where pests live
        k = " / ".join(y for y in (x.get("major_category"), x.get("minor_category")) if y)
        if k:
            hc[k] = hc.get(k, 0) + int(x["n"])
    f["hpd_complaints_12m"] = hc

    s = _q("erm2-nwe9", f"bbl='{bbl}' AND created_date > '{_ago(365)}'", select="complaint_type, count(*) AS n",
           group="complaint_type", order="n DESC", limit=30)
    f["calls_311_12m"] = {x["complaint_type"]: int(x["n"]) for x in s}

    b = _q("wz6d-d3jb", f"bbl='{bbl}'", order="filing_date DESC", limit=1)
    if b:
        f["units"] = int(float(b[0].get("of_dwelling_units") or 0)) or None
        f["bedbugs_last_filing"] = {"date": (b[0].get("filing_date") or "")[:10],
                                    "infested_units": int(float(b[0].get("infested_dwelling_unit_count") or 0)),
                                    "reinfested_units": int(float(b[0].get("re_infested_dwelling_unit") or 0))}

    e = _q("6z8x-wfk4", f"bbl='{bbl}' AND executed_date > '{_ago(3 * 365)}' AND residential_commercial_ind='Residential'",
           select="count(*) AS n")
    f["evictions_3y"] = int(e[0]["n"]) if e else 0

    if bin_:
        p = _q("ipu4-2q9a", f"bin__='{bin_}' AND issuance_date > '{(dt.date.today() - dt.timedelta(days=365)).strftime('%m/%d/%Y')}'",
               select="job_type, work_type, permit_type, issuance_date, expiration_date", limit=200)
        # issuance_date is text in this dataset; filter again in python to be safe
        recent = []
        for x in p:
            try:
                d = dt.datetime.strptime(x.get("issuance_date", "")[:10], "%m/%d/%Y").date()
            except ValueError:
                continue
            if (dt.date.today() - d).days <= 365:
                recent.append(x)
        f["permits_12m"] = dict(Counter(x.get("job_type") for x in recent))

    reg = _q("tesw-yqqr", f"boroid='{boro}' AND block='{block}' AND lot='{lot}'", order="lastregistrationdate DESC", limit=1)
    if reg:
        con = _q("feu5-w2e2", f"registrationid='{reg[0]['registrationid']}'")
        who = {}
        for x in con:
            name = x.get("corporationname") or ""
            if name and x.get("type") in ("CorporateOwner", "Agent", "IndividualOwner", "HeadOfficer"):
                who.setdefault(x["type"], name)
        f["owner"] = who.get("CorporateOwner") or who.get("IndividualOwner") or who.get("HeadOfficer")
        f["managing_agent"] = who.get("Agent")
        f["hpd_registered"] = reg[0].get("lastregistrationdate", "")[:10]
    return f


def score(f: dict) -> dict:
    """0-100 with the reasons. Counts are scaled by building size: 5 open hazards
    in a 200-unit tower isn't 5 in a 6-unit walk-up."""
    units = f.get("units") or 8
    size = max(1.0, units / 10)
    flags, good, pts = [], [], 100.0

    def hit(n, per, cap, msg):
        nonlocal pts
        if n <= 0:
            return
        d = min(cap, n / size * per)
        pts -= d
        flags.append((round(d, 1), msg))

    ov = f.get("open_violations", {})
    hit(ov.get("C", 0), 4, 30, f"{ov.get('C', 0)} open class C (immediately hazardous) violations")
    hit(ov.get("B", 0), 1, 15, f"{ov.get('B', 0)} open class B (hazardous) violations")
    hc = f.get("hpd_complaints_12m", {})
    heat = sum(n for k, n in hc.items() if "HEAT" in k.upper())
    pests = sum(n for k, n in hc.items() if any(p in k.upper() for p in PESTS))
    leaks = sum(n for k, n in hc.items() if any(p in k.upper() for p in ("WATER LEAK", "PLUMBING", "MOLD")))
    hit(heat, 3, 20, f"{heat} heat / hot water complaints in the last year")
    hit(pests, 3, 15, f"{pests} pest complaints in the last year")
    hit(leaks, 1.5, 10, f"{leaks} leak / plumbing / mould complaints in the last year")
    s = f.get("calls_311_12m", {})
    noise = sum(n for k, n in s.items() if "NOISE" in k.upper())
    hit(noise, 0.7, 10, f"{noise} noise complaints to 311 in the last year")
    bb = f.get("bedbugs_last_filing") or {}
    if bb.get("infested_units"):
        pts -= 10; flags.append((10, f"bedbugs in {bb['infested_units']} unit(s) at the {bb['date']} filing"))
    hit(f.get("evictions_3y", 0), 3, 15, f"{f.get('evictions_3y', 0)} evictions in 3 years")
    pm = f.get("permits_12m", {})
    if pm.get("NB") or pm.get("DM") or pm.get("A1"):
        pts -= 5; flags.append((5, "major construction permitted in the last year (expect scaffolding / noise)"))

    if not ov.get("C") and not ov.get("B"):
        good.append("no open serious violations")
    if not heat:
        good.append("no heat complaints in the last year")
    if not pests and not bb.get("infested_units"):
        good.append("no pest or bedbug reports")
    if f.get("managing_agent"):
        good.append(f"managed by {f['managing_agent']}")
    flags.sort(key=lambda x: -x[0])
    return {"score": max(0, round(pts)), "flags": [m for _, m in flags], "good": good}


def report(bbl: str, bin_: str | None = None) -> dict:
    f = facts(bbl, bin_)
    return {**score(f), "facts": f, "checked": dt.date.today().isoformat()}
