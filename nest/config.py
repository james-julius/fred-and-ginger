"""Settings from config.json (gitignored; copy config.example.json). Data lives in ./data."""
from __future__ import annotations

import json, os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get("NEST_DATA") or ROOT / "data")
DATA.mkdir(parents=True, exist_ok=True)

_f = Path(os.environ.get("NEST_CONFIG") or ROOT / "config.json")
CFG: dict = json.loads(_f.read_text()) if _f.exists() else \
    json.loads((ROOT / "config.example.json").read_text())
UA = "nest (personal apartment search)"
