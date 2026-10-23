"""Download VEC by-election / supplementary election result pages (2023 onwards) into data/raw/byelections/."""
import re
import time
from pathlib import Path
from urllib.parse import urljoin

import requests

BASE = "https://www.vec.vic.gov.au"
INDEX = BASE + "/results/state-election-results/state-by-elections-timeline"
OUT = Path("data/raw/byelections")
UA = {"User-Agent": "vic2026-forecast (personal research; Paul Green green.paul.p@gmail.com)"}
WANT = ("narracan", "warrandyte", "mulgrave", "werribee", "prahran", "nepean")


def get(s, url):
    for a in range(3):
        r = s.get(url, headers=UA, timeout=60)
        if r.ok:
            return r.text
        time.sleep(3)
    print("failed", url)
    return None


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    s = requests.Session()
    idx = get(s, INDEX)
    (OUT / "index.html").write_text(idx, encoding="utf-8")
    pages = sorted(set(re.findall(r"""href=["'](/results/state-election-results/state-by-elections-timeline/[a-z0-9\-]+)["'/]""", idx)))
    pages = [p for p in pages if any(w in p for w in WANT)]
    print(pages)
    for p in pages:
        name = p.rstrip("/").split("/")[-1]
        d = OUT / name
        d.mkdir(exist_ok=True)
        html = get(s, BASE + p)
        if not html:
            continue
        (d / "results.html").write_text(html, encoding="utf-8")
        for href in set(re.findall(r"""href=["']([^"']*distribution[^"']*)["']""", html)):
            if p in href:
                dist = get(s, urljoin(BASE, href))
                if dist:
                    (d / "distribution.html").write_text(dist, encoding="utf-8")
        time.sleep(1)


if __name__ == "__main__":
    main()
