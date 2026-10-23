"""Fit preference-flow weights from the 2022 distributions of preferences.

Choice model: a ballot paper from origin group f moves to remaining candidate r with probability
    w[f, g(r)] / sum_{r' remaining} w[f, g(r')]
fitted by maximum likelihood over every exclusion where the excluded candidate's papers are
mostly their own first preferences (so the origin is clear).
"""
import json
from pathlib import Path

import numpy as np
from scipy.optimize import minimize

GROUPS = ["ALP", "LIB", "NAT", "GRN", "ON", "RMIN", "PROG", "OTH", "IND"]
GROUP_OF = {
    "ALP": "ALP", "LIB": "LIB", "NAT": "NAT", "GRN": "GRN", "ON": "ON",
    "FF": "RMIN", "FPV": "RMIN", "DLP": "RMIN", "LDP": "RMIN", "SFF": "RMIN", "AVP": "RMIN", "HAP": "RMIN",
    "AJP": "PROG", "VS": "PROG", "REA": "PROG", "LCV": "PROG",
    "DHJ": "OTH", "ND": "OTH", "TMP": "OTH", "CPP": "OTH", "OTH": "OTH", "IND": "IND",
}
G = {g: i for i, g in enumerate(GROUPS)}


def observations(districts, purity=0.8):
    """Yield (origin_group, [remaining groups], [papers received]) from clean exclusions."""
    obs = []
    for d in districts:
        prim = {c["name"]: c["votes"] for c in d["candidates"]}
        grp = {c["name"]: GROUP_OF.get(c["party"], "OTH") for c in d["candidates"]}
        for st in d["distribution"]:
            ex = st["excluded"]
            if ex not in prim or st["papers"] <= 0:
                continue
            if prim[ex] / st["papers"] < purity:      # too many inherited papers: origin unclear
                continue
            names = list(st["to"].keys())
            obs.append((G[grp[ex]], np.array([G[grp[n]] for n in names]), np.array([st["to"][n] for n in names], float)))
    return obs


def fit(obs, ridge=0.05):
    """Return W (groups x groups) with W[f, f] unused; each row normalised so max = 1."""
    K = len(GROUPS)
    W = np.ones((K, K))
    counts = np.zeros(K, int)
    for f in range(K):
        rows = [(r, n) for (o, r, n) in obs if o == f]
        counts[f] = len(rows)
        if not rows:
            continue

        def nll(theta):
            th = np.concatenate([[0.0], theta])            # anchor group 0 (ALP) at log-weight 0
            ll, grad = 0.0, np.zeros(K)
            for r, n in rows:
                z = th[r]
                p = np.exp(z - z.max()); p /= p.sum()
                ll += (n * np.log(p + 1e-12)).sum()
                N = n.sum()
                np.add.at(grad, r, n - N * p)
            val = -ll + ridge * (theta ** 2).sum() * 100
            g = -grad[1:] + 2 * ridge * theta * 100
            return val, g
        res = minimize(nll, np.zeros(K - 1), jac=True, method="L-BFGS-B")
        th = np.concatenate([[0.0], res.x])
        W[f] = np.exp(th - th.max())
    return W, counts


def main():
    D = json.loads(Path("data/vic2026/districts2022.json").read_text())
    obs = observations(D)
    W, counts = fit(obs)
    out = {"groups": GROUPS, "weights": W.round(4).tolist(), "n_exclusions": dict(zip(GROUPS, counts.tolist())),
           "note": "Row = origin group, column = destination. Fitted on 2022 Victorian distributions of preferences."}
    Path("data/vic2026/flows2022.json").write_text(json.dumps(out, indent=1))
    print("exclusions used per origin:", out["n_exclusions"])
    # readable: share to each major when only ALP, LIB/NAT, GRN, ON remain
    for f in ["GRN", "LIB", "RMIN", "PROG", "IND", "ALP", "OTH"]:
        row = W[G[f]]
        for pair in (["ALP", "LIB"], ["ALP", "GRN"], ["LIB", "GRN"]):
            if f in pair:
                continue
            a, b = row[G[pair[0]]], row[G[pair[1]]]
            print(f"  {f:5s} -> {pair[0]} vs {pair[1]}: {a/(a+b):.0%} / {b/(a+b):.0%}")


if __name__ == "__main__":
    main()
