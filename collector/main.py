"""Daily run: sync config -> collect crowd odds, EDGAR filings, news volume -> write to Postgres (Neon).

  python -m collector.main            # writes to Postgres/Neon (needs DATABASE_URL)
  python -m collector.main --dry-run  # fetch only, write out/run.json

Exit code 1 if any source failed, so a broken feed shows up as a failed run.
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml

from . import sources as src
from .http import session

ROOT = Path(__file__).resolve().parent.parent


def load_config():
    return yaml.safe_load((ROOT / "config.yaml").read_text(encoding="utf-8"))


def collect(cfg, s):
    """Fetch everything. Returns (results, errors)."""
    res = {"snapshots": [], "filings": [], "news": []}
    errors = []
    soft = []  # news volume is nice-to-have: warn, but don't fail the run
    token = os.environ.get("METACULUS_TOKEN")

    for q in cfg["questions"]:
        for so in q.get("sources", []):
            key = (so["platform"], str(so["id"]))
            try:
                if so["platform"] == "manifold":
                    rows = src.manifold(s, so["id"])
                elif so["platform"] == "polymarket":
                    rows = src.polymarket(s, so["id"])
                elif so["platform"] == "metaculus":
                    if not token:
                        continue
                    rows = src.metaculus(s, so["id"], token)
                else:
                    raise ValueError(f"unknown platform {so['platform']}")
                for r in rows:
                    res["snapshots"].append({"question_id": q["id"], "platform": key[0], "external_id": key[1], **r})
            except Exception as e:  # noqa: BLE001 - keep going, report at the end
                errors.append(f"{key[0]}:{key[1]} -> {e}")

    ed = cfg.get("edgar") or {}
    if ed:
        try:
            res["filings"] = src.edgar_filings(s, ed["companies"], ed["forms"])
        except Exception as e:  # noqa: BLE001
            errors.append(f"edgar -> {e}")

    gd = cfg.get("gdelt") or {}
    for qy in gd.get("queries", []):
        try:
            res["news"] += src.gdelt_volume(s, qy, gd.get("timespan", "14d"))
        except Exception as e:  # noqa: BLE001
            soft.append(f"gdelt '{qy}' -> {e}")
    return res, errors, soft


def sync_and_write(cfg, res):
    from .db import DB
    db = DB()
    today = datetime.now(timezone.utc).date().isoformat()

    db.upsert("questions", [{
        "id": q["id"], "title": q["title"], "kind": q["kind"], "outcomes": q.get("outcomes"),
        "resolution": q.get("resolution"), "close_date": str(q["close_date"]) if q.get("close_date") else None,
    } for q in cfg["questions"]], "id")

    src_rows = [{"question_id": q["id"], "platform": so["platform"], "external_id": str(so["id"]), "url": so.get("url")}
                for q in cfg["questions"] for so in q.get("sources", [])]
    saved = db.upsert("sources", src_rows, "platform,external_id", returning=True)
    ids = {(r["platform"], r["external_id"]): r["id"] for r in saved}

    db.upsert("forecasts", [{
        "question_id": q["id"], "made_on": str(f["date"]), "outcome": str(o), "probability": p, "rationale": f.get("rationale"),
    } for q in cfg["questions"] for f in q.get("my_forecasts", []) for o, p in f["probabilities"].items()],
        "question_id,made_on,outcome")

    db.upsert("snapshots", [{
        "source_id": ids[(r["platform"], r["external_id"])], "captured_on": today, "outcome": r["outcome"],
        "probability": round(float(r["probability"]), 5), "volume": r.get("volume"), "traders": r.get("traders"),
    } for r in res["snapshots"]], "source_id,captured_on,outcome")

    known = {r["accession_no"] for r in db.select("filings", "accession_no")}
    new = [f for f in res["filings"] if f["accession_no"] not in known]
    db.upsert("filings", res["filings"], "accession_no")
    db.upsert("news_volume", [dict(r, source="gdelt") for r in res["news"]], "query,day,source")
    return new


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    cfg = load_config()
    res, errors, soft = collect(cfg, session())
    dry = args.dry_run or not os.environ.get("DATABASE_URL")

    out = ROOT / "out"
    out.mkdir(exist_ok=True)
    (out / "run.json").write_text(json.dumps({"results": res, "errors": errors, "soft": soft}, indent=2, default=str), encoding="utf-8")

    new = [] if dry else sync_and_write(cfg, res)
    (out / "new_filings.json").write_text(json.dumps(new, indent=2), encoding="utf-8")

    lines = [f"Mode: {'DRY RUN (nothing written)' if dry else 'Postgres'}",
             f"Crowd readings: {len(res['snapshots'])}", f"EDGAR filings matched: {len(res['filings'])} (new: {len(new)})",
             f"News-volume days: {len(res['news'])}", f"Errors: {len(errors)}"] + [f"  - {e}" for e in errors] + [f"Soft warnings: {len(soft)}"] + [f"  - {e}" for e in soft]
    print("\n".join(lines))
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as fh:
            fh.write("### Forecast tracker run\n\n" + "\n".join(f"- {l}" for l in lines) + "\n")
    for e in errors + soft:
        print(f"::warning::{e}")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
