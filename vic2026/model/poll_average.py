"""Our own Victorian poll average: smoother and less swayed by any single pollster.

Steps
  1. Every poll since the start of the year, weighted by sample size (design effect 1.3) and age
     (half-life 30 days; nothing older than 120 days counts toward today's figure).
  2. House effects: each pollster's average lean against the trend line, shrunk toward zero when it
     has few polls (lean x k / (k + 2)), then removed from that pollster's numbers.
  3. Pollster balance: a pollster's combined weight is capped at 1.5x a single fresh full-size poll,
     so one firm polling often (or one new poll) can't dominate.
  4. A trend line on every poll date for the dashboard chart.
Output: data/vic2026/poll_average.json  {as_of, primaries, trend, polls[{id, weight, house, adjusted}]}
"""
import csv
import json
import math
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
KEYS = ["alp", "lnp", "onp", "grn", "others"]
HALF_LIFE, WINDOW, DEFF, CAP, SHRINK = 30.0, 120, 1.3, 1.5, 2.0


def load():
    out = []
    with open(ROOT / "data/raw/polls/et_polls.csv", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            if r.get("eligible_for_average", "true") != "true":
                continue
            v = {k: float(r[k]) for k in KEYS if r[k] not in ("", None)}
            if len(v) < 5:
                continue
            tot = sum(v.values())
            out.append({"id": r["id"], "pollster": r["pollster"], "end": r["fieldwork_end"], "n": float(r["sample_size"] or 1000),
                        "v": {k: 100 * v[k] / tot for k in KEYS}})
    return sorted(out, key=lambda p: p["end"])


def average(polls, at, house=None, cap=True):
    """Weighted average as at date `at` (only polls finished by then)."""
    t = date.fromisoformat(at)
    w = {}
    for p in polls:
        age = (t - date.fromisoformat(p["end"])).days
        if age < 0 or age > WINDOW:
            continue
        w[p["id"]] = (p["n"] / DEFF / 1000) ** 0.5 * 0.5 ** (age / HALF_LIFE)
    if not w:
        return None, {}
    if cap:  # pollster balance
        by = {}
        for p in polls:
            if p["id"] in w:
                by.setdefault(p["pollster"], []).append(p["id"])
        for ids in by.values():
            s = sum(w[i] for i in ids)
            if s > CAP:
                for i in ids:
                    w[i] *= CAP / s
    tot = sum(w.values())
    est = {}
    for k in KEYS:
        est[k] = sum(w[p["id"]] * (p["v"][k] - (house or {}).get(p["pollster"], {}).get(k, 0)) for p in polls if p["id"] in w) / tot
    s = sum(est.values())
    return {k: 100 * v / s for k, v in est.items()}, {i: x / tot for i, x in w.items()}


def main(as_of=None):
    polls = load()
    as_of = as_of or date.today().isoformat()
    house = {}
    for _ in range(4):  # trend -> residuals -> house effects -> trend again
        resid = {}
        for p in polls:
            trend, _ = average([q for q in polls if q["id"] != p["id"]], p["end"], house)
            if trend is None:
                continue
            adj = house.get(p["pollster"], {})
            for k in KEYS:
                resid.setdefault(p["pollster"], {}).setdefault(k, []).append(p["v"][k] - trend[k])
        house = {}
        for f, d in resid.items():
            n = len(next(iter(d.values())))
            raw = {k: sum(v) / len(v) for k, v in d.items()}
            mean_k = {k: raw[k] * n / (n + SHRINK) for k in KEYS}
            house[f] = mean_k
        # house effects should sum to ~0 across pollsters (no net shift)
        for k in KEYS:
            m = sum(h[k] for h in house.values()) / len(house)
            for h in house.values():
                h[k] -= m
    est, w = average(polls, as_of, house)
    raw_est, _ = average(polls, as_of, None, cap=False)
    trend = []
    for d in sorted({p["end"] for p in polls}):
        e, _ = average(polls, d, house)
        trend.append({"date": d, **{k: round(v, 2) for k, v in e.items()}})
    out = {
        "as_of": as_of, "method": "recency- and size-weighted, house-effect adjusted, pollster-capped",
        "params": {"half_life_days": HALF_LIFE, "window_days": WINDOW, "pollster_cap": CAP, "house_shrink": SHRINK},
        "primaries": {k: round(v, 1) for k, v in est.items()},
        "unsmoothed": {k: round(v, 1) for k, v in raw_est.items()},
        "house": {f: {k: round(v, 2) for k, v in h.items()} for f, h in house.items()},
        "polls": [{"id": p["id"], "pollster": p["pollster"], "end": p["end"], "weight": round(w.get(p["id"], 0), 3),
                   "house": {k: round(house.get(p["pollster"], {}).get(k, 0), 2) for k in KEYS}} for p in polls],
        "included_poll_ids": [i for i, x in sorted(w.items(), key=lambda kv: -kv[1]) if x > 0.01],
        "trend": trend,
    }
    (ROOT / "data/vic2026/poll_average.json").write_text(json.dumps(out, indent=1))
    return out


if __name__ == "__main__":
    o = main()
    print("as of", o["as_of"], "->", o["primaries"])
    print("unsmoothed (no house/cap):", o["unsmoothed"])
    print("house effects:", {f: {k: v for k, v in h.items() if abs(v) >= 0.5} for f, h in o["house"].items()})
    print("weights:", [(p["id"], p["weight"]) for p in o["polls"] if p["weight"] > 0.01])
    for d in ["2026-10-12", "2026-10-21", "2026-10-23"]:
        print(d, main(d)["primaries"])
    main()
