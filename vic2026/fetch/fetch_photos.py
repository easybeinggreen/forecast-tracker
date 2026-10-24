"""MP and party-leader photos from Wikipedia / Wikimedia Commons (free licences only), with credits.

For each sitting MP (and party leader), find their Wikipedia article, take its lead image, and keep it
only if Commons reports a free licence. Writes site/data/photos.json:
  {name: {"img": thumb_url, "page": wiki_url, "credit": artist, "license": short, "file": commons_page}}
Images are hot-linked from upload.wikimedia.org, as Wikimedia permits.
"""
import json
import re
import time
from pathlib import Path

import requests

UA = {"User-Agent": "vic2026-forecast (personal research; Paul Green green.paul.p@gmail.com)"}
API = "https://en.wikipedia.org/w/api.php"
COMMONS = "https://commons.wikimedia.org/w/api.php"
FREE = re.compile(r"^(CC0|CC BY|CC-BY|Public domain|PD|Attribution|GFDL|CC BY-SA)", re.I)


def getj(s, url, params):
    for i in range(4):
        r = s.get(url, params=params, headers=UA, timeout=30)
        try:
            return r.json()
        except ValueError:
            time.sleep(10 * (i + 1))
    raise RuntimeError(f"no JSON after retries ({r.status_code})")


def find_page(s, name):
    q = {"action": "query", "list": "search", "format": "json", "srlimit": 5,
         "srsearch": f'{name} Australian politician'}
    for h in getj(s, API, q)["query"]["search"]:
        t = h["title"]
        last = name.split()[-1].lower()
        if last in t.lower() and "election" not in t.lower() and "district" not in t.lower():
            return t
    return None


LOG = []
_print = print


def print(*a):  # noqa: A001
    _print(*a); LOG.append(" ".join(str(x) for x in a))


def main():
    F = json.loads(Path("site/data/forecast.json").read_text())
    names = sorted({s["mp"]["name"] for s in F["seats"] if not s["mp"]["name"].startswith("Vacant")}
                   | {p["leader"]["name"] for p in F.get("parties", {}).values()})
    s = requests.Session()
    dest = Path("site/data/photos.json")
    out = json.loads(dest.read_text()) if dest.exists() else {}
    for name in names:
        if name in out:
            continue
        try:
            t = find_page(s, name)
            if not t:
                print(name, "no page"); continue
            q = {"action": "query", "titles": t, "prop": "pageimages|info", "piprop": "thumbnail|name",
                 "pithumbsize": 240, "inprop": "url", "format": "json", "redirects": 1}
            pg = next(iter(getj(s, API, q)["query"]["pages"].values()))
            if "thumbnail" not in pg:
                print(name, "no image", t); continue
            f = "File:" + pg["pageimage"]
            q = {"action": "query", "titles": f, "prop": "imageinfo", "iiprop": "extmetadata|url", "format": "json"}
            ii = next(iter(getj(s, COMMONS, q)["query"]["pages"].values()))
            md = (ii.get("imageinfo") or [{}])[0].get("extmetadata", {})
            lic = re.sub(r"<[^>]+>", "", md.get("LicenseShortName", {}).get("value", "")).strip()
            artist = re.sub(r"<[^>]+>", "", md.get("Artist", {}).get("value", "")).strip()
            if not FREE.match(lic):
                print(name, "non-free", lic); continue
            out[name] = {"img": pg["thumbnail"]["source"], "page": pg.get("fullurl"), "credit": artist[:80],
                         "license": lic, "file": (ii.get("imageinfo") or [{}])[0].get("descriptionurl")}
            print(name, "ok", lic)
        except Exception as e:  # noqa: BLE001
            print(name, "error", repr(e))
        time.sleep(1.5)
    Path("site/data/photos.json").write_text(json.dumps(out, indent=1))
    print(len(out), "of", len(names), "with free photos")
    Path("data/raw/photos_log.txt").write_text("\n".join(LOG))


if __name__ == "__main__":
    main()
