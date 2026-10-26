"""After each model run: append to the run log and write what changed since the previous run.

  data/vic2026/runs.json     one entry per model run (inputs, polls used, headline numbers, each seat's favourite)
  site/data/changes.json     latest v previous run (new polls, input moves, odds moves, seats that changed favourite)
                             + every published poll, marked if it's in the current average
Backfill from git history: python vic2026/build/run_log.py --backfill <commit> [<commit> ...]
"""
import csv
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUNS = ROOT / "data/vic2026/runs.json"


def entry(F, avg, when=None):
    s = F["summary"]
    return {
        "run_at": when or datetime.now(timezone.utc).isoformat(timespec="minutes"),
        "generated": F["generated"],
        "inputs": F.get("inputs") or F.get("statewide_inputs"),
        "polls": avg.get("included_poll_ids", []),
        "poll_as_of": avg.get("as_of"),
        "summary": {"lnp_maj": round(s["p_lnp_majority"], 3), "alp_maj": round(s["p_alp_majority"], 3), "hung": round(s["p_hung"], 3),
                    "seats": {k: s["seats"][k]["p50"] for k in ("LNP", "ALP", "ON", "GRN", "IND") if k in s["seats"]}},
        "fav": {x["slug"]: max(x["model"]["win"].items(), key=lambda kv: kv[1]) for x in F["seats"]},
        "known": [p["id"] for p in polls()] if when is None else None,
    }


def git_json(commit, path):
    return json.loads(subprocess.run(["git", "show", f"{commit}:{path}"], cwd=ROOT, capture_output=True, text=True, check=True).stdout)


def polls():
    out = []
    with open(ROOT / "data/raw/polls/et_polls.csv", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            out.append({"id": r["id"], "pollster": r["pollster"], "commissioner": r["commissioner"], "start": r["fieldwork_start"],
                        "end": r["fieldwork_end"], "n": r["sample_size"],
                        "alp": r["alp"], "lnp": r["lnp"], "on": r["onp"], "grn": r["grn"], "oth": r["others"], "url": r["source_url"]})
    return sorted(out, key=lambda p: p["end"], reverse=True)


def changes(runs):
    cur = runs[-1]
    prev = next((r for r in reversed(runs[:-1]) if r["inputs"] != cur["inputs"] or r["fav"] != cur["fav"]), runs[-2] if len(runs) > 1 else None)
    out = {"latest": {**{k: cur[k] for k in ("run_at", "generated", "inputs", "summary", "poll_as_of")}, "note": cur.get("note")}, "previous": None,
           "new_polls": [], "dropped_polls": [], "flips": [], "history": [{"run_at": r["run_at"], **r["summary"]} for r in runs]}
    if prev:
        out["previous"] = {k: prev[k] for k in ("run_at", "generated", "inputs", "summary")}
        allp = polls()
        known = set(prev.get("known") or [q["id"] for q in allp if q["end"] <= (prev.get("poll_as_of") or "")] + prev["polls"])
        out["new_polls"] = [q["id"] for q in allp if q["id"] not in known]
        out["dropped_polls"] = []
        for slug, (p, v) in cur["fav"].items():
            q, w = prev["fav"].get(slug, (None, 0))
            if p != q or abs(v - w) >= 0.15:
                out["flips"].append({"slug": slug, "from": [q, round(w, 2)], "to": [p, round(v, 2)]})
        out["flips"].sort(key=lambda f: -abs(f["to"][1] - (f["from"][1] if f["from"][0] == f["to"][0] else 0)))
    current = set(cur["polls"])
    out["polls"] = [{**p, "in_average": p["id"] in current} for p in polls()]
    return out


def main():
    runs = json.loads(RUNS.read_text()) if RUNS.exists() else []
    if len(sys.argv) > 2 and sys.argv[1] == "--backfill":
        for c in sys.argv[2:]:
            when = subprocess.run(["git", "log", "-1", "--format=%cI", c], cwd=ROOT, capture_output=True, text=True).stdout.strip()
            runs.append(entry(git_json(c, "site/data/forecast.json"), git_json(c, "data/raw/polls/et_poll-average.json"), when))
    else:
        F = json.loads((ROOT / "site/data/forecast.json").read_text())
        avg = json.loads((ROOT / "data/vic2026/poll_average.json").read_text())
        e = entry(F, avg)
        if "--note" in sys.argv:
            e["note"] = sys.argv[sys.argv.index("--note") + 1]
        if runs and runs[-1]["inputs"] == e["inputs"] and runs[-1]["fav"] == e["fav"] and runs[-1]["generated"] == e["generated"]:
            runs[-1]["run_at"] = e["run_at"]
        else:
            runs.append(e)
    RUNS.write_text(json.dumps(runs, separators=(",", ":")))
    ch = changes(runs)
    (ROOT / "site/data/changes.json").write_text(json.dumps(ch, separators=(",", ":")))
    print(len(runs), "runs; new polls:", ch["new_polls"], "; flips:", len(ch["flips"]))


if __name__ == "__main__":
    main()
