"""Build office/data/office.json for the Office Cup: the seat data players may see, and nothing from the model.

Whitelist only. Anything the model produced (chances, swings, why-text, bands, Paul's research notes, seat questions)
stays out, so the game page has nothing to leak.

    python -m vic2026.build.export_office
"""
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SITE = ROOT / "site" / "data"
DEST = ROOT / "office" / "data" / "office.json"

SEAT_KEYS = ["slug", "name", "region", "mp", "held_2022", "margin", "primaries_2022", "prims_2022_grouped",
             "final_two_2022", "fed2025", "candidates_2026", "demo", "demo_vic", "place", "profile", "history", "links"]
NEWS_PER_SEAT = 8


def main():
    F = json.loads((SITE / "forecast.json").read_text())
    sb = json.loads((SITE / "sportsbet.json").read_text())
    news = json.loads((SITE / "news.json").read_text()) if (SITE / "news.json").exists() else {"seats": {}}

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
        row["news"] = [{k: n.get(k) for k in ("title", "source", "url", "date") if n.get(k)}
                       for n in news.get("seats", {}).get(s["slug"], [])[:NEWS_PER_SEAT]]
        seats.append(row)

    photos = json.loads((SITE / "photos.json").read_text()) if (SITE / "photos.json").exists() else {}
    mps = {s["mp"]["name"] for s in F["seats"]}
    # Statewide picture: 2022 result, 2025 federal (Vic), the published polls and their public average, and the
    # prediction-market price on who wins (used to price the overall-result bet). Nothing from our model.
    import csv
    polls_dir = ROOT / "data" / "raw" / "polls"
    avg = json.loads((polls_dir / "et_poll-average.json").read_text())
    polls = sorted(csv.DictReader(open(polls_dir / "et_polls.csv")), key=lambda r: r["fieldwork_end"], reverse=True)
    mk = json.loads((SITE / "markets.json").read_text())
    who = [m for m in mk["markets"] if m["source"] == "Kalshi" and "win the 2026 Victorian state election" in m.get("title", "")]
    code = {"Liberals and Nationals": "LNP", "Australian Labor Party": "ALP", "One Nation": "ON"}
    statewide = {
        "y2022": F["why_statewide"]["2022"],
        "fed2025": F["fed2025_vic"],
        "polls": {"source": "Election Tracker average", "as_of": avg["as_of"], "primaries": avg["primaries"],
                  "list": [{k: r[k] for k in ("pollster", "commissioner", "fieldwork_end", "sample_size", "alp", "lnp", "onp", "grn", "others", "source_url")}
                           for r in polls if r.get("eligible_for_average") == "true"][:8]},
        "government": {"source": "Kalshi", "as_of": mk["fetched"], "url": who[0]["url"] if who else None,
                       "p": {code[m["outcome"]]: m["p"] for m in who if m["outcome"] in code}},
    }
    out = {"statewide": statewide, "photos": {k: v for k, v in photos.items() if k in mps}, "generated": F.get("generated"), "election_date": F.get("election_date"),
           "party_names": F.get("party_names"), "sportsbet_url": sb.get("url"), "seats": seats}
    DEST.parent.mkdir(parents=True, exist_ok=True)
    DEST.write_text(json.dumps(out, separators=(",", ":")))
    # Same look and map as Count Room: copy the shared stylesheet, map helpers and boundaries (nothing model-related).
    shutil.copy(ROOT / "site" / "css" / "app.css", ROOT / "office" / "css" / "app.css")
    for js in ("map.js", "seatx.js"):
        shutil.copy(ROOT / "site" / "js" / js, ROOT / "office" / "js" / js)
    # Polling-place results (2022 state, 2025 federal) for the booth map; no model numbers in these files.
    shutil.rmtree(DEST.parent / "booths", ignore_errors=True)
    shutil.copytree(SITE / "booths", DEST.parent / "booths")
    shutil.copy(SITE / "vic_districts.topojson", DEST.parent / "vic_districts.topojson")
    print(f"office.json: {len(seats)} seats, {DEST.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
