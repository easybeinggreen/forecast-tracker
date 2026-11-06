"""Sportsbet statewide markets -> site/data/sportsbet_state.json (history, latest odds, fair chances, model chances).

Snapshots: data/raw/sportsbet_state/<stamp>.json, taken on request with "update odds" (never on a schedule).
Model chances come from the simulation's seat counts (data/vic2026/forecast.json):
  who is sworn in = the larger of Coalition and Labor (a hung parliament usually goes to the largest bloc; an
  approximation: crossbench deals can go the other way), majority = 45+ seats, seat totals from the seat distribution.
"""
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data/raw/sportsbet_state"

MARKETS = {
    "state-govt": {"name": "Sworn-in government", "labels": {"COAL": "Coalition", "ALP": "Labor", "OTH": "Any other"}},
    "state-type": {"name": "Type of government formed", "labels": {"COAL_MAJ": "Coalition majority", "COAL_MIN": "Coalition minority",
                   "ALP_MAJ": "Labor majority", "ALP_MIN": "Labor minority", "OTH": "Any other result"}},
    "state-hung": {"name": "Hung parliament?", "labels": {"YES": "Hung parliament", "NO": "Not hung"}},
    "state-coal-seats": {"name": "Coalition seats", "party": "LNP"},
    "state-alp-seats": {"name": "Labor seats", "party": "ALP"},
    "state-on-seats": {"name": "One Nation seats", "party": "ON"},
    "state-grn-seats": {"name": "Greens seats", "party": "GRN"},
}


def model_probs(F, key, line=None):
    s, d = F["summary"], F["seat_distribution"]
    if key == "state-govt":
        return {"COAL": s["p_lnp_largest"], "ALP": s["p_alp_largest"], "OTH": max(0.0, 1 - s["p_lnp_largest"] - s["p_alp_largest"])}
    if key == "state-type":
        cm, am = s["p_lnp_majority"], s["p_alp_majority"]
        cmin, amin = max(0.0, s["p_lnp_largest"] - cm), max(0.0, s["p_alp_largest"] - am)
        return {"COAL_MAJ": cm, "COAL_MIN": cmin, "ALP_MAJ": am, "ALP_MIN": amin, "OTH": max(0.0, 1 - cm - cmin - am - amin)}
    if key == "state-hung":
        return {"YES": s["p_hung"], "NO": 1 - s["p_hung"]}
    v = np.array(d[MARKETS[key]["party"]], dtype=float)
    over = float(v[int(line) + 1:].sum() / v.sum())
    return {"OVER": over, "UNDER": 1 - over}


def build():
    snaps = [json.loads(p.read_text()) for p in sorted(RAW.glob("*.json"))]
    if not snaps:
        return None
    F = json.loads((ROOT / "data/vic2026/forecast.json").read_text())
    out = {"markets": {}, "as_of": snaps[-1]["t"]}
    for key, meta in MARKETS.items():
        hist = [{"t": s["t"], "odds": s["markets"][key], "line": s.get("lines", {}).get(key)} for s in snaps if key in s.get("markets", {})]
        if not hist:
            continue
        L = hist[-1]
        book = sum(1 / o for o in L["odds"].values())
        labels = dict(meta.get("labels") or {})
        if L["line"] is not None:
            labels = {"OVER": f"Over {L['line']}", "UNDER": f"Under {L['line']}"}
        out["markets"][key] = {
            "name": meta["name"] + (f" over/under {L['line']}" if L["line"] is not None else ""), "labels": labels, "line": L["line"],
            "latest": {"t": L["t"], "odds": L["odds"], "fair": {k: (1 / o) / book for k, o in L["odds"].items()}, "margin": book - 1},
            "model": {k: round(v, 4) for k, v in model_probs(F, key, L["line"]).items()},
            "history": hist,
        }
    (ROOT / "site/data/sportsbet_state.json").write_text(json.dumps(out, separators=(",", ":")))
    return out


if __name__ == "__main__":
    o = build()
    for k, m in o["markets"].items():
        print(m["name"], {x: (m["latest"]["odds"][x], round(m["latest"]["fair"][x], 2), round(m["model"][x], 2)) for x in m["latest"]["odds"]})
