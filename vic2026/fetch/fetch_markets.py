"""Prediction-market prices for the Victorian election, every few hours (runs on GitHub Actions).

Public, read-only APIs only:
  Kalshi      series KXVICTORIANSTATE (who wins government)
  Polymarket  any market matching "Victoria" + "election"
  Manifold    any market matching "Victorian election" (play money)
Bookmakers (Sportsbet, TAB, Ladbrokes) have no public data feed and their terms forbid scraping, so their
odds are entered by hand in the dashboard ("Record market odds").

Appends to data/markets/history.csv and writes the latest snapshot to site/data/markets.json.
"""
import csv
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

UA = {"User-Agent": "vic2026-forecast (personal research; Paul Green green.paul.p@gmail.com)"}
NOW = datetime.now(timezone.utc).isoformat(timespec="minutes")
HIST = Path("data/markets/history.csv")
LOG = []


def get(url, **params):
    for i in range(3):
        try:
            r = requests.get(url, params=params, headers=UA, timeout=30)
            if r.ok:
                return r.json()
            LOG.append(f"{r.status_code} {url}")
        except Exception as e:  # noqa: BLE001
            LOG.append(f"error {e} {url}")
        time.sleep(3 * (i + 1))
    return None


def kalshi():
    out = []
    d = get("https://api.elections.kalshi.com/trade-api/v2/markets", series_ticker="KXVICTORIANSTATE", limit=100)
    for m in (d or {}).get("markets", []):
        bid, ask, last = m.get("yes_bid"), m.get("yes_ask"), m.get("last_price")
        mid = (bid + ask) / 200 if bid and ask else (last or 0) / 100
        out.append({"source": "Kalshi", "id": m["ticker"], "title": m.get("title"), "outcome": m.get("yes_sub_title") or m.get("subtitle") or "Yes",
                    "p": round(mid, 4), "volume": m.get("volume"), "url": "https://kalshi.com/markets/kxvictorianstate"})
    return out


def polymarket():
    out = []
    d = get("https://gamma-api.polymarket.com/public-search", q="Victoria election")
    for ev in (d or {}).get("events", []):
        if "victoria" not in (ev.get("title") or "").lower():
            continue
        for m in ev.get("markets", []):
            try:
                names, prices = json.loads(m.get("outcomes") or "[]"), json.loads(m.get("outcomePrices") or "[]")
            except ValueError:
                continue
            for n, pr in zip(names, prices):
                if n.lower() == "no" and len(names) == 2:
                    continue
                out.append({"source": "Polymarket", "id": m.get("slug") or m.get("id"), "title": m.get("question"),
                            "outcome": n if n.lower() != "yes" else (m.get("groupItemTitle") or "Yes"), "p": round(float(pr), 4),
                            "volume": round(float(m.get("volume") or 0)), "url": f"https://polymarket.com/event/{ev.get('slug')}"})
    return out


def manifold():
    out = []
    d = get("https://api.manifold.markets/v0/search-markets", term="Victorian election", limit=40)
    for m in d or []:
        t = (m.get("question") or "")
        if "vic" not in t.lower() or m.get("isResolved"):
            continue
        if m.get("outcomeType") == "BINARY":
            out.append({"source": "Manifold", "id": m["id"], "title": t, "outcome": "Yes", "p": round(m.get("probability", 0), 4),
                        "volume": round(m.get("volume") or 0), "url": m.get("url")})
        elif m.get("outcomeType") == "MULTIPLE_CHOICE":
            full = get(f"https://api.manifold.markets/v0/market/{m['id']}") or {}
            for a in full.get("answers", []):
                out.append({"source": "Manifold", "id": m["id"], "title": t, "outcome": a.get("text"), "p": round(a.get("probability", 0), 4),
                            "volume": round(m.get("volume") or 0), "url": m.get("url")})
    return out


def main():
    rows = []
    for fn in (kalshi, polymarket, manifold):
        try:
            got = fn()
            LOG.append(f"{fn.__name__}: {len(got)} prices")
            rows += got
        except Exception as e:  # noqa: BLE001
            LOG.append(f"{fn.__name__} failed: {e!r}")
    HIST.parent.mkdir(parents=True, exist_ok=True)
    new = not HIST.exists()
    with HIST.open("a", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        if new:
            w.writerow(["time", "source", "id", "title", "outcome", "p", "volume"])
        for r in rows:
            w.writerow([NOW, r["source"], r["id"], r["title"], r["outcome"], r["p"], r["volume"]])
    # last 14 days of history per market outcome, for sparklines
    hist = {}
    with HIST.open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            hist.setdefault(f'{r["source"]}|{r["id"]}|{r["outcome"]}', []).append([r["time"], float(r["p"])])
    for r in rows:
        r["history"] = hist.get(f'{r["source"]}|{r["id"]}|{r["outcome"]}', [])[-120:]
    Path("site/data/markets.json").write_text(json.dumps({"fetched": NOW, "markets": rows, "log": LOG}, separators=(",", ":")))
    print("\n".join(LOG))


if __name__ == "__main__":
    main()
