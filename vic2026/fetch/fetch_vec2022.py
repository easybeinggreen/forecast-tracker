"""Download raw 2022 Victorian state election results from the VEC (runs on GitHub Actions).

Saves, per district, into data/raw/vec2022/<slug>/:
  results.html       - first preferences, final two, totals
  distribution.html  - full distribution of preferences
  booths.xls         - primary results by voting centre
  booths_2cp.html    - two-candidate-preferred by voting centre
Parsing happens separately (vic2026/build/parse_vec2022.py) so raw files are kept as-is.
"""
import re
import sys
import time
from pathlib import Path
from urllib.parse import quote, urljoin

import requests

BASE = "https://www.vec.vic.gov.au"
INDEX = BASE + "/results/state-election-results/2022-state-election-results/results-by-district"
OUT = Path("data/raw/vec2022")
UA = {"User-Agent": "vic2026-forecast (personal research; Paul Green green.paul.p@gmail.com)"}


def get(s, url, binary=False):
    for attempt in range(4):
        try:
            r = s.get(url, headers=UA, timeout=60)
            if r.status_code == 200:
                return r.content if binary else r.text
            print(f"  {r.status_code} {url}")
        except requests.RequestException as e:
            print(f"  error {e} {url}")
        time.sleep(3 * (attempt + 1))
    return None


def main():
    s = requests.Session()
    OUT.mkdir(parents=True, exist_ok=True)
    index = get(s, INDEX)
    if not index:
        sys.exit("could not load district index")
    (OUT / "index.html").write_text(index, encoding="utf-8")
    slugs = sorted(set(re.findall(r"/results-by-district/([a-z0-9\-]+)-district-results(?=[\"/?#])", index)))
    print(f"{len(slugs)} districts found")
    missing = []
    for slug in slugs:
        d = OUT / slug
        d.mkdir(exist_ok=True)
        page_url = f"{INDEX}/{slug}-district-results"
        html = get(s, page_url)
        if not html:
            missing.append(slug)
            continue
        (d / "results.html").write_text(html, encoding="utf-8")
        # follow links found on the page rather than guessing names
        links = dict()
        for href in re.findall(r'href="([^"]+)"', html):
            h = href.replace("&amp;", "&")
            if "distribution" in h and slug in h:
                links["distribution.html"] = urljoin(BASE, h)
            elif "2cp-results-by-voting-centre" in h:
                links["booths_2cp.html"] = urljoin(BASE, h)
            elif h.lower().endswith(".xls") and "voting centre" in h.lower().replace("%20", " "):
                links["booths.xls"] = h.replace(" ", "%20")
        for name, url in links.items():
            if (d / name).exists():
                continue
            content = get(s, url, binary=name.endswith(".xls"))
            if content is None:
                missing.append(f"{slug}/{name}")
                continue
            mode = "wb" if name.endswith(".xls") else "w"
            with open(d / name, mode, **({} if mode == "wb" else {"encoding": "utf-8"})) as fh:
                fh.write(content)
            time.sleep(0.7)
        print(f"{slug}: {sorted(links)}")
        time.sleep(0.7)
    (OUT / "MISSING.txt").write_text("\n".join(missing), encoding="utf-8")
    print(f"done; missing: {missing}")


if __name__ == "__main__":
    main()
