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
    out = f"{given} {sur.title() if sur.isupper() else sur}".replace("Mcl", "McL")
    out = re.sub(r"\b([OD])'([a-z])", lambda m: f"{m.group(1)}'{m.group(2).upper()}", out)
    return re.sub(r"\s+", " ", out).strip()


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


def place_info(slug, s, h, demo, topics, mp):
    from urllib.parse import quote_plus
    name = s["name"]
    members = (h or {}).get("members") or []
    if not members or members[-1]["to"] is not None:
        members = members + [{"name": nice_name(s["winner_2022"]["name"]), "party": s["winner_2022"]["party"], "from": 2022, "to": None}]
    tr = (h or {}).get("tallyroom") or {}
    links = [
        {"label": "The Tally Room seat guide", "url": tr.get("url") or f"https://www.tallyroom.com.au/vic2026/{slug.replace('-', '')}2026", "note": "analysis, booth maps, active comments"},
        {"label": "Wikipedia", "url": (h or {}).get("wiki") or f"https://en.wikipedia.org/wiki/Special:Search?search=Electoral+district+of+{quote_plus(name)}", "note": "history and past results"},
        {"label": "Reddit", "url": f"https://www.reddit.com/search/?q={quote_plus(chr(34) + name + chr(34) + ' election')}&sort=new", "note": "local discussion"},
        {"label": "X (Twitter)", "url": f"https://x.com/search?q={quote_plus(chr(34) + name + chr(34) + ' (election OR candidate OR vote)')}&f=live", "note": "latest posts"},
        {"label": "Facebook", "url": f"https://www.facebook.com/search/posts/?q={quote_plus(name + ' election')}", "note": "candidate pages and local groups"},
        {"label": "Google News", "url": f"https://news.google.com/search?q={quote_plus(chr(34) + name + chr(34) + ' Victorian election')}&hl=en-AU&gl=AU&ceid=AU:en"},
    ]
    if mp and not mp.startswith("Vacant"):
        links.insert(2, {"label": f"{mp} on Wikipedia", "url": f"https://en.wikipedia.org/wiki/Special:Search?search={quote_plus(mp + ' Victorian politician')}"})
    return {
        "place": {"blurb": (h or {}).get("blurb"), "created": (h or {}).get("created"), "demographic": (h or {}).get("demographic"),
                  "assessment": tr.get("assessment"), "tr_url": tr.get("url")},
        "candidates_2026": (tr.get("cands") or []) + [c for c in EXTRA_CANDIDATES.get(slug, []) if c["name"] not in {x["name"] for x in tr.get("cands") or []}],
        "history": {"members": members},
        "demo": demo["seats"].get(slug), "demo_vic": demo.get("vic"),
        "topics": topics.get(slug, []), "links": links,
    }


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


# Candidates reported in local coverage but not yet on the Tally Room list (source in "src")
EXTRA_CANDIDATES = {
    "bass": [{"name": "Nikole Schellekens", "party": "One Nation", "src": "San Remo/Phillip Island SGST, 2 Sep 2026"}],
}


def main():
    F = json.loads((ROOT / "data/vic2026/forecast.json").read_text())
    cfg = yaml.safe_load((ROOT / "vic2026/config/drivers.yaml").read_text())
    pend = pendulum()
    fedp = ROOT / "data/vic2026/on_federal2025.json"
    fed = json.loads(fedp.read_text())["seats"] if fedp.exists() else {}
    retiring = {s: p for p, ss in cfg["retiring"].items() for s in ss}
    hist = json.loads((ROOT / "data/vic2026/history.json").read_text()) if (ROOT / "data/vic2026/history.json").exists() else {}
    demo = json.loads((ROOT / "data/vic2026/demographics.json").read_text()) if (ROOT / "data/vic2026/demographics.json").exists() else {"seats": {}, "vic": None}
    newsp = ROOT / "site/data/news.json"
    topics = json.loads(newsp.read_text()).get("topics", {}) if newsp.exists() else {}
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
            "fed2025": {"prims": fed.get(slug, {}).get("prims"), "alp_tpp": fed.get(slug, {}).get("alp_tpp")} if slug in fed else None,
            "model": {"win": s["win_prob"], "outright": s["outright_prob"], "pairs": s["final_pairs"],
                      "primaries": s["primaries_2026"], "sim": s["sim"], "trace": s["trace"]},
            "why": s.get("why"),
            **place_info(slug, s, hist.get(slug), demo, topics, mp_name),
        })
    tot = sum(v["formal"] for v in fed.values()) or 1
    fed_vic = {"prims": {}, "alp_tpp": None}
    for v in fed.values():
        for g, x in (v.get("prims") or {}).items():
            fed_vic["prims"][g] = fed_vic["prims"].get(g, 0) + x * v["formal"] / tot
    fed_vic["prims"] = {g: round(x, 1) for g, x in fed_vic["prims"].items()}
    tw = [(v["alp_tpp"], v["formal"]) for v in fed.values() if v.get("alp_tpp") is not None]
    fed_vic["alp_tpp"] = round(sum(a * w for a, w in tw) / sum(w for _, w in tw), 1) if tw else None
    rp = ROOT / "vic2026/config/research.yaml"
    research = yaml.safe_load(rp.read_text()) if rp.exists() else []
    by_seat, by_party = {}, {}
    for a in research:
        ref = {k: a.get(k) for k in ("title", "source", "author", "date", "url", "paywalled")}
        for ins in a.get("insights", []):
            for s in ins.get("seats", []) or []:
                by_seat.setdefault(s, []).append({**ref, "text": ins["text"]})
            for pcode in ins.get("parties", []) or []:
                by_party.setdefault(pcode, []).append({**ref, "text": ins["text"]})
    bp = ROOT / "data/vic2026/byelections.json"
    byel = json.loads(bp.read_text()) if bp.exists() else {}
    from vic2026.model.flows import GROUP_OF
    from vic2026.model.flows import GROUP_OF
    qp = ROOT / "vic2026/config/questions.yaml"
    questions = yaml.safe_load(qp.read_text()) if qp.exists() else {}
    for s in seats:
        s["research"] = by_seat.get(s["slug"], [])
        g22 = {}
        for c in s["primaries_2022"]:
            g = GROUP_OF.get(c["party"], "OTH")
            g22[g] = round(g22.get(g, 0) + c["pct"], 1)
        s["prims_2022_grouped"] = g22
        if questions.get(s["slug"]):
            s["questions"] = questions[s["slug"]]
        b = byel.get(s["slug"])
        if b:
            base = {}
            for c in s["primaries_2022"]:
                g = GROUP_OF.get(c["party"], "OTH")
                base[g] = round(base.get(g, 0) + c["pct"], 1)
            s["byelection"] = {**b, "base_2022": base}
    pa = json.loads((ROOT / "data/vic2026/poll_average.json").read_text()) if (ROOT / "data/vic2026/poll_average.json").exists() else None
    eta = json.loads((ROOT / "data/raw/polls/et_poll-average.json").read_text())
    poll_avg = pa and {"as_of": pa["as_of"], "primaries": pa["primaries"], "house": pa["house"], "params": pa["params"],
                       "weights": {q["id"]: q["weight"] for q in pa["polls"]}, "trend": pa["trend"],
                       "election_tracker": eta.get("primaries"), "et_as_of": eta.get("as_of")}
    out = {"generated": F["generated"], "model_version": cfg.get("model_version", "1.0"), "poll_avg": poll_avg, "research": research, "research_by_party": by_party, "fed2025_vic": fed_vic, "simulations": F["simulations"], "inputs": F["statewide_inputs"],
           "summary": F["summary"], "why_statewide": F.get("why_statewide"), "distribution": F["seat_distribution"], "flows_base": F["flows_base"],
           "drivers": {"flows": cfg["flows"]}, "party_names": F["party_names"], "markets": MARKETS,
           "election_date": "2026-11-28", "seats": seats,
           "parties": party_profiles(seats, F)}
    dest = ROOT / "site/data/forecast.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {dest} ({dest.stat().st_size // 1024} KB), {len(seats)} seats, margins from pendulum: {sum(1 for x in seats if x['margin']['source']=='Tally Room')}")


if __name__ == "__main__":
    main()
