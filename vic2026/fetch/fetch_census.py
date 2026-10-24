"""One-off: ABS 2021 Census General Community Profile for Victoria's state electoral districts.

Saves every table CSV (88 rows each) plus the metadata workbook into data/raw/census2021_sed/.
"""
import io
import re
import zipfile
from pathlib import Path

import requests

UA = {"User-Agent": "vic2026-forecast (personal research; Paul Green green.paul.p@gmail.com)"}
PAGE = "https://www.abs.gov.au/census/find-census-data/datapacks"
GUESS = "https://www.abs.gov.au/census/find-census-data/datapacks/download/2021_GCP_SED_for_VIC_short-header.zip"


def main():
    s = requests.Session()
    url = GUESS
    try:
        html = s.get(PAGE, headers=UA, timeout=60).text
        links = re.findall(r'href="([^"]+\.zip)"', html)
        hit = [l for l in links if "GCP" in l and "SED" in l and "VIC" in l and "short" in l]
        print("zip links found:", len(links), "matching:", hit[:3])
        if hit:
            url = hit[0] if hit[0].startswith("http") else "https://www.abs.gov.au" + hit[0]
    except requests.RequestException as e:
        print("page error", e)
    r = s.get(url, headers=UA, timeout=300)
    r.raise_for_status()
    out = Path("data/raw/census2021_sed"); out.mkdir(parents=True, exist_ok=True)
    z = zipfile.ZipFile(io.BytesIO(r.content))
    n = 0
    for name in z.namelist():
        base = Path(name).name
        if base.lower().endswith((".csv", ".xlsx")) and ("SED" in base or "Metadata" in name or "metadata" in name):
            (out / base).write_bytes(z.read(name)); n += 1
    print(url, "->", n, "files")
    print(sorted(p.name for p in out.iterdir())[:200])


if __name__ == "__main__":
    main()
