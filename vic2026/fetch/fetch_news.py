"""Nightly: recent news per seat from Google News RSS -> site/data/news.json.

Two searches per seat, plus one per party (its news_query in parties.yaml): the seat name with the election, and the sitting MP. Results are merged,
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


TOPICS = [
    ("Cost of living", r"cost of living|cost-of-living|prices|power bills|energy bills|grocer|supermarket|afford"),
    ("Housing", r"housing|\brent|renters|homeless|apartment|planning|rezon|development|tower"),
    ("Crime & safety", r"crime|police|\bbail|stabbing|machete|carjack|break-in|assault|youth offend|safety|violence"),
    ("Health & hospitals", r"hospital|health|ambulance|\bGP\b|mental health|surgery|nurse"),
    ("Transport & roads", r"\broad|rail|train|tram|\bbus|level crossing|airport|suburban rail loop|\bSRL\b|freeway|bypass|traffic|pothole"),
    ("Schools", r"school|education|TAFE|kinder|teacher"),
    ("Energy & coal", r"\bcoal|power station|energy|renewable|wind farm|transmission|\bgas\b|solar"),
    ("Treaty & First Peoples", r"treaty|Aboriginal|First Peoples|Indigenous"),
    ("Taxes & levies", r"levy|\btax|ESVF|land tax|stamp duty"),
    ("Environment", r"environment|climate|logging|forest|river|water|park"),
    ("Integrity", r"corruption|IBAC|scandal|rort|misconduct|branch stack"),
    ("Jobs & economy", r"\bjobs|unemploy|business|economy|\bdebt|budget"),
    ("Farming & regions", r"farm|agricultur|drought|regional"),
    ("Candidates", r"preselect|candidate|disendors|announce|running for|nominat"),
]


def topics(items):
    out = {}
    for it in items:
        for name, rx in TOPICS:
            if re.search(rx, it["title"], re.I):
                out[name] = out.get(name, 0) + 1
    return [{"t": k, "n": v} for k, v in sorted(out.items(), key=lambda kv: -kv[1]) if v][:6]


def diverse(items, per_source=2, limit=10):
    """Most recent first, but no more than `per_source` stories from any one outlet."""
    seen, count, keep = set(), {}, []
    for it in sorted(items, key=lambda x: x["published"] or "", reverse=True):
        k = re.sub(r"\W+", "", it["title"].lower())[:80]
        if k in seen:
            continue
        seen.add(k)
        src = it["source"] or "?"
        if count.get(src, 0) >= per_source:
            continue
        count[src] = count.get(src, 0) + 1
        keep.append(it)
    return keep[:limit]


QUALITY = "(site:abc.net.au OR site:theage.com.au OR site:theguardian.com OR site:sbs.com.au OR site:crikey.com.au OR site:aap.com.au)"


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
    seat_topics = {}
    for seat in F["seats"]:
        name, mp = seat["name"], seat["mp"]["name"]
        items = search(s, f'"{name}" Victorian election when:30d')
        time.sleep(1.2)
        if not mp.startswith("Vacant"):
            items += search(s, f'"{mp}" Victoria when:30d')
            time.sleep(1.2)
        items += search(s, f'"{name}" Victoria {QUALITY} when:60d')
        time.sleep(1.2)
        items = [it for it in items if relevant(it["title"], mp)]
        news[seat["slug"]] = diverse(items, per_source=2, limit=10)
        seat_topics[seat["slug"]] = topics(items)
        print(name, len(items), "->", len(news[seat["slug"]]))
    parties = {}
    for code, P in F.get("parties", {}).items():
        items = [it for it in search(s, f'{P["news_query"]} when:14d') if not NOISE.search(it["title"])]
        time.sleep(1.2)
        items += [it for it in search(s, f'{P["news_query"]} {QUALITY} when:14d') if not NOISE.search(it["title"])]
        time.sleep(1.2)
        parties[code] = diverse(items, per_source=2, limit=10)
        print(code, len(items))
    state = [it for it in search(s, '"Victorian election" when:7d') if not NOISE.search(it["title"])]
    out = {"generated": datetime.now(timezone.utc).isoformat(), "statewide": diverse(state, per_source=2, limit=12), "seats": news, "parties": parties, "topics": seat_topics}
    Path("site/data/news.json").write_text(json.dumps(out, separators=(",", ":")))


if __name__ == "__main__":
    main()
