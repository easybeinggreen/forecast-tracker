"""Seat geography -> data/vic2026/geography.json: area, people per km2, distance from the Melbourne CBD, and a band
(inner / middle / outer Melbourne, regional city, rural and coast). Run once; boundaries don't change before the election."""
import json
from pathlib import Path

from pyproj import Geod
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[2]
CBD = (144.9631, -37.8136)
REGIONAL_CITIES = {"geelong", "lara", "bellarine", "south-barwon", "wendouree", "eureka", "bendigo-east", "bendigo-west", "morwell", "shepparton"}


def main():
    g = Geod(ellps="WGS84")
    geo = json.loads((ROOT / "data/geo/vic_districts_detail.geojson").read_text())["features"]
    demo = json.loads((ROOT / "data/vic2026/demographics.json").read_text())["seats"]
    seats = json.loads((ROOT / "site/data/forecast.json").read_text())["seats"]
    region = {s["slug"]: s["region"] for s in seats}
    out = {}
    for f in geo:
        slug = f["properties"]["slug"]; sh = shape(f["geometry"])
        km2 = abs(g.geometry_area_perimeter(sh)[0]) / 1e6
        c = sh.representative_point()
        az, _, m = g.inv(*CBD, c.x, c.y)
        km = m / 1000
        compass = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][round((az % 360) / 45) % 8]
        if region.get(slug) == "metro":
            band = "inner" if km <= 12 else "middle" if km <= 25 else "outer"
        else:
            band = "city" if slug in REGIONAL_CITIES else "rural"
        out[slug] = {"km2": round(km2, 1), "density": round(demo.get(slug, {}).get("pop", 0) / km2, 1), "km_cbd": round(km, 1), "dir": compass, "band": band}
    (ROOT / "data/vic2026/geography.json").write_text(json.dumps(out, indent=1))
    from collections import Counter
    print(Counter(v["band"] for v in out.values()))


if __name__ == "__main__":
    main()
