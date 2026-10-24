"""Nightly: recent news per seat from Google News RSS -> site/data/news.json.

Two searches per seat: the seat name with the election, and the sitting MP. Results are merged,
de-duplicated and the eight most recent kept. Failures for a seat are skipped, not fatal.
"""
import json
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import quote_plus

import requests

UA = {"User-Agent": "Mozilla/5.0 (vic2026-forecast personal research)"}
RSS = "https://news.google.com/rss/search?q={q}&hl=en-AU&gl=AU&ceid=AU:en"

NOISE = re.compile(r"weather report|supercoach|tipping|\bracing\b|\bcup\b|real estate|for sale|auction|obituar|horoscope|"
                   r"recipe|\bafl\b|\bnrl\b|cricket|\bepl\b|footy|fantasy|\bsold\b|property market|traffic", re.I)
POLITICS = re.compile(r"election|\belect|\bvot(e|er|ers|ing)\b|\bpoll|candidate|preselect|campaign|\bMPs?\b|member for|"
                      r"labor|liberal|coalition|greens|one nation|nationals|independent|premier|opposition|carroll|"
                      r"jess wilson|pickering|minister|government|parliament|\bseat\b|ballot|preference|pledge|promise|"
                      r"funding|budget|policy|by-election|treaty", re.I)


def relevant(title, mp):
    """Keep politics stories, or any story naming the sitting MP; drop sport, weather, property."""
    if NOISE.search(title):
        return False
    surname = mp.split()[-1] if mp else ""
    return bool(POLITICS.search(title)) or (len(surname) > 3 and surname.lower() in title.lower())


def search(s, q):
    r = s.get(RSS.format(q=quote_plus(q)), headers=UA, timeout=30)
    if r.status_code != 200:
        print("  ", r.status_code, q)
        return []
    out = []
    for it in ET.fromstring(r.content).iter("item"):
        title = (it.findtext("title") or "").strip()
        src = it.find("source")
        source = src.text.strip() if src is not None and src.text else ""
        if source and title.endswith(" - " + source):
            title = title[: -len(source) - 3]
        try:
            when = parsedate_to_datetime(it.findtext("pubDate")).astimezone(timezone.utc).isoformat()
        except Exception:  # noqa: BLE001
            when = None
        out.append({"title": title, "source": source, "url": it.findtext("link"), "published": when})
    return out


def main():
    F = json.loads(Path("site/data/forecast.json").read_text())
    s = requests.Session()
    news = {}
    for seat in F["seats"]:
        name, mp = seat["name"], seat["mp"]["name"]
        items = search(s, f'"{name}" Victorian election when:30d')
        time.sleep(1.2)
        items += search(s, f'"{mp}" Victoria when:30d')
        time.sleep(1.2)
        seen, keep = set(), []
        for it in sorted(items, key=lambda x: x["published"] or "", reverse=True):
            if not relevant(it["title"], mp):
                continue
            k = re.sub(r"\W+", "", it["title"].lower())[:80]
            if k in seen:
                continue
            seen.add(k)
            keep.append(it)
        news[seat["slug"]] = keep[:8]
        print(name, len(keep))
    state = [it for it in search(s, '"Victorian election" when:7d') if not NOISE.search(it["title"])]
    out = {"generated": datetime.now(timezone.utc).isoformat(), "statewide": state[:12], "seats": news}
    Path("site/data/news.json").write_text(json.dumps(out, separators=(",", ":")))


if __name__ == "__main__":
    main()
