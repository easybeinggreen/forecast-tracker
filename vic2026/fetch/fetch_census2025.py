"""One-off: 2021 Census re-cut to the current (2025) Victorian district boundaries.

The ABS DataPack for state electoral divisions uses the old (pre-2022) districts, so instead:
  1. download the ASGS allocation file mapping 2021 mesh blocks (and their SA1s) to SED 2025;
  2. download the Victorian all-geographies DataPack and read selected SA1 tables;
  3. assign each SA1 to the district holding most of its mesh blocks, and sum counts.
Medians (G02) are population-weighted averages of SA1 medians, so approximate.
Output: data/raw/census2021_sed2025/<table>.csv (index SED_CODE_2025) + names.csv
"""
import io
import re
import zipfile
from pathlib import Path

import pandas as pd
import requests

UA = {"User-Agent": "vic2026-forecast (personal research; Paul Green green.paul.p@gmail.com)"}
ALLOC_PAGE = ("https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs-edition-3/"
              "jul2021-jun2026/access-and-downloads/allocation-files")
DP_PAGE = "https://www.abs.gov.au/census/find-census-data/datapacks"
TABLES = ["G01", "G02", "G14", "G29", "G37", "G43"] + [f"G09{x}" for x in "ABCDEFGH"] + ["G54A", "G54B", "G60A", "G60B", "G40"]  # + industry, occupation, labour force
OUT = Path("data/raw/census2021_sed2025")


def links(s, page):
    html = s.get(page, headers=UA, timeout=60).text
    out = []
    for h in re.findall(r'href="([^"]+)"', html):
        out.append(h if h.startswith("http") else "https://www.abs.gov.au" + h)
    return out


BOUNDS = ("https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs-edition-3/"
          "jul2021-jun2026/access-and-downloads/digital-boundary-files/SA1_2021_AUST_SHP_GDA2020.zip")
LOG = []


def log(*a):
    print(*a); LOG.append(" ".join(str(x) for x in a))


def spatial_map(s):
    """Fallback: SA1 2021 polygons -> representative point -> SED 2025 polygon (ours)."""
    import geopandas as gpd
    r = s.get(BOUNDS, headers=UA, timeout=900); r.raise_for_status()
    tmp = Path("/tmp/sa1"); tmp.mkdir(exist_ok=True)
    zipfile.ZipFile(io.BytesIO(r.content)).extractall(tmp)
    g = gpd.read_file(next(tmp.rglob("*.shp")))
    ste = next(c for c in g.columns if c.upper().startswith("STE_NAME"))
    g = g[g[ste] == "Victoria"].copy()
    g = g[g.geometry.notna()]
    g["geometry"] = g.geometry.representative_point()
    seds = gpd.read_file("data/geo/vic_districts_detail.geojson").to_crs(g.crs)
    j = gpd.sjoin(g, seds[["slug", "name", "geometry"]], how="inner", predicate="within")
    sa1 = next(c for c in g.columns if c.upper().startswith("SA1_CODE"))
    seds[["slug", "name"]].rename(columns={"slug": "SED_CODE_2025", "name": "SED_NAME_2025"}).to_csv(OUT / "names.csv", index=False)
    log("spatial: SA1s", len(g), "joined", len(j))
    return dict(zip(j[sa1].astype(str), j["slug"]))


def main():
    try:
        run()
    except Exception as e:  # noqa: BLE001
        import traceback
        log("FAILED", repr(e)); log(traceback.format_exc())
    (OUT / "log.txt").write_text("\n".join(LOG))


def run():
    s = requests.Session()
    OUT.mkdir(parents=True, exist_ok=True)
    try:
        al = [l for l in links(s, ALLOC_PAGE) if "SED_2025" in l.upper().replace("-", "_")]
    except Exception as e:  # noqa: BLE001
        al = []; log("alloc page error", e)
    log("allocation links:", al)
    alloc = None
    for l in al:
        r = s.get(l, headers=UA, timeout=300); r.raise_for_status()
        if l.lower().endswith(".zip"):
            z = zipfile.ZipFile(io.BytesIO(r.content))
            n = next(n for n in z.namelist() if n.lower().endswith((".csv", ".xlsx")))
            data = z.read(n); l = n
        else:
            data = r.content
        alloc = pd.read_csv(io.BytesIO(data), dtype=str) if l.lower().endswith(".csv") else pd.read_excel(io.BytesIO(data), dtype=str)
        break
    sa1_to_sed = None
    if alloc is not None and not any(c.upper().startswith("SA1_CODE") for c in alloc.columns):
        try:
            mb = [l for l in links(s, ALLOC_PAGE) if "MB_2021_AUST" in l.upper() and l.lower().endswith((".xlsx", ".csv", ".zip"))]
            log("MB allocation links:", mb)
            r = s.get(mb[0], headers=UA, timeout=600); r.raise_for_status()
            if mb[0].lower().endswith(".zip"):
                z = zipfile.ZipFile(io.BytesIO(r.content)); n = next(n for n in z.namelist() if n.lower().endswith((".csv", ".xlsx")))
                raw, nm = z.read(n), n
            else:
                raw, nm = r.content, mb[0]
            m = pd.read_csv(io.BytesIO(raw), dtype=str) if nm.lower().endswith(".csv") else pd.read_excel(io.BytesIO(raw), dtype=str)
            m = m[[c for c in m.columns if c.upper() in ("MB_CODE_2021", "SA1_CODE_2021")]]
            alloc = alloc.merge(m, on="MB_CODE_2021", how="left")
        except Exception as e:  # noqa: BLE001
            log("MB merge failed", repr(e)); alloc = None
    sa1_to_sed = spatial_map(s) if alloc is None else from_alloc(alloc)
    dp_and_aggregate(s, sa1_to_sed)


def from_alloc(alloc):
    log("alloc columns:", list(alloc.columns))
    sa1c = next(c for c in alloc.columns if c.upper().startswith("SA1_CODE"))
    sedc = next(c for c in alloc.columns if c.upper().startswith("SED_CODE"))
    sedn = next(c for c in alloc.columns if c.upper().startswith("SED_NAME"))
    st = next((c for c in alloc.columns if c.upper().startswith("STATE_NAME") or c.upper().startswith("STE_NAME")), None)
    if st:
        alloc = alloc[alloc[st] == "Victoria"]
    m = alloc.groupby([sa1c, sedc]).size().reset_index(name="n").sort_values("n").drop_duplicates(sa1c, keep="last")
    sa1_to_sed = dict(zip(m[sa1c], m[sedc]))
    alloc[[sedc, sedn]].drop_duplicates().to_csv(OUT / "names.csv", index=False)
    log(len(sa1_to_sed), "SA1s mapped to", m[sedc].nunique(), "districts")
    return sa1_to_sed


def dp_and_aggregate(s, sa1_to_sed):
    dp = [l for l in links(s, DP_PAGE) if "GCP" in l and "all" in l.lower() and "VIC" in l and "short" in l.lower() and l.endswith(".zip")]
    url = dp[0] if dp else "https://www.abs.gov.au/census/find-census-data/datapacks/download/2021_GCP_all_for_VIC_short-header.zip"
    log("datapack:", url)
    r = s.get(url, headers=UA, timeout=900); r.raise_for_status()
    z = zipfile.ZipFile(io.BytesIO(r.content))
    for t in TABLES:
        name = next((n for n in z.namelist() if re.search(rf"2021Census_{t}_VIC_SA1\.csv$", n)), None)
        if not name:
            log(t, "not in datapack"); continue
        df = pd.read_csv(io.BytesIO(z.read(name)), dtype={"SA1_CODE_2021": str})
        df["SED"] = df["SA1_CODE_2021"].map(sa1_to_sed)
        df = df.dropna(subset=["SED"]).drop(columns=["SA1_CODE_2021"])
        if t == "G02":
            pop = pd.read_csv(io.BytesIO(z.read(next(n for n in z.namelist() if n.endswith("2021Census_G01_VIC_SA1.csv")))),
                              dtype={"SA1_CODE_2021": str}).set_index("SA1_CODE_2021")["Tot_P_P"]
            raw = pd.read_csv(io.BytesIO(z.read(name)), dtype={"SA1_CODE_2021": str}).set_index("SA1_CODE_2021")
            raw = raw[raw.index.isin(sa1_to_sed)]
            w = pop.reindex(raw.index).fillna(0)
            agg = raw.mul(w, axis=0).groupby(raw.index.map(sa1_to_sed)).sum().div(w.groupby(raw.index.map(sa1_to_sed)).sum(), axis=0)
        else:
            agg = df.groupby("SED").sum(numeric_only=True)
        agg.index.name = "SED_CODE_2025"
        agg.to_csv(OUT / f"{t}.csv")
        log(t, agg.shape)


if __name__ == "__main__":
    main()
