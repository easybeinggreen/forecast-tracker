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
        row["links"] = [l for l in row.get("links", []) if "tallyroom" not in l.get("url", "")]  # Tally Room carries predictions
        latest = sb.get("seats", {}).get(s["slug"], {}).get("latest")
        if latest:
            row["sportsbet"] = {"as_of": latest["as_of"], "odds": latest["odds"], "fair": latest.get("fair"),
                                "names": sb["seats"][s["slug"]].get("names", {})}
        row["news"] = [{k: n.get(k) for k in ("title", "source", "url", "date") if n.get(k)}
                       for n in news.get("seats", {}).get(s["slug"], [])[:NEWS_PER_SEAT]]
        seats.append(row)

    photos = json.loads((SITE / "photos.json").read_text()) if (SITE / "photos.json").exists() else {}
    mps = {s["mp"]["name"] for s in F["seats"]}
    out = {"photos": {k: v for k, v in photos.items() if k in mps}, "generated": F.get("generated"), "election_date": F.get("election_date"),
           "party_names": F.get("party_names"), "sportsbet_url": sb.get("url"), "seats": seats}
    DEST.parent.mkdir(parents=True, exist_ok=True)
    DEST.write_text(json.dumps(out, separators=(",", ":")))
    # Same look and map as Count Room: copy the shared stylesheet, map helpers and boundaries (nothing model-related).
    shutil.copy(ROOT / "site" / "css" / "app.css", ROOT / "office" / "css" / "app.css")
    shutil.copy(ROOT / "site" / "js" / "map.js", ROOT / "office" / "js" / "map.js")
    shutil.copy(SITE / "vic_districts.topojson", DEST.parent / "vic_districts.topojson")
    print(f"office.json: {len(seats)} seats, {DEST.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
