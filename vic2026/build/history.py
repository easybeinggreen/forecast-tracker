"""Seat history from the Wikipedia district articles -> data/vic2026/history.json

Members since 1945 (party, years), the year the district was created, Wikipedia's demographic label,
and the article's opening sentences (CC BY-SA, credited on the page).
"""
import io
import json
import re
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data/raw/history/wiki"
PCODE = [(r"^labor|labor$|australian labor", "ALP"), (r"liberal", "LIB"), (r"national|country", "NAT"), (r"green", "GRN"),
         (r"one nation", "ON"), (r"independent", "IND")]


def code(p):
    p = str(p).strip().lower()
    for rx, c in PCODE:
        if re.search(rx, p):
            return c
    return "OTH"


def lead(html):
    body = re.sub(r"<(script|style|table)[^>]*>.*?</\1>", "", html, flags=re.S)
    for para in re.findall(r"<p[^>]*>(.*?)</p>", body, flags=re.S):
        txt = re.sub(r"<[^>]+>", "", para)
        txt = re.sub(r"\[\d+\]|\[[a-z]\]|\s+", " ", txt).strip()
        if len(txt) > 80:
            sents = re.split(r"(?<=[.!?])\s+(?=[A-Z])", txt)
            return " ".join(sents[:3])[:600]
    return None


def tallyroom(slug):
    f = ROOT / "data/raw/history/tallyroom" / f"{slug}.html"
    if not f.exists():
        return None
    h = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", f.read_text(encoding="utf-8"), flags=re.S)
    txt = re.sub(r"\n\s*\n+", "\n", re.sub(r"<[^>]+>", "\n", h))
    txt = txt.replace("&#8217;", "'").replace("&amp;", "&").replace("&#8211;", "–").replace("&nbsp;", " ")
    i = txt.find("Geography\n", txt.find("Results maps"))
    body = txt[i:] if i > 0 else txt
    c0 = body.find("\nCandidates\n"); a0 = body.find("\nAssessment\n", c0 + 1)
    cands = []
    if c0 > 0 and a0 > c0:
        for m in re.finditer(r"([^\n(]+?)\n\s*\(\n([^\n)]+)\n\)", body[c0:a0]):
            cands.append({"name": m.group(1).strip(), "party": m.group(2).strip()})
    assess = None
    if a0 > 0:
        nxt = body.find("\n2022 result", a0)
        assess = re.sub(r"\s+", " ", body[a0 + 12: nxt if nxt > 0 else a0 + 800]).strip()[:700]
    return {"cands": cands, "assessment": assess, "url": f"https://www.tallyroom.com.au/vic2026/{slug.replace('-', '')}2026"}


def main():
    out = {}
    for f in sorted(RAW.glob("*.html")):
        slug = f.stem
        html = f.read_text(encoding="utf-8")
        html = re.sub(r'(rowspan|colspan)="(\d+)[^"]*"', r'\1="\2"', html)
        tabs = pd.read_html(io.StringIO(html))
        info = {}
        if tabs:
            t0 = tabs[0]
            for _, r in t0.iterrows():
                k, v = str(r.iloc[0]).strip(), str(r.iloc[1]).strip()
                if k in ("Created", "Demographic", "Namesake", "Electors", "Area", "Coordinates"):
                    info[k.lower()] = re.sub(r"\[\d+\]", "", v)
        members = []
        for t in tabs:
            if isinstance(t.columns, pd.MultiIndex):
                t.columns = [c[-1] for c in t.columns]
            if not any("member" in str(c).lower() for c in t.columns) and len(t) and t.iloc[0].astype(str).str.contains("Member").any():
                t.columns = [f"{v}.{i}" for i, v in enumerate(t.iloc[0].astype(str))]
                t = t.iloc[1:]
            t = t.loc[:, ~pd.Index(t.columns).duplicated()].dropna(how="all")
            cols = [str(c).lower() for c in t.columns]
            if not any("term" in c for c in cols) and t.shape[1] >= 3 and len(t):
                tc = [c for c in t.columns if t[c].astype(str).str.match(r"^\d{4}\s*[–-]").mean() > 0.6]
                if tc:
                    k = list(t.columns).index(tc[0])
                    if k >= 2:
                        t = t.rename(columns={t.columns[k]: "Term", t.columns[k - 1]: "Party", t.columns[k - 2]: "Member"})
                        cols = [str(c).lower() for c in t.columns]
            if any("member" in c for c in cols) and any("party" in c for c in cols) and any("term" in c for c in cols):
                mcands = [c for c in t.columns if "member" in str(c).lower() or "name" in str(c).lower()]
                mcands = [c for c in mcands if t[c].astype(str).str.contains(r"[A-Za-z]{3}").mean() > 0.5 and t[c].notna().mean() >= 0.5 and not t[c].astype(str).str.match(r"^\d{4}").mean() > 0.3]
                if not mcands:
                    continue
                mcol = mcands[-1]
                pcol = [c for c in t.columns if "party" in str(c).lower()][-1]
                tcol = [c for c in t.columns if "term" in str(c).lower()][-1]
                for _, r in t.iterrows():
                    ys = re.findall(r"(?<!\d)(1[89]\d\d|20\d\d)(?!\d)|(present)", str(r[tcol]))
                    ys = [y or p for y, p in ys]
                    if len(ys) < 2 or str(r[mcol]) == "nan":
                        continue
                    a = int(ys[0]); b = None if ys[1] == "present" else int(ys[1])
                    name = re.sub(r"\[.*?\]|\(.*?\)|#", "", str(r[mcol])).strip()
                    members.append({"name": name, "party_raw": str(r[pcol]).strip(), "party": code(r[pcol]), "from": a, "to": b})
        members = [m for m in members if (m["to"] or 2026) > 1945]
        for m in members:
            m["from"] = max(m["from"], 1945) if m["to"] and m["to"] > 1945 else m["from"]
        out[slug] = {"created": info.get("created"), "demographic": info.get("demographic"), "blurb": lead(html),
                     "members": members, "tallyroom": tallyroom(slug), "wiki": f"https://en.wikipedia.org/wiki/{json.loads((ROOT / 'data/raw/history/wiki_titles.json').read_text())[slug].replace(' ', '_')}"}
    (ROOT / "data/vic2026/history.json").write_text(json.dumps(out, indent=1))
    print(len(out), "seats;", sum(1 for v in out.values() if v["members"]), "with members")
    for s in ["morwell", "melbourne", "ashwood", "northcote"]:
        v = out.get(s); print(s, v["created"], v["demographic"], len(v["members"]), v["members"][-2:], (v["blurb"] or "")[:160])


if __name__ == "__main__":
    main()
