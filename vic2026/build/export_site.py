"""Build site/data/forecast.json: model output + seat metadata for the dashboard."""
import io
import json
import re
from pathlib import Path

import pandas as pd
import yaml

ROOT = Path(__file__).resolve().parents[2]

# Changes since the 2022 general election (by-elections, defections). Sources: VEC, Wikipedia, ABC.
CURRENT_MP = {
    "mulgrave": ("Eden Foster", "ALP", "Won the 2023 by-election"),
    "warrandyte": ("Nicole Werner", "LIB", "Won the 2023 by-election"),
    "werribee": ("John Lister", "ALP", "Won the 2025 by-election"),
    "prahran": ("Rachel Westaway", "LIB", "Won the 2025 by-election from the Greens"),
    "nepean": ("Anthony Marsh", "LIB", "Won the May 2026 by-election"),
    "ringwood": ("Will Fowles", "IND", "Elected as Labor in 2022; now sits as an independent"),
    "south-barwon": ("Darren Cheeseman", "IND", "Elected as Labor in 2022; now sits as an independent"),
    "brunswick": ("Vacant (Tim Read)", "GRN", "Greens MP Tim Read had announced his retirement and died in September 2026"),
}

MARKETS = [
    {"source": "Kalshi", "what": "Coalition wins the election", "p": 0.74, "as_of": "2026-10-23",
     "note": "Thin market (~US$5k traded); read only, not licensed in Australia",
     "url": "https://kalshi.com/markets/kxvictorianstate/victorian-state-election/kxvictorianstate-26nov28"},
    {"source": "Manifold", "what": "Next Premier is Coalition", "p": 0.68, "as_of": "2026-10-23",
     "note": "Play money, 15 traders", "url": "https://manifold.markets/MatthewLeong/the-premier-of-victoria-will-be-fro"},
    {"source": "Sportsbet", "what": "Coalition next government (margin removed)", "p": 0.60, "as_of": "2026-07-10",
     "note": "Quoted at 5-3 on in July; check current price", "url": "https://worldisnotenough.org/2026/07/10/one-nation-puzzles-the-punters/"},
]


def nice_name(n):
    if "," not in n:
        return n
    sur, given = [x.strip() for x in n.split(",", 1)]
    sur = " ".join(w[:1] + w[1:].lower() if not w.lower().startswith("mc") else "Mc" + w[2:3].upper() + w[3:].lower()
                   for w in re.split(r"(?<=[ -])", sur.title()) if w) if sur.isupper() or any(c.islower() for c in sur) else sur
    return f"{given} {sur.title() if sur.isupper() else sur}".replace("Mcl", "McL")


def pendulum():
    html = (ROOT / "data/raw/polls/tallyroom_pendulum.html").read_text(encoding="utf-8")
    t = pd.read_html(io.StringIO(html))[0]
    out = {}
    for _, r in t.iterrows():
        for a, b in ((0, 1), (2, 3)):
            seat, m = str(r.iloc[a]), str(r.iloc[b])
            mm = re.match(r"([A-Z]+)(?: vs ([A-Z]+))? ([\d.]+)%", m)
            if mm:
                out[seat.strip().lower().replace(" ", "-")] = {"party": mm.group(1), "vs": mm.group(2), "margin": float(mm.group(3))}
    return out


POLL_COL = {"ALP": "alp", "LIB": "lnp", "NAT": "lnp", "GRN": "grn", "ON": "onp"}


def party_profiles(seats, F):
    """Hand-written profiles (config/parties.yaml) plus computed seats, polls and odds."""
    prof = yaml.safe_load((ROOT / "vic2026/config/parties.yaml").read_text())
    polls = pd.read_csv(ROOT / "data/raw/polls/et_polls.csv").sort_values("fieldwork_end")
    d22 = json.loads((ROOT / "data/vic2026/districts2022.json").read_text())
    votes, total = {}, 0
    for d in d22:
        for c in d["candidates"]:
            votes[c["party"]] = votes.get(c["party"], 0) + c["votes"]; total += c["votes"]
    out = {}
    for code, p in prof.items():
        col = POLL_COL[code]
        series = [{"date": r.fieldwork_end, "v": float(r[col]), "pollster": r.pollster}
                  for _, r in polls.iterrows() if pd.notna(r[col])]
        now = [s for s in seats if s["mp"]["party"] == code and not s["mp"]["name"].startswith("Vacant")]
        held = [s for s in seats if s["mp"]["party"] == code or (s["held_2022"] == code and s["mp"]["party"] == "IND" and code == "ALP")]
        gains = sorted((s for s in seats if s not in held and s["model"]["win"].get(code, 0) >= 0.05),
                       key=lambda s: -s["model"]["win"].get(code, 0))
        out[code] = {**p, "code": code,
                     "seats_2022": sum(1 for s in seats if s["held_2022"] == code),
                     "seats_now": len(now),
                     "primary_2022": round(100 * votes.get(code, 0) / total, 1),
                     "coalition_2022": round(100 * (votes.get("LIB", 0) + votes.get("NAT", 0)) / total, 1),
                     "poll_avg": F["statewide_inputs"].get("LNP" if code in ("LIB", "NAT") else code),
                     "poll_label": "Coalition (Liberal + Nationals)" if code in ("LIB", "NAT") else p["name"],
                     "polls": series,
                     "forecast": F["summary"]["seats"].get(code),
                     "held": [s["slug"] for s in held],
                     "gains": [s["slug"] for s in gains[:12]]}
    return out


def main():
    F = json.loads((ROOT / "data/vic2026/forecast.json").read_text())
    cfg = yaml.safe_load((ROOT / "vic2026/config/drivers.yaml").read_text())
    pend = pendulum()
    fedp = ROOT / "data/vic2026/on_federal2025.json"
    fed = json.loads(fedp.read_text())["seats"] if fedp.exists() else {}
    retiring = {s: p for p, ss in cfg["retiring"].items() for s in ss}
    regional = set(cfg["one_nation"]["regional_seats"])
    seats = []
    for s in F["seats"]:
        slug = s["slug"]
        mp_name, mp_party, mp_note = CURRENT_MP.get(slug, (nice_name(s["winner_2022"]["name"]), s["winner_2022"]["party"], None))
        pm = pend.get(slug, {})
        seats.append({
            "slug": slug, "name": s["name"].replace("South-West", "South-West"),
            "region": "regional" if slug in regional else "metro",
            "mp": {"name": mp_name, "party": mp_party, "note": mp_note, "retiring": slug in retiring},
            "held_2022": s["winner_2022"]["party"],
            "margin": {"value": pm.get("margin", s["margin_2022"]), "vs": pm.get("vs") or s["runner_up_2022"]["party"],
                       "source": "Tally Room" if pm else "VEC 2022"},
            "primaries_2022": [{**c, "name": nice_name(c["name"])} for c in s["primaries_2022"]],
            "final_two_2022": [nice_name(s["winner_2022"]["name"]), nice_name(s["runner_up_2022"]["name"])],
            "ind_assumed": nice_name(s["ind_2026_assumed"]) if s["ind_2026_assumed"] else None,
            "note": s.get("note"),
            "on_federal_2025": fed.get(slug, {}).get("on_share"),
            "model": {"win": s["win_prob"], "outright": s["outright_prob"], "pairs": s["final_pairs"],
                      "primaries": s["primaries_2026"], "sim": s["sim"], "trace": s["trace"]},
        })
    out = {"generated": F["generated"], "simulations": F["simulations"], "inputs": F["statewide_inputs"],
           "summary": F["summary"], "distribution": F["seat_distribution"], "flows_base": F["flows_base"],
           "drivers": {"flows": cfg["flows"]}, "party_names": F["party_names"], "markets": MARKETS,
           "election_date": "2026-11-28", "seats": seats,
           "parties": party_profiles(seats, F)}
    dest = ROOT / "site/data/forecast.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {dest} ({dest.stat().st_size // 1024} KB), {len(seats)} seats, margins from pendulum: {sum(1 for x in seats if x['margin']['source']=='Tally Room')}")


if __name__ == "__main__":
    main()
