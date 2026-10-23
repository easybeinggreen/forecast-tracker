"""Parse raw VEC 2022 pages into data/vic2026/districts2022.json.

Per district: candidates with party codes and first preferences, the final two, the
two-party-preferred count, and every step of the distribution of preferences.
"""
import io
import json
import re
from pathlib import Path

import pandas as pd

RAW = Path("data/raw/vec2022")
OUT = Path("data/vic2026/districts2022.json")

PARTY = {
    "Australian Labor Party - Victorian Branch": "ALP", "Liberal": "LIB", "The Nationals": "NAT",
    "Australian Greens": "GRN", "Pauline Hanson's One Nation": "ON", "Family First Victoria": "FF",
    "Freedom Party of Victoria": "FPV", "Labour DLP": "DLP", "Liberal Democrats": "LDP",
    "Animal Justice Party": "AJP", "Victorian Socialists": "VS", "New Democrats": "ND",
    "Derryn Hinch's Justice Party": "DHJ", "Fiona Patten's Reason Party": "REA",
    "Shooters, Fishers & Farmers Vic": "SFF", "Angry Victorians Party": "AVP",
    "Health Australia Party": "HAP", "Legalise Cannabis Victoria": "LCV",
    "Transport Matters": "TMP", "Companions and Pets Party": "CPP",
}


def num(x):
    if pd.isna(x):
        return None
    return int(float(str(x).replace(",", "")))


def parse_district(slug):
    d = RAW / slug
    res = pd.read_html(io.StringIO((d / "results.html").read_text(encoding="utf-8")))
    html = (d / "results.html").read_text(encoding="utf-8")
    cands = []
    for _, r in res[0].iterrows():
        raw = r["Party"] if isinstance(r["Party"], str) else ""
        cands.append({"name": r["Candidate"].strip(), "party_raw": raw,
                      "party": PARTY.get(raw, "IND" if not raw else "OTH"), "votes": num(r["1st pref. votes"])})
    # table layouts vary: the final-two table is "Votes after distribution", or (when the final two
    # were Labor v Coalition) only a "Preferred votes" table that doubles as the two-party count
    fin_t = next((t for t in res[1:] if "Votes after distribution" in t.columns), None)
    tpp_t = next((t for t in res[1:] if "Preferred votes" in t.columns), None)
    src, col = (fin_t, "Votes after distribution") if fin_t is not None else (tpp_t, "Preferred votes")
    final = [{"name": r["Candidate"].strip(), "votes": num(r[col])} for _, r in src.iterrows()]
    tpp = [{"party": PARTY.get(r["Party"], r["Party"]), "votes": num(r["Preferred votes"])}
           for _, r in tpp_t.iterrows()] if tpp_t is not None else []
    # the VEC stops distributing once someone has an absolute majority; then the two-candidate
    # result comes from the separate preferred-votes count
    stopped_early = len(final) > 2
    if stopped_early:
        top2 = sorted(final, key=lambda f: -f["votes"])[:2]
        pair = [{"name": r["Candidate"].strip(), "votes": num(r["Preferred votes"])} for _, r in tpp_t.iterrows()] if tpp_t is not None else []
        # use the full two-candidate count only when it is between the same two candidates
        final = pair if {f["name"] for f in pair} == {f["name"] for f in top2} else top2

    def grab(label):
        m = re.search(label + r"[^0-9]{0,200}?([\d,]+)", re.sub(r"<[^>]+>", " ", html))
        return int(m.group(1).replace(",", "")) if m else None

    steps = []
    if (d / "distribution.html").exists():
        t = pd.read_html(io.StringIO((d / "distribution.html").read_text(encoding="utf-8")))[0]
        label = t.columns[0]
        names = [c for c in t.columns[1:] if c != "TOTAL"]
        for _, r in t.iterrows():
            m = re.match(r"Transfer of ([\d,]+) ballot papers of (.+?) \(", str(r[label]))
            if m:
                steps.append({"excluded": m.group(2).strip(), "papers": int(m.group(1).replace(",", "")),
                              "to": {n: num(r[n]) for n in names if num(r[n]) is not None and n != m.group(2).strip()}})
    name = slug.replace("-", " ").title().replace("South West", "South-West").replace("St ", "St ")
    return {"slug": slug, "district": name, "enrolment": grab("Total enrolment"), "formal": grab("Formal votes"),
            "informal": grab("Informal votes"), "candidates": cands, "final_two": final, "count_stopped_early": stopped_early, "tpp": tpp, "distribution": steps}


def main():
    out = []
    for d in sorted(p for p in RAW.iterdir() if p.is_dir() and (p / "results.html").exists()):
        out.append(parse_district(d.name))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(f"{len(out)} districts -> {OUT}")


if __name__ == "__main__":
    main()
