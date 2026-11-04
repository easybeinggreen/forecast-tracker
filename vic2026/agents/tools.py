"""Tools for the Count Room agents (see agents/RULES.md).

  python -m vic2026.agents.tools brief <agent>          what the agent can see: dashboard data summary + its own open bets
  python -m vic2026.agents.tools place <agent> <file>   validate a JSON list of calls and append them to its ledger
  python -m vic2026.agents.tools referee [<from> <to>]  check every agent ledger against the rules (and git history)

Ledger: data/agents/<agent>/calls.jsonl, one JSON object per line, append-only. Each line carries the hash of the line
before it, so any edit or deletion breaks the chain.
"""
import hashlib
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AGENTS = {"local": 1.0, "numbers": 0.25, "market": 0.5}     # agent -> Kelly limit
BUDGET = 2000
SITE = ROOT / "site/data"
SB_RAW = ROOT / "data/raw/sportsbet"


def ledger(agent):
    return ROOT / "data/agents" / agent / "calls.jsonl"


def read_calls(agent, text=None):
    if text is None:
        f = ledger(agent)
        text = f.read_text(encoding="utf-8") if f.exists() else ""
    return [json.loads(l) for l in text.splitlines() if l.strip()]


def line_hash(line):
    return hashlib.sha256(line.encode("utf-8")).hexdigest()[:16]


def latest_snapshot():
    f = sorted(SB_RAW.glob("*.json"))[-1]
    return f.stem, json.loads(f.read_text())["seats"]


def kelly(p, odds):
    return max(0.0, (p * odds - 1) / (odds - 1)) if odds > 1 else 0.0


def check_call(c, agent, snaps, spent):
    """Return a list of rule problems for one call (empty = fine). `snaps` maps snapshot stem -> seats."""
    errs = []
    seats = snaps.get(c.get("snapshot"))
    if seats is None:
        return [f"unknown snapshot {c.get('snapshot')}"]
    s = c.get("seat")
    if s not in seats:
        return [f"unknown seat {s}"]
    odds = seats[s]
    probs = c.get("probs") or {}
    if set(probs) - set(odds):
        errs.append(f"{s}: chances given for outcomes Sportsbet doesn't list: {sorted(set(probs) - set(odds))}")
    if any((not isinstance(v, (int, float))) or v < 0 or v > 1 for v in probs.values()):
        errs.append(f"{s}: chances must be between 0 and 1")
    elif abs(sum(probs.values()) - 1) > 0.011:
        errs.append(f"{s}: chances add to {sum(probs.values()):.3f}, not 1")
    ft = c.get("final_two")
    if not (isinstance(ft, list) and len(ft) == 2):
        errs.append(f"{s}: final_two must name two outcomes")
    stake = c.get("stake", 0)
    if not isinstance(stake, (int, float)) or stake < 0:
        errs.append(f"{s}: stake must be zero or more")
    elif stake > 0:
        b = c.get("backed")
        if b not in odds or b not in probs:
            errs.append(f"{s}: backed outcome {b} has no odds or no chance")
        else:
            if abs(c.get("odds", 0) - odds[b]) > 1e-9:
                errs.append(f"{s}: odds {c.get('odds')} don't match snapshot {odds[b]}")
            if probs[b] * odds[b] <= 1:
                errs.append(f"{s}: no edge (chance {probs[b]:.2f} × odds {odds[b]} ≤ 1)")
            cap = AGENTS[agent] * kelly(probs[b], odds[b]) * BUDGET
            if stake > cap + 0.5:
                errs.append(f"{s}: stake {stake} above Kelly limit {cap:.0f}")
        if not (c.get("reason") or "").strip():
            errs.append(f"{s}: a stake needs a reason")
        if spent + stake > BUDGET:
            errs.append(f"{s}: stake takes total over {BUDGET} points")
    return errs


def brief(agent):
    F = json.loads((SITE / "forecast.json").read_text())
    sb = json.loads((SITE / "sportsbet.json").read_text())["seats"]
    calls = read_calls(agent)
    mine = {}
    for c in calls:
        mine.setdefault(c["seat"], []).append(c)
    spent = sum(c.get("stake", 0) for c in calls)
    stem, _ = latest_snapshot()
    pa = F.get("poll_avg") or {}
    print(f"Agent: {agent}  Kelly limit {AGENTS[agent]}  points staked {spent:.0f} of {BUDGET}  calls so far {len(calls)}")
    print(f"Latest Sportsbet snapshot: {stem}  Model version {F.get('model_version')}  Poll average {pa.get('primaries')} (as of {pa.get('as_of')})")
    print(f"Statewide model: Coalition majority {F['summary']['p_lnp_majority']:.0%}, hung {F['summary']['p_hung']:.0%}, Labor majority {F['summary']['p_alp_majority']:.0%}")
    print("Seat | held | margin 2022 | model (top 3) | Sportsbet now (prev) | your last call")
    for s in sorted(F["seats"], key=lambda x: x["name"]):
        d = sb.get(s["slug"], {})
        h = d.get("history", [])
        now = h[-1]["odds"] if h else {}
        prev = h[-2]["odds"] if len(h) > 1 else {}
        mv = ", ".join(f"{k} {v:.2f}" + (f" ({prev[k]:.2f})" if prev.get(k) not in (None, v) else "") for k, v in sorted(now.items(), key=lambda kv: kv[1]))
        top = ", ".join(f"{k} {v:.0%}" for k, v in sorted(s["model"]["win"].items(), key=lambda kv: -kv[1])[:3])
        last = mine.get(s["slug"], [])
        lc = f"{last[-1]['probs']} staked {sum(c.get('stake', 0) for c in last):.0f}" if last else "—"
        print(f"{s['slug']} | {s['mp']['party']}{' (retiring)' if s['mp'].get('retiring') else ''} | {s['margin']['value']} v {s['margin']['vs']} | {top} | {mv} | {lc}")
    print("\nFull detail per seat (profile, candidates, coverage, booths) is in site/data/forecast.json and site/data/booths/<seat>.json.")


def place(agent, path):
    if agent not in AGENTS:
        sys.exit(f"unknown agent {agent}")
    new = json.loads(Path(path).read_text())
    if isinstance(new, dict):
        new = [new]
    stem, seats = latest_snapshot()
    calls = read_calls(agent)
    spent = sum(c.get("stake", 0) for c in calls)
    f = ledger(agent)
    f.parent.mkdir(parents=True, exist_ok=True)
    text = f.read_text(encoding="utf-8") if f.exists() else ""
    prev = line_hash(text.splitlines()[-1]) if text.strip() else "genesis"
    n0 = len(calls)
    out, problems = [], []
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for i, c in enumerate(new):
        c = {k: c.get(k) for k in ("seat", "probs", "final_two", "backed", "stake", "reason", "gut", "sources")}
        c["stake"] = round(float(c.get("stake") or 0), 2)
        c["sources"] = c.get("sources") or []
        c.update({"agent": agent, "n": n0 + len(out) + 1, "t": now, "snapshot": stem,
                  "odds": seats.get(c["seat"], {}).get(c.get("backed")) if c["stake"] > 0 else None})
        errs = check_call(c, agent, {stem: seats}, spent)
        if errs:
            problems += [f"call {i + 1}: {e}" for e in errs]
            continue
        spent += c["stake"]
        c["prev"] = prev
        line = json.dumps(c, ensure_ascii=False, sort_keys=True)
        prev = line_hash(line)
        out.append(line)
    if problems:
        print("Rejected (nothing written):\n  " + "\n  ".join(problems))
        sys.exit(1)
    with f.open("a", encoding="utf-8") as fh:
        for line in out:
            fh.write(line + "\n")
    print(f"Placed {len(out)} calls for {agent}; points staked {spent:.0f} of {BUDGET}.")


def git(*a):
    return subprocess.run(["git", *a], cwd=ROOT, capture_output=True, text=True).stdout


def referee(rev_from=None, rev_to="HEAD"):
    """Check every ledger. With a git range, also check append-only and that agent commits touched only their folder."""
    problems = []
    snaps = {p.stem: json.loads(p.read_text())["seats"] for p in SB_RAW.glob("*.json")}
    for agent in AGENTS:
        f = ledger(agent)
        if not f.exists():
            continue
        lines = [l for l in f.read_text(encoding="utf-8").splitlines() if l.strip()]
        prev, spent, last_t = "genesis", 0.0, ""
        for i, l in enumerate(lines, 1):
            try:
                c = json.loads(l)
            except ValueError:
                problems.append(f"{agent}: line {i} isn't valid JSON"); continue
            if c.get("agent") != agent or c.get("n") != i:
                problems.append(f"{agent}: line {i} has wrong agent or number")
            if c.get("prev") != prev:
                problems.append(f"{agent}: line {i} breaks the hash chain (an earlier line was changed or removed)")
            if (c.get("t") or "") < last_t:
                problems.append(f"{agent}: line {i} is dated before the line above it")
            for e in check_call(c, agent, snaps, spent):
                problems.append(f"{agent}: line {i}: {e}")
            spent += c.get("stake") or 0
            prev, last_t = line_hash(l), c.get("t") or last_t
    if rev_from:
        for sha in git("rev-list", f"{rev_from}..{rev_to}").split():
            msg = git("log", "-1", "--format=%s", sha).strip()
            files = [x for x in git("diff-tree", "--no-commit-id", "--name-only", "-r", sha).split() if x]
            touched_agents = {x.split("/")[2] for x in files if x.startswith("data/agents/")}
            if msg.startswith("agent:"):
                me = msg.split()[0].split(":", 1)[1]
                bad = [x for x in files if not x.startswith(f"data/agents/{me}/")]
                if bad:
                    problems.append(f"{me}: commit {sha[:7]} changed files outside its folder: {bad[:5]}")
            elif touched_agents and not msg.startswith("referee:"):
                problems.append(f"commit {sha[:7]} ('{msg[:40]}') changed agent ledgers but isn't an agent commit")
            for a in touched_agents:
                old = git("show", f"{sha}^:data/agents/{a}/calls.jsonl")
                new = git("show", f"{sha}:data/agents/{a}/calls.jsonl")
                if old and not new.startswith(old):
                    problems.append(f"{a}: commit {sha[:7]} changed or removed earlier calls")
    return problems


def status():
    """Public status line for the dashboard: no picks, no stakes, no scores."""
    out = {"agents": []}
    for agent in AGENTS:
        calls = read_calls(agent)
        out["agents"].append({"name": agent, "last_run": calls[-1]["t"] if calls else None})
    (SITE / "agents_status.json").write_text(json.dumps(out))
    return out


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "brief":
        brief(sys.argv[2])
    elif cmd == "place":
        place(sys.argv[2], sys.argv[3])
    elif cmd == "referee":
        p = referee(*sys.argv[2:4]) if len(sys.argv) > 2 else referee()
        print("\n".join(p) if p else "referee: all ledgers within the rules")
        sys.exit(1 if p else 0)
    elif cmd == "status":
        print(status())
    else:
        sys.exit(__doc__)
