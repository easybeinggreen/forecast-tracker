"""Build office/data/office.json for the Office Cup: the seat data players may see, and nothing from the model.

Whitelist only. Anything the model produced (chances, swings, why-text, bands, Paul's research notes, seat questions)
stays out, so the game page has nothing to leak.

    python -m vic2026.build.export_office
"""
import json
import re
import shutil

import yaml
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SITE = ROOT / "site" / "data"
DEST = ROOT / "office" / "data" / "office.json"

SEAT_KEYS = ["slug", "name", "region", "mp", "held_2022", "margin", "primaries_2022", "prims_2022_grouped",
             "final_two_2022", "fed2025", "candidates_2026", "demo", "demo_vic", "place", "profile", "history", "links"]
NEWS_PER_SEAT = 5

# Publishers whose articles are mostly behind a subscription (labelled by publisher, not checked article by article).
PAYWALLED = {"Herald Sun", "AFR", "The Australian", "The Age", "SMH.com.au", "The Weekly Times", "Geelong Advertiser",
             "Crikey", "The Border Mail", "Bendigo Advertiser", "The Courier", "Latrobe Valley Express", "The Standard",
             "Shepparton News", "Gippsland Times", "Bairnsdale Advertiser", "The Wimmera Mail-Times", "Sunraysia Daily"}
POLITICS = re.compile(r"\b(election|elect|vote|voters?|poll|polls|candidate|candidates|MP|seat|campaign|Labor|Liberals?|Nationals|Greens|One Nation|independent|preferences)\b", re.I)
VIC = re.compile(r"\b(Victoria|Victorian|Vic|state election|Spring Street|Allan|Battin|Wilson)\b", re.I)
REGION_WORDS = {"Eastern Victoria": ["Gippsland", "Latrobe Valley", "Mornington Peninsula"], "Northern Victoria": ["Goulburn", "Murray", "Mallee", "Bendigo"],
                "Western Victoria": ["Ballarat", "Geelong", "Wimmera", "Western District"]}
# Seat names that are also everyday words or big places: these need a politics word alongside.
AMBIGUOUS = {"melbourne", "richmond", "bass", "lara", "kew", "frankston", "geelong", "carrum", "eureka", "ripon", "lowan", "polwarth", "evelyn", "greenvale", "warrandyte"}
JUNK_BOOTH = re.compile(r"\b(PPVC|EVC|Early Voting|Divisional|Mobile|Hospital|Special|Office|Hall|Centre|Center|School|College|Primary|Church|Uniting|Club|Library)\b|\(.*?\)", re.I)
ABROAD = re.compile(r"\b(BC|Canada|Canadian|Vancouver|US|U\.S\.|midterms?|Trump|UK|Britain|NZ|New Zealand|Queensland|NSW|Tasmania|South Australia|SA election|WA election|federal by-election)\b")
SEATWORD = re.compile(r"\b(seat|seats|electorate|candidate|candidates|MP|member for|by-election|marginal)\b", re.I)
DIVISION = re.compile(r"(\s+[A-Z][A-Z'-]+)+$")  # AEC division appended to shared polling places, e.g. "Clyde HOLT"
DIRS = re.compile(r"\s+(North|South|East|West|Central|Upper|Lower|Heights)$", re.I)


def towns_of(booths):
    """Biggest places in the seat, from 2025 federal polling-place names and votes: [[name, lon, lat, votes]]."""
    agg = {}
    for b in (booths.get("fed2025") or []):
        n = DIRS.sub("", JUNK_BOOTH.sub("", DIVISION.sub("", b["n"]))).strip(" -,")
        if len(n) < 3:
            continue
        a = agg.setdefault(n, [n, b["x"], b["y"], 0])
        a[3] += b.get("f", 0)
    return [[n, round(x, 4), round(y, 4), v] for n, x, y, v in sorted(agg.values(), key=lambda t: -t[3])[:6]]


OTHER_SEATS = []  # filled in main(): every seat name, to drop region stories that are about a different seat


def relevance(title, s, towns, region):
    """2 = names the seat, a candidate or the MP; 1 = names a town in the seat or its region, in an election story; 0 = drop."""
    t, pol = title.lower(), bool(POLITICS.search(title))
    if ABROAD.search(title):
        return 0
    name = s["name"].lower()
    if re.search(rf"\b{re.escape(name)}\b", t) and (name not in AMBIGUOUS or SEATWORD.search(title)):
        return 2
    people = [c["name"] for c in s.get("candidates_2026") or []] + [s["mp"]["name"]]
    if any(p.lower() in t for p in people if p):
        return 2
    if any(re.search(rf"\b{re.escape(o)}\b", t) for o in OTHER_SEATS if o != name and o not in AMBIGUOUS and o not in name):
        return 0  # names another seat and not this one
    if pol and any(re.search(rf"\b{re.escape(n.lower())}\b", t) for n, *_ in towns if n.lower() not in AMBIGUOUS | {"melbourne"}):
        return 1
    base = [w for w in re.split(r"[\s-]+", s["name"]) if len(w) > 4 and w.lower() not in ("north", "south", "east", "west", "valley", "plains", "point", "park")]
    if pol and any(re.search(rf"\b{re.escape(w.lower())}\b", t) for w in base if w.lower() != name):
        return 1  # e.g. "Gippsland" for Gippsland East
    if pol and VIC.search(title) and any(w.lower() in t for w in REGION_WORDS.get(region, [])):
        return 1
    return 0


def main():
    F = json.loads((SITE / "forecast.json").read_text())
    sb = json.loads((SITE / "sportsbet.json").read_text())
    news = json.loads((SITE / "news.json").read_text()) if (SITE / "news.json").exists() else {"seats": {}}

    regions = json.loads((ROOT / "data" / "vic2026" / "regions.json").read_text())
    drv = yaml.safe_load((ROOT / "vic2026" / "config" / "drivers.yaml").read_text())
    reg_polls = drv.get("regions", {}).get("polls", [])
    seat_polls = drv.get("seat_polls") or []
    OTHER_SEATS[:] = [x["name"].lower() for x in F["seats"]]
    seats = []
    for s in F["seats"]:
        row = {k: s.get(k) for k in SEAT_KEYS if s.get(k) is not None}
        if row.get("place"):  # the Tally Room assessment is a prediction; keep the Wikipedia background only
            row["place"] = {k: v for k, v in row["place"].items() if k not in ("assessment", "tr_url")}
        row["links"] = [l for l in row.get("links", []) if "tallyroom" not in l.get("url", "")]  # Tally Room carries predictions
        latest = sb.get("seats", {}).get(s["slug"], {}).get("latest")
        if latest:
            d = sb["seats"][s["slug"]]
            row["sportsbet"] = {"as_of": latest["as_of"], "odds": latest["odds"], "fair": latest.get("fair"),
                                "names": d.get("names", {}), "history": [{"t": h["t"], "odds": h["odds"]} for h in d.get("history", [])]}
        bp = SITE / "booths" / f"{s['slug']}.json"
        towns = towns_of(json.loads(bp.read_text())) if bp.exists() else []
        region = regions.get(s["slug"])
        row["towns"] = towns
        scored = []
        for n in news.get("seats", {}).get(s["slug"], []):
            r = relevance(n["title"], row, towns, region)
            if r:
                scored.append({"title": n["title"], "source": n.get("source"), "url": n["url"], "date": (n.get("published") or "")[:10],
                               "rel": r, "paywalled": n.get("source") in PAYWALLED})
        row["news"] = sorted(scored, key=lambda n: (-n["rel"], n["date"]), reverse=False)[:NEWS_PER_SEAT]
        # Published polls only: the Upper House region the seat sits in, and any poll of the seat itself.
        row["polls"] = {"region": region,
                        "regional": [{"source": p["source"].split(" (")[0], "detail": p["source"], "url": p["url"], "primaries": p["regions"][region]}
                                     for p in reg_polls if region in p.get("regions", {})],
                        "seat": [{k: q[k] for k in ("pollster", "date", "n", "url", "primaries")} for q in seat_polls if q["seat"] == s["slug"]]}
        seats.append(row)

    photos = json.loads((SITE / "photos.json").read_text()) if (SITE / "photos.json").exists() else {}
    mps = {s["mp"]["name"] for s in F["seats"]}
    # Statewide picture: 2022 result, 2025 federal (Vic), the published polls and their public average, and the
    # prediction-market price on who wins (used to price the overall-result bet). Nothing from our model.
    import csv
    polls_dir = ROOT / "data" / "raw" / "polls"
    avg = json.loads((polls_dir / "et_poll-average.json").read_text())
    polls = sorted(csv.DictReader(open(polls_dir / "et_polls.csv")), key=lambda r: r["fieldwork_end"], reverse=True)
    statewide = {
        "y2022": F["why_statewide"]["2022"],
        "fed2025": F["fed2025_vic"],
        "polls": {"source": "Election Tracker average", "as_of": avg["as_of"], "primaries": avg["primaries"],
                  "list": [{k: r[k] for k in ("pollster", "commissioner", "fieldwork_end", "sample_size", "alp", "lnp", "onp", "grn", "others", "source_url")}
                           for r in polls if r.get("eligible_for_average") == "true"][:8]}
    }
    out = {"statewide": statewide, "photos": {k: v for k, v in photos.items() if k in mps}, "generated": F.get("generated"), "election_date": F.get("election_date"),
           "party_names": F.get("party_names"), "sportsbet_url": sb.get("url"), "seats": seats}
    DEST.parent.mkdir(parents=True, exist_ok=True)
    DEST.write_text(json.dumps(out, separators=(",", ":")))
    # Same look and map as Count Room: copy the shared stylesheet, map helpers and boundaries (nothing model-related).
    shutil.copy(ROOT / "site" / "css" / "app.css", ROOT / "office" / "css" / "app.css")
    for js in ("map.js",):  # seatx.js: Ballot Miner keeps its own copy (seat page differs from Count Room)
        shutil.copy(ROOT / "site" / "js" / js, ROOT / "office" / "js" / js)
    # Polling-place results (2022 state, 2025 federal) for the booth map; no model numbers in these files.
    shutil.rmtree(DEST.parent / "booths", ignore_errors=True)
    shutil.copytree(SITE / "booths", DEST.parent / "booths")
    shutil.copy(SITE / "vic_districts.topojson", DEST.parent / "vic_districts.topojson")
    print(f"office.json: {len(seats)} seats, {DEST.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
