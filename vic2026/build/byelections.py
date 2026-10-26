"""By-elections since 2022 (Wikipedia results tables) -> data/vic2026/byelections.json"""
import io
import json
import re
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data/raw/byelections/wiki"
MAP = [(r"^labor", "ALP"), (r"^liberal", "LIB"), (r"^national", "NAT"), (r"^greens", "GRN"), (r"one nation", "ON"),
       (r"^independent", "IND"), (r"family first|freedom|democratic labour|libertarian|shooters|justice|transport matters", "RMIN"),
       (r"socialist|animal justice|legalise cannabis|reason|sustainable|companions", "PROG")]


def code(p):
    p = str(p).strip().lower()
    return next((c for rx, c in MAP if re.search(rx, p)), "OTH")


def main():
    out = {}
    for f in sorted(RAW.glob("*.html")):
        h = re.sub(r'(rowspan|colspan)="(\d+)[^"]*"', r'\1="\2"', f.read_text(encoding="utf-8"))
        tabs = [t for t in pd.read_html(io.StringIO(h)) if "Candidate" in [str(c) for c in t.columns] and "Votes" in [str(c) for c in t.columns]]
        prim = tabs[-2] if len(tabs) >= 3 else tabs[-1]   # last tables: by-election primary, then two-candidate
        for t in tabs[::-1]:
            if len(t) > 4 and not str(t.iloc[0]["Candidate"]).startswith("Total"):
                prim = t; break
        pcol = [c for c in prim.columns if str(c).startswith("Party")][-1]
        rows = []
        for _, r in prim.iterrows():
            if str(r[pcol]).startswith(("Total", "Informal", "Turnout")) or str(r["Votes"]) == "nan":
                if str(r[pcol]).startswith("Total"):
                    break
                continue
            try:
                rows.append({"name": str(r["Candidate"]), "party": str(r[pcol]), "code": code(r[pcol]), "pct": float(str(r["%"]).replace("−", "-"))})
            except ValueError:
                continue
        g = {}
        for r in rows:
            g[r["code"]] = round(g.get(r["code"], 0) + r["pct"], 1)
        txt = re.sub(r"<[^>]+>", " ", h)
        m = re.search(r"\b(\d{1,2} (?:January|February|March|April|May|June|July|August|September|October|November|December) 20\d\d)", txt)
        known = {"prahran": "8 February 2025", "werribee": "8 February 2025"}
        out[f.stem] = {"date": known.get(f.stem) or (m.group(1) if m else None), "primaries": dict(sorted(g.items(), key=lambda kv: -kv[1])),
                       "candidates": rows, "labor_stood": "ALP" in g,
                       "source": "Wikipedia results table"}
        print(f.stem, out[f.stem]["date"], out[f.stem]["primaries"])
    (ROOT / "data/vic2026/byelections.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
