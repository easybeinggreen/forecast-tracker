"""One-off: seat history sources for all 88 districts.

  data/raw/history/wiki/<slug>.html       Wikipedia "Electoral district of ..." article (members table, history)
  data/raw/history/tallyroom/<slug>.html  Tally Room 2026 seat guide (candidates, history, assessment)
"""
import json
import time
from pathlib import Path
from urllib.parse import quote

import requests

UA = {"User-Agent": "vic2026-forecast (personal research; Paul Green green.paul.p@gmail.com)"}
API = "https://en.wikipedia.org/w/api.php"


def wiki_title(s, name):
    q = {"action": "query", "list": "search", "format": "json", "srlimit": 5,
         "srsearch": f'"Electoral district of {name}" Victorian Legislative Assembly'}
    hits = s.get(API, params=q, headers=UA, timeout=30).json()["query"]["search"]
    for h in hits:
        t = h["title"]
        if t.startswith(f"Electoral district of {name}") and "Queensland" not in t and "New South Wales" not in t \
                and "South Australia" not in t and "Western Australia" not in t and "Tasmania" not in t:
            return t
    return hits[0]["title"] if hits else None


def main():
    F = json.loads(Path("site/data/forecast.json").read_text())
    s = requests.Session()
    wd = Path("data/raw/history/wiki"); wd.mkdir(parents=True, exist_ok=True)
    td = Path("data/raw/history/tallyroom"); td.mkdir(parents=True, exist_ok=True)
    titles = {}
    for seat in F["seats"]:
        slug, name = seat["slug"], seat["name"]
        try:
            t = wiki_title(s, name)
            titles[slug] = t
            r = s.get("https://en.wikipedia.org/api/rest_v1/page/html/" + quote(t.replace(" ", "_"), safe=""), headers=UA, timeout=30)
            if r.ok:
                (wd / f"{slug}.html").write_text(r.text, encoding="utf-8")
            print(name, "->", t, r.status_code)
        except Exception as e:  # noqa: BLE001
            print(name, "wiki error", e)
        time.sleep(0.5)
        tr = f"https://www.tallyroom.com.au/vic2026/{slug.replace('-', '')}2026"
        try:
            r = s.get(tr, headers=UA, timeout=30)
            if r.ok:
                (td / f"{slug}.html").write_text(r.text, encoding="utf-8")
            print("   tallyroom", r.status_code)
        except Exception as e:  # noqa: BLE001
            print("   tallyroom error", e)
        time.sleep(1.0)
    (Path("data/raw/history") / "wiki_titles.json").write_text(json.dumps(titles, indent=1))


if __name__ == "__main__":
    main()
