"""One-off: Victorian district boundaries (ABS SED 2025) + AEC 2025 federal results by polling place.

Writes:
  data/geo/vic_districts_detail.geojson   lightly simplified (~10 m), for point-in-polygon work
  site/data/vic_districts.topojson         web-simplified for the map
  data/raw/aec2025/*.csv                   VIC first preferences, two-party, and polling place locations
Needs geopandas and npx (mapshaper) - installed by the workflow.
"""
import io
import subprocess
import zipfile
from pathlib import Path

import geopandas as gpd
import requests

UA = {"User-Agent": "vic2026-forecast (personal research; Paul Green green.paul.p@gmail.com)"}
SED = ("https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs/"
       "edition-3-july-2021-june-2026/access-and-downloads/digital-boundary-files/SED_2025_AUST_GDA2020.zip")
AEC = "https://results.aec.gov.au/31496/Website/Downloads/"
AEC_FILES = ["HouseStateFirstPrefsByPollingPlaceDownload-31496-VIC.csv", "GeneralPollingPlacesDownload-31496.csv",
             "HouseTppByPollingPlaceDownload-31496.csv"]


def main():
    out_raw = Path("data/raw/aec2025"); out_raw.mkdir(parents=True, exist_ok=True)
    for f in AEC_FILES:
        r = requests.get(AEC + f, headers=UA, timeout=120)
        r.raise_for_status()
        (out_raw / f).write_bytes(r.content)
        print("aec", f, len(r.content))

    r = requests.get(SED, headers=UA, timeout=300)
    r.raise_for_status()
    tmp = Path("/tmp/sed"); tmp.mkdir(exist_ok=True)
    zipfile.ZipFile(io.BytesIO(r.content)).extractall(tmp)
    shp = next(tmp.rglob("*.shp"))
    g = gpd.read_file(shp)
    print("columns:", list(g.columns))
    ste = next(c for c in g.columns if c.startswith("STE_NAME"))
    name = next(c for c in g.columns if c.startswith("SED_NAME"))
    vic = g[g[ste] == "Victoria"].copy()
    vic = vic[~vic[name].str.contains("No usual|Migratory|Outside", case=False, na=False)]
    vic["name"] = vic[name].str.replace(r"\s*\(.*\)$", "", regex=True)   # drop "(Southern Metropolitan)" etc.
    vic["slug"] = vic["name"].str.lower().str.replace(r"[^a-z]+", "-", regex=True).str.strip("-")
    vic = vic[["slug", "name", "geometry"]].to_crs(4326)
    print(len(vic), "Victorian districts")
    Path("data/geo").mkdir(parents=True, exist_ok=True)
    full = Path("/tmp/vic_full.geojson")
    vic.to_file(full, driver="GeoJSON")
    # topology-aware simplification with mapshaper (keeps shared borders clean)
    subprocess.run(["npx", "-y", "mapshaper", str(full), "-simplify", "8%", "keep-shapes", "-o",
                    "data/geo/vic_districts_detail.geojson", "precision=0.00001"], check=True)
    Path("site/data").mkdir(parents=True, exist_ok=True)
    subprocess.run(["npx", "-y", "mapshaper", str(full), "-simplify", "1.2%", "keep-shapes", "-rename-layers", "districts",
                    "-o", "site/data/vic_districts.topojson", "format=topojson", "quantization=1e5"], check=True)
    for p in ["data/geo/vic_districts_detail.geojson", "site/data/vic_districts.topojson"]:
        print(p, Path(p).stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
