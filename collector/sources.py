"""Fetchers. Each returns plain dicts; nothing here touches the database."""
import json
import re

import requests
from datetime import date, datetime, timedelta, timezone

from .http import get_json

MANIFOLD = "https://api.manifold.markets/v0"
POLY = "https://gamma-api.polymarket.com"
EDGAR_FTS = "https://efts.sec.gov/LATEST/search-index"
GDELT = "https://api.gdeltproject.org/api/v2/doc/doc"
METACULUS = "https://www.metaculus.com/api"


# ---------- crowd forecasts: -> list of {outcome, probability, volume, traders}

def manifold(s, slug):
    m = get_json(s, f"{MANIFOLD}/slug/{slug}")
    kind = m.get("outcomeType")
    base = {"volume": m.get("volume"), "traders": m.get("uniqueBettorCount")}
    if kind == "BINARY":
        return [{"outcome": "YES", "probability": m["probability"], **base}]
    # MULTIPLE_CHOICE, DATE and MULTI_NUMERIC markets all expose buckets as answers
    out = []
    for a in m.get("answers") or []:
        p = a.get("probability", a.get("prob"))
        if p is not None:
            out.append({"outcome": a["text"].strip(), "probability": p, **base})
    if out:
        return out
    raise ValueError(f"manifold market {slug}: outcomeType {kind} has no answer probabilities")


def polymarket(s, event_slug):
    events = get_json(s, f"{POLY}/events", params={"slug": event_slug})
    if not events:
        raise ValueError(f"polymarket event {event_slug} not found")
    ev = events[0]
    out = []
    for mk in ev.get("markets", []):
        if mk.get("closed"):
            continue
        outcomes = json.loads(mk.get("outcomes") or "[]")
        prices = [float(x) for x in json.loads(mk.get("outcomePrices") or "[]")]
        if not prices:
            continue
        label = mk.get("groupItemTitle") or mk.get("question")
        if outcomes[:2] == ["Yes", "No"]:
            out.append({"outcome": label, "probability": prices[0], "volume": _f(mk.get("volume")), "traders": None})
        else:
            for o, p in zip(outcomes, prices):
                out.append({"outcome": f"{label}: {o}", "probability": p, "volume": _f(mk.get("volume")), "traders": None})
    return out


def polymarket_search(s, query):
    res = get_json(s, f"{POLY}/public-search", params={"q": query})
    return [{"slug": e.get("slug"), "title": e.get("title"), "closed": e.get("closed")} for e in res.get("events", [])]


def metaculus(s, post_id, token):
    """Binary questions only; needs a free API token (METACULUS_TOKEN)."""
    s2 = {"Authorization": f"Token {token}"}
    p = s.get(f"{METACULUS}/posts/{post_id}/", headers=s2, timeout=30)
    p.raise_for_status()
    q = p.json()["question"]
    latest = (q.get("aggregations", {}).get("recency_weighted", {}) or {}).get("latest") or {}
    centers = latest.get("centers") or []
    if q.get("type") != "binary" or not centers:
        raise ValueError(f"metaculus {post_id}: unsupported type or no aggregate yet")
    return [{"outcome": "YES", "probability": centers[0], "volume": None, "traders": q.get("nr_forecasters")}]


# ---------- EDGAR: -> list of {accession_no, company, form_type, filed_on, url}

def edgar_filings(s, companies: dict, forms: list, days_back=120):
    start = (date.today() - timedelta(days=days_back)).isoformat()
    found = {}
    for company, keywords in companies.items():
        params = {"q": f'"{company}"', "forms": ",".join(forms), "dateRange": "custom",
                  "startdt": start, "enddt": date.today().isoformat()}
        data = get_json(s, EDGAR_FTS, params=params, pause=0.3)
        for hit in data.get("hits", {}).get("hits", []):
            src = hit.get("_source", {})
            filers = " ".join(src.get("display_names", [])).lower()
            if not any(k in filers for k in keywords):
                continue  # mentioned in someone else's filing, not filed by the company
            adsh = src.get("adsh") or hit["_id"].split(":")[0]
            cik = (src.get("ciks") or [""])[0].lstrip("0")
            fname = hit["_id"].split(":")[1] if ":" in hit["_id"] else ""
            url = f"https://www.sec.gov/Archives/edgar/data/{cik}/{adsh.replace('-', '')}/{fname}" if cik else None
            found[adsh] = {"accession_no": adsh, "company": company, "form_type": src.get("form") or src.get("root_forms", ["?"])[0],
                           "filed_on": src.get("file_date"), "url": url}
    return list(found.values())


# ---------- GDELT: -> list of {query, day, value}

def gdelt_volume(s, query, timespan="14d"):
    # GDELT allows ~1 request per 5 s per IP and shared CI IPs hit 429 often: wait, then retry slowly.
    import time
    for attempt in range(4):
        # plain request (no auto-retry adapter) so we control the 429 back-off ourselves
        r = requests.get(GDELT, params={"query": query, "mode": "timelinevol", "format": "json", "timespan": timespan},
                         headers=dict(s.headers), timeout=30)
        if r.status_code != 429:
            break
        time.sleep(15 * (attempt + 1))
    r.raise_for_status()
    data = r.json()
    time.sleep(8)
    series = (data.get("timeline") or [{}])[0].get("data", [])
    by_day = {}
    for pt in series:
        d = datetime.strptime(pt["date"][:8], "%Y%m%d").date()
        by_day.setdefault(d, []).append(float(pt["value"]))
    today = datetime.now(timezone.utc).date()
    # average sub-daily points; drop today (incomplete)
    return [{"query": query, "day": d.isoformat(), "value": round(sum(v) / len(v), 6)}
            for d, v in sorted(by_day.items()) if d < today]


def _f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def slug_ok(slug):
    return bool(re.fullmatch(r"[A-Za-z0-9\-_]+", str(slug)))
