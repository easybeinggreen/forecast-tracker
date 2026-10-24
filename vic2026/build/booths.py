"""Per-seat booth data for the seat drawer: site/data/booths/<slug>.json

  outline   the district boundary (lon/lat rings)
  vec2022   2022 state result at each voting centre: first preferences by candidate and the final-two count.
            Voting centres are placed using the AEC's coordinates for the polling place of the same name
            (the same schools and halls are mostly used for both); unmatched centres are kept without a location.
  fed2025   2025 federal result at each polling place inside the district: One Nation share, Labor two-party.
"""
import csv
import io
import json
import re
from collections import defaultdict
from pathlib import Path

import pandas as pd
from shapely.geometry import Point, shape

ROOT = Path(__file__).resolve().parents[2]
VEC = ROOT / "data/raw/vec2022"
AEC = ROOT / "data/raw/aec2025"
OUT = ROOT / "site/data/booths"
SKIP = re.compile(r"total|absent|early|postal|provisional|marked|percentage|mis-?sort|declaration", re.I)


def rows(p):
    with open(p, encoding="utf-8-sig") as fh:
        next(fh)
        yield from csv.DictReader(fh)


def norm(n):
    return re.sub(r"[^a-z0-9]+", " ", str(n).lower()).strip()


def surname_key(n):
    return norm(str(n).split(",")[0])


def parse_primary(path, cands):
    x = pd.read_excel(path, header=None)
    hdr = next(i for i in range(len(x)) if any(isinstance(v, str) and "\n" in v and "Total Votes" in v for v in x.iloc[i]))
    cols = {}
    by_sur = defaultdict(list)
    for c in cands:
        by_sur[surname_key(c["name"])].append(c)
    for j, v in enumerate(x.iloc[hdr]):
        if not isinstance(v, str):
            continue
        name = v.split("\n")[0].strip()
        if name.startswith("Informal"):
            cols["__inf"] = j
        elif name.startswith("Total"):
            cols["__tot"] = j
        else:
            m = [c for c in by_sur.get(surname_key(name), []) if norm(c["name"]) == norm(name)] or by_sur.get(surname_key(name), [])
            if m:
                cols[m[0]["name"]] = j
    out = []
    for i in range(hdr + 1, len(x)):
        n = x.iloc[i, 1]
        if not isinstance(n, str) or not n.strip():
            continue
        if SKIP.search(n):
            break
        out.append({"n": n.strip(), "v": [int(x.iloc[i, cols[c["name"]]]) if c["name"] in cols and pd.notna(x.iloc[i, cols[c["name"]]]) else 0 for c in cands],
                    "inf": int(x.iloc[i, cols["__inf"]]) if "__inf" in cols else 0})
    return out


def parse_tcp(path):
    t = pd.read_html(io.StringIO(path.read_text(encoding="utf-8")))[0]
    names = [str(t.iloc[0, 1]), str(t.iloc[0, 2])]
    res = {}
    for i in range(2, len(t)):
        n = t.iloc[i, 0]
        if not isinstance(n, str) or SKIP.search(n):
            continue
        try:
            res[n.strip()] = [int(t.iloc[i, 1]), int(t.iloc[i, 2])]
        except (TypeError, ValueError):
            pass
    return names, res


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    geo = {f["properties"]["slug"]: f for f in json.loads((ROOT / "data/geo/vic_districts_detail.geojson").read_text())["features"]}
    D = {d["slug"]: d for d in json.loads((ROOT / "data/vic2026/districts2022.json").read_text())}

    places = defaultdict(list)
    for r in rows(AEC / "GeneralPollingPlacesDownload-31496.csv"):
        if r["State"] == "VIC" and r["Latitude"] and r["Longitude"]:
            places[norm(r["PollingPlaceNm"])].append((float(r["Longitude"]), float(r["Latitude"])))
    loc = {r["PollingPlaceID"]: (float(r["Longitude"]), float(r["Latitude"]), r["PollingPlaceNm"])
           for r in rows(AEC / "GeneralPollingPlacesDownload-31496.csv") if r["State"] == "VIC" and r["Latitude"]}
    fp = defaultdict(lambda: {"on": 0, "f": 0})
    for r in rows(AEC / "HouseStateFirstPrefsByPollingPlaceDownload-31496-VIC.csv"):
        if r["Surname"] == "Informal":
            continue
        k = r["PollingPlaceID"]; v = int(r["OrdinaryVotes"] or 0)
        fp[k]["f"] += v
        if r["PartyAb"] == "ON":
            fp[k]["on"] += v
    tpp = {r["PollingPlaceID"]: (int(r["Australian Labor Party Votes"]), int(r["TotalVotes"]))
           for r in rows(AEC / "HouseTppByPollingPlaceDownload-31496.csv") if r["StateAb"] == "VIC"}

    stats = {"placed": 0, "booths": 0}
    for slug, f in geo.items():
        poly = shape(f["geometry"])
        near = poly.buffer(0.02)
        d = D.get(slug)
        out = {"slug": slug, "outline": f["geometry"]}
        sd = VEC / slug
        if d and (sd / "booths.xls").exists():
            cands = [{"name": c["name"], "party": c["party"]} for c in d["candidates"]]
            prim = parse_primary(sd / "booths.xls", cands)
            tcp_names, tcp = parse_tcp(sd / "booths_2cp.html") if (sd / "booths_2cp.html").exists() else ([], {})
            for b in prim:
                pts = [p for p in places.get(norm(b["n"]), []) if near.contains(Point(p))]
                if pts:
                    b["x"], b["y"] = round(pts[0][0], 5), round(pts[0][1], 5); stats["placed"] += 1
                b["tcp"] = tcp.get(b["n"])
                stats["booths"] += 1
            tcp_order = []
            for n in tcp_names:
                m = [c["name"] for c in cands if surname_key(c["name"]) == surname_key(n)]
                tcp_order.append(m[0] if m else n)
            out["vec2022"] = {"cands": cands, "tcp": tcp_order, "booths": prim}
        fb = []
        for pid, (x, y, nm) in loc.items():
            if pid in fp and fp[pid]["f"] >= 50 and poly.contains(Point(x, y)):
                a, t = tpp.get(pid, (None, None))
                fb.append({"n": nm, "x": round(x, 5), "y": round(y, 5), "on": round(fp[pid]["on"] / fp[pid]["f"], 4),
                           "f": fp[pid]["f"], "alp": round(a / t, 4) if t else None})
        out["fed2025"] = sorted(fb, key=lambda b: -b["f"])
        (OUT / f"{slug}.json").write_text(json.dumps(out, separators=(",", ":")))
    print(f"{len(geo)} seats; 2022 voting centres placed on map: {stats['placed']}/{stats['booths']}")


if __name__ == "__main__":
    main()
