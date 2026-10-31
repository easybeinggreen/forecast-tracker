"""Sportsbet seat odds: snapshots -> site/data/sportsbet.json

Snapshots live in data/raw/sportsbet/<date>.json (one per refresh, taken on request).
  python -m vic2026.build.sportsbet --add <text-file> [date]   parse "Seat: Party 2.25, Party 3.50, ..." lines into a snapshot
  python -m vic2026.build.sportsbet                              rebuild site/data/sportsbet.json
For each seat: every snapshot's odds, plus for the latest the implied chance (1/odds), the margin, and the
fair chance (implied divided by the book total).
"""
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data/raw/sportsbet"
URL = "https://www.sportsbet.com.au/betting/politics/vic-politics/victorian-state-election-seat-betting-10944986"
CODE = {"labor": "ALP", "liberal": "LIB", "liberals": "LIB", "nationals": "NAT", "national": "NAT", "greens": "GRN",
        "one nation": "ON", "any other": "OTH", "independent": "IND"}


def add(textfile, stamp=None):
    seats = {s["name"].lower(): s["slug"] for s in json.loads((ROOT / "site/data/forecast.json").read_text())["seats"]}
    out, names = {}, {}
    for line in Path(textfile).read_text(encoding="utf-8").splitlines():
        m = re.match(r"\s*(?:\d+\.\s*)?([A-Za-z' -]+?):\s*(.+)$", line)
        if not m or m.group(1).strip().lower() not in seats:
            continue
        slug, odds = seats[m.group(1).strip().lower()], {}
        for part in m.group(2).split(","):
            pm = re.match(r"\s*(.+?)\s*\$?([\d.]+)\s*$", part)
            if not pm:
                continue
            label = pm.group(1).strip()
            ind = re.match(r"independent\s*\((.+)\)", label, re.I)
            key = "IND" if ind else CODE.get(label.lower(), "OTH")
            if ind:
                names.setdefault(slug, {})["IND"] = ind.group(1)
            odds[key] = float(pm.group(2))
        out[slug] = odds
    stamp = stamp or datetime.now(timezone.utc).isoformat(timespec="minutes")
    datetime.fromisoformat(stamp)  # must be a full ISO time, e.g. 2026-10-31T02:50+00:00 (the dashboard parses it)
    RAW.mkdir(parents=True, exist_ok=True)
    (RAW / f"{stamp[:16].replace(':', '')}.json").write_text(json.dumps({"source": "Sportsbet", "as_of": stamp, "url": URL, "seats": out, "names": names}, indent=1))
    print(len(out), "seats in snapshot", stamp)


def build():
    snaps = []
    for f in sorted(RAW.glob("*.json")):
        d = json.loads(f.read_text())
        snaps.append((d["as_of"], d["seats"], d.get("names", {})))
    seats = {}
    for when, ss, names in snaps:
        for slug, odds in ss.items():
            s = seats.setdefault(slug, {"history": [], "names": {}})
            s["history"].append({"t": when, "odds": odds})
            s["names"].update(names.get(slug, {}))
    for slug, s in seats.items():
        odds = s["history"][-1]["odds"]
        book = sum(1 / v for v in odds.values())
        s["latest"] = {"as_of": s["history"][-1]["t"], "odds": odds, "margin": round(book - 1, 4),
                       "implied": {k: round(1 / v, 4) for k, v in odds.items()},
                       "fair": {k: round(1 / v / book, 4) for k, v in odds.items()}}
    (ROOT / "site/data/sportsbet.json").write_text(json.dumps({"url": URL, "snapshots": [w for w, _, _ in snaps], "seats": seats}, separators=(",", ":")))
    print(len(seats), "seats,", len(snaps), "snapshots")


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--add":
        add(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
    build()
