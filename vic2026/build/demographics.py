"""2021 Census (General Community Profile, by state electoral district) -> data/vic2026/demographics.json

Shares are of all persons unless noted; Victoria-wide figures are sums over the 88 districts
(medians are population-weighted averages of district medians, so approximate).
"""
import json
import re
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data/raw/census2021_sed2025"
T = lambda t: pd.read_csv(RAW / f"{t}.csv", dtype={"SED_CODE_2025": str}).set_index("SED_CODE_2025")
slugify = lambda n: re.sub(r"[^a-z]+", "-", re.sub(r"\s*\(.*\)$", "", n).lower()).strip("-")


def main():
    nm = pd.read_csv(RAW / "names.csv", dtype=str)
    names = dict(zip(nm.iloc[:, 0], nm.iloc[:, 1]))
    G01, G02, G14, G29, G37, G43 = (T(t) for t in ["G01", "G02", "G14", "G29", "G37", "G43"])
    G09 = pd.concat([T(f"G09{x}") for x in "ABCDEFGH"], axis=1)
    G09 = G09.loc[:, ~G09.columns.duplicated()]
    births = [c for c in G09.columns if c.endswith("_Tot_P") and not re.match(r"(Australia|Tot|Elsewhere|COB_NS|Born_elsewhere|Country_of_birth_not)", c, re.I)]
    deg = [c for c in G43.columns if re.match(r"non_sch_qual_(PostGrad|Gr_Dip|GrDip|Bchelr|Bachelor)", c, re.I) and c.endswith("_P")]
    cert = [c for c in G43.columns if c in ("non_sch_qual_CertTot_Level_P",) or re.match(r"non_sch_qual_Advnce?d?_Dip", c, re.I) and c.endswith("_P")]
    print("degree cols", deg, "cert cols", cert, "birth cols", len(births))
    adults = G01["Tot_P_P"] - G01["Age_0_4_yr_P"] - G01["Age_5_14_yr_P"]

    def shares(idx):
        s = lambda df, cols: df.loc[idx, cols].sum() if isinstance(cols, list) else df.loc[idx, cols].sum()
        pop = s(G01, "Tot_P_P")
        return {
            "pop": int(pop),
            "born_os": 100 * s(G01, "Birthplace_Elsewhere_P") / pop,
            "lang": 100 * s(G01, "Lang_used_home_Oth_Lang_P") / pop,
            "atsi": 100 * s(G01, "Indigenous_P_Tot_P") / pop,
            "uni": 100 * G43.loc[idx, deg].values.sum() / adults.loc[idx].sum(),
            "cert": 100 * G43.loc[idx, cert].values.sum() / adults.loc[idx].sum(),
            "rent": 100 * s(G37, "R_Tot_Total") / s(G37, "Total_Total"),
            "own": 100 * s(G37, "O_OR_Total") / s(G37, "Total_Total"),
            "kids": 100 * (s(G29, "CF_Total_P") - s(G29, "CF_no_children_P")) / s(G29, "Total_P"),
            "christian": 100 * s(G14, "Christianity_Tot_P") / s(G14, "Tot_P"),
            "norel": 100 * s(G14, "SB_OSB_NRA_NR_P") / s(G14, "Tot_P"),
        }

    out = {}
    for code, name in names.items():
        if code not in G01.index:
            continue
        d = shares([code])
        d.update({"age": float(G02.loc[code, "Median_age_persons"]), "inc": float(G02.loc[code, "Median_tot_hhd_inc_weekly"]),
                  "rent_wk": float(G02.loc[code, "Median_rent_weekly"]), "mortgage_mo": float(G02.loc[code, "Median_mortgage_repay_monthly"])})
        pop = d["pop"]
        top = G09.loc[code, births].sort_values(ascending=False).head(4)
        d["top_birth"] = [[c.replace("_Tot_P", "").replace("_", " "), round(100 * v / pop, 1)] for c, v in top.items()]
        out[slugify(name)] = {k: (round(v, 1) if isinstance(v, float) else v) for k, v in d.items()}
    codes = [c for c in names if c in G01.index]
    vic = shares(codes)
    w = G01.loc[codes, "Tot_P_P"]
    for k, col in [("age", "Median_age_persons"), ("inc", "Median_tot_hhd_inc_weekly")]:
        vic[k] = float((G02.loc[codes, col] * w).sum() / w.sum())
    vic = {k: (round(v, 1) if isinstance(v, float) else v) for k, v in vic.items()}
    (ROOT / "data/vic2026/demographics.json").write_text(json.dumps({"source": "ABS 2021 Census GCP (SA1 level), re-cut to 2025 district boundaries", "vic": vic, "seats": out}, indent=1))
    print(len(out), "districts", vic)


if __name__ == "__main__":
    main()
