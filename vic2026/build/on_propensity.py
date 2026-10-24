"""One Nation's 2025 federal vote, re-cut to the 88 Victorian state districts.

Each AEC polling place (with coordinates) is placed in a state district; the district's One Nation
share is the sum of One Nation first preferences over the sum of formal votes at those places.
Divisions where One Nation did not stand are left out of the denominator.
Output: data/vic2026/on_federal2025.json
"""
import csv
import json
from collections import defaultdict
from pathlib import Path

from shapely.geometry import Point, shape
from shapely.strtree import STRtree

RAW = Path("data/raw/aec2025")
GROUP = {"ALP": "ALP", "LP": "LIB", "NP": "NAT", "GRN": "GRN", "ON": "ON", "IND": "IND",
         "FFP": "RMIN", "CYA": "RMIN", "LTP": "RMIN", "CEC": "RMIN", "GRPF": "RMIN",
         "HMP": "PROG", "VNS": "PROG", "SAL": "PROG", "AJP": "PROG"}


def rows(path):
    with open(path, encoding="utf-8-sig") as fh:
        next(fh)                                    # AEC files start with a title line
        yield from csv.DictReader(fh)


def main():
    geo = json.loads(Path("data/geo/vic_districts_detail.geojson").read_text())
    polys = [shape(f["geometry"]) for f in geo["features"]]
    slugs = [f["properties"]["slug"] for f in geo["features"]]
    tree = STRtree(polys)

    loc = {r["PollingPlaceID"]: (float(r["Longitude"]), float(r["Latitude"]))
           for r in rows(RAW / "GeneralPollingPlacesDownload-31496.csv")
           if r["State"] == "VIC" and r["Latitude"] and r["Longitude"]}

    on_divs = set()
    place = defaultdict(lambda: {"on": 0, "formal": 0, "div": None, "g": defaultdict(int)})
    for r in rows(RAW / "HouseStateFirstPrefsByPollingPlaceDownload-31496-VIC.csv"):
        k = (r["DivisionNm"], r["PollingPlaceID"])
        v = int(r["OrdinaryVotes"] or 0)
        place[k]["formal"] += v if r["Surname"] != "Informal" else 0
        place[k]["div"] = r["DivisionNm"]
        if r["Surname"] != "Informal":
            place[k]["g"][GROUP.get(r["PartyAb"], "OTH")] += v
        if r["PartyAb"] == "ON":
            place[k]["on"] += v
            on_divs.add(r["DivisionNm"])

    tpp = {}
    for r in rows(RAW / "HouseTppByPollingPlaceDownload-31496.csv"):
        if r["StateAb"] == "VIC":
            tpp[(r["DivisionNm"], r["PollingPlaceID"])] = (int(r["Australian Labor Party Votes"]), int(r["TotalVotes"]))
    agg = defaultdict(lambda: {"on": 0, "formal": 0, "places": 0, "g": defaultdict(int), "alp": 0, "tpp": 0})
    unplaced = 0
    for (div, ppid), v in place.items():
        if div not in on_divs or ppid not in loc or v["formal"] == 0:
            continue
        pt = Point(loc[ppid])
        hit = [i for i in tree.query(pt) if polys[i].covers(pt)]
        if not hit:
            unplaced += 1
            continue
        a = agg[slugs[hit[0]]]
        a["on"] += v["on"]; a["formal"] += v["formal"]; a["places"] += 1
        for g, n in v["g"].items():
            a["g"][g] += n
        if (div, ppid) in tpp:
            a["alp"] += tpp[(div, ppid)][0]; a["tpp"] += tpp[(div, ppid)][1]

    out = {s: {"on_share": round(a["on"] / a["formal"], 5), "formal": a["formal"], "places": a["places"],
               "prims": {g: round(100 * n / a["formal"], 1) for g, n in sorted(a["g"].items(), key=lambda kv: -kv[1])},
               "alp_tpp": round(100 * a["alp"] / a["tpp"], 1) if a["tpp"] else None}
           for s, a in sorted(agg.items()) if a["formal"] > 0}
    tot_on = sum(a["on"] for a in agg.values()); tot_f = sum(a["formal"] for a in agg.values())
    Path("data/vic2026/on_federal2025.json").write_text(json.dumps(
        {"source": "AEC 2025 House first preferences by polling place, placed in ABS SED 2025 boundaries",
         "statewide_on_share_placed": round(tot_on / tot_f, 5), "divisions_with_on": sorted(on_divs), "seats": out}, indent=1))
    print(f"{len(out)} districts, {len(on_divs)} divisions with One Nation, unplaced polling places: {unplaced}, "
          f"placed ON share {tot_on / tot_f:.2%}")
    ranked = sorted(out.items(), key=lambda kv: kv[1]["on_share"])
    print("lowest:", [(s, f"{v['on_share']:.1%}") for s, v in ranked[:6]])
    print("highest:", [(s, f"{v['on_share']:.1%}") for s, v in ranked[-10:]])
    print("missing:", sorted(set(slugs) - set(out)))


if __name__ == "__main__":
    main()
