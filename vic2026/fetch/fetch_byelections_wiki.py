"""By-election results since 2022 from Wikipedia (the VEC pages fetched earlier are landing pages only)."""
from pathlib import Path
from urllib.parse import quote

import requests

UA = {"User-Agent": "vic2026-forecast (personal research; Paul Green green.paul.p@gmail.com)"}
API = "https://en.wikipedia.org/w/api.php"
SEATS = {"warrandyte": "Warrandyte", "mulgrave": "Mulgrave", "werribee": "Werribee", "prahran": "Prahran", "nepean": "Nepean"}


def main():
    s = requests.Session()
    out = Path("data/raw/byelections/wiki"); out.mkdir(parents=True, exist_ok=True)
    for slug, name in SEATS.items():
        q = {"action": "query", "list": "search", "format": "json", "srlimit": 3, "srsearch": f"{name} state by-election Victoria"}
        hits = s.get(API, params=q, headers=UA, timeout=30).json()["query"]["search"]
        t = next((h["title"] for h in hits if "by-election" in h["title"] and name in h["title"]), None)
        print(slug, "->", t)
        if t:
            r = s.get("https://en.wikipedia.org/api/rest_v1/page/html/" + quote(t.replace(" ", "_"), safe=""), headers=UA, timeout=30)
            if r.ok:
                (out / f"{slug}.html").write_text(r.text, encoding="utf-8")


if __name__ == "__main__":
    main()
