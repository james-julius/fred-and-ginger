"""Address -> BBL / BIN / lat-lon via NYC Planning's GeoSearch (free, no key)."""
from __future__ import annotations

import json, re, urllib.parse, urllib.request

from .config import UA

GEOSEARCH = "https://geosearch.planninglabs.nyc/v2/search"


def clean(address: str) -> str:
    """Drop the unit ('#4B', 'Apt 4B', 'Unit 4B') — GeoSearch wants the building."""
    a = re.sub(r"\s*(#|\bapt\.?|\bunit|\bsuite)\s*[\w-]+", "", address, flags=re.I)
    return re.sub(r"\s+", " ", a).strip(" ,")


def unit_of(address: str) -> str:
    m = re.search(r"(?:#|\bapt\.?|\bunit)\s*([\w-]+)", address, re.I)
    return m.group(1).upper() if m else ""


def locate(address: str) -> dict | None:
    q = clean(address)
    if not re.search(r"\b(ny|new york|brooklyn|queens|bronx|manhattan|staten island)\b", q, re.I):
        q += ", New York, NY"
    url = GEOSEARCH + "?" + urllib.parse.urlencode({"text": q, "size": 1})
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=20) as r:
        feats = json.load(r).get("features") or []
    if not feats:
        return None
    p, (lon, lat) = feats[0]["properties"], feats[0]["geometry"]["coordinates"]
    pad = (p.get("addendum") or {}).get("pad") or {}
    if not pad.get("bbl") or p.get("confidence", 1) < 0.6:
        return None
    return {"label": p.get("label"), "bbl": pad["bbl"], "bin": pad.get("bin"), "lat": lat, "lon": lon,
            "neighbourhood": p.get("neighbourhood") or p.get("borough"), "borough": p.get("borough"),
            "confidence": p.get("confidence")}
