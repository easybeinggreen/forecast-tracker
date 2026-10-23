"""2026 Victorian Legislative Assembly model.

For each simulated election:
  1. draw statewide primaries around the poll average (shared by every seat - "the wind")
  2. place One Nation's vote by a seat propensity index, with a drawn concentration
  3. swing the other parties proportionally, raked so statewide totals match step 1
  4. apply retirements and seat-level noise
  5. draw one statewide set of preference flows
  6. run the full preferential count in all 88 seats
Outputs data/vic2026/forecast.json: per-seat win / outright / final-pair probabilities and
primaries, plus statewide seat-total distributions and majority odds.
"""
import json
from datetime import date
from pathlib import Path

import numpy as np
import yaml

from vic2026.model.count import run_count
from vic2026.model.flows import G, GROUP_OF, GROUPS

ROOT = Path(__file__).resolve().parents[2]
SLOTS = GROUPS                                   # ALP LIB NAT GRN ON RMIN PROG OTH IND
SG = {"ALP": ["ALP"], "LNP": ["LIB", "NAT"], "GRN": ["GRN"], "OTHERS": ["RMIN", "PROG", "OTH", "IND"]}
NICE = {"ALP": "Labor", "LIB": "Liberal", "NAT": "Nationals", "GRN": "Greens", "ON": "One Nation",
        "RMIN": "Other right", "PROG": "Other progressive", "OTH": "Others", "IND": "Independent"}


def load():
    cfg = yaml.safe_load((ROOT / "vic2026/config/drivers.yaml").read_text())
    D = json.loads((ROOT / "data/vic2026/districts2022.json").read_text())
    W0 = np.array(json.loads((ROOT / "data/vic2026/flows2022.json").read_text())["weights"])
    avg = json.loads((ROOT / cfg["statewide"]["source"]).read_text())
    return cfg, D, W0, avg


def baselines(D, cfg):
    """(88, 9) baseline shares per slot, plus seat metadata."""
    K = len(SLOTS)
    B = np.zeros((len(D), K))
    meta = []
    thr, fac = cfg["independents"]["carry_threshold"], cfg["independents"]["carry_factor"]
    for i, d in enumerate(D):
        f = d["formal"]
        best_ind = None
        for c in d["candidates"]:
            g = GROUP_OF.get(c["party"], "OTH")
            sh = c["votes"] / f
            if g == "IND":
                if sh >= thr and (best_ind is None or sh > best_ind[1]):
                    if best_ind:
                        B[i, G["OTH"]] += best_ind[1]
                    best_ind = (c["name"], sh)
                else:
                    B[i, G["OTH"]] += sh
            else:
                B[i, G[g]] += sh
        if best_ind:
            B[i, G["IND"]] += best_ind[1] * fac
            B[i, G["OTH"]] += best_ind[1] * (1 - fac)
        ov = cfg.get("seat_overrides", {}).get(d["slug"], {})
        for g, v in ov.get("impute", {}).items():
            B[i] *= (1 - v) / B[i].sum()
            B[i, G[g]] = v
        B[i] /= B[i].sum()
        fin = sorted(d["final_two"], key=lambda x: -x["votes"])
        pmap = {c["name"]: c["party"] for c in d["candidates"]}
        meta.append({
            "slug": d["slug"], "name": d["district"], "formal_2022": f, "enrolment_2022": d["enrolment"],
            "winner_2022": {"name": fin[0]["name"], "party": GROUP_OF.get(pmap.get(fin[0]["name"], ""), "IND")},
            "runner_up_2022": {"name": fin[1]["name"], "party": GROUP_OF.get(pmap.get(fin[1]["name"], ""), "IND")},
            "margin_2022": round(100 * fin[0]["votes"] / (fin[0]["votes"] + fin[1]["votes"]) - 50, 2),
            "primaries_2022": [{"name": c["name"], "party": c["party"], "pct": round(100 * c["votes"] / f, 2)} for c in d["candidates"]],
            "ind_2026_assumed": best_ind[0] if best_ind else None,
            "note": d.get("note"),
        })
    return B, meta


def on_propensity(B):
    rmin, grn = B[:, G["RMIN"]], B[:, G["GRN"]]
    z = lambda x: (x - x.mean()) / x.std()
    return z(rmin), z(grn)


def simulate(S=10000, seed=7, scenario=None):
    cfg, D, W0, avg = load()
    rng = np.random.default_rng(seed)
    B, meta = baselines(D, cfg)
    N, K = B.shape
    wts = np.array([m["formal_2022"] for m in meta], float); wts /= wts.sum()

    # 1. statewide primaries (percent) -----------------------------------------------------------
    p = {"ALP": avg["primaries"]["alp"], "LNP": avg["primaries"]["lnp"], "ON": avg["primaries"]["onp"],
         "GRN": avg["primaries"]["grn"], "OTHERS": avg["primaries"]["others"]}
    p.update(cfg["statewide"].get("override") or {})
    p.update(scenario or {})
    keys = ["ALP", "LNP", "ON", "GRN", "OTHERS"]
    mean = np.array([p[k] for k in keys]); sd = np.array([cfg["statewide"]["sd"][k] for k in keys])
    T = np.clip(mean + sd * rng.standard_normal((S, 5)), 0.5, None)
    T = T / T.sum(1, keepdims=True)                                            # (S, 5) fractions

    # 2. One Nation by propensity ----------------------------------------------------------------
    zr, zg = on_propensity(B)
    oc = cfg["one_nation"]
    regional = np.array([m["slug"] in set(oc.get("regional_seats", [])) for m in meta], float)
    zi = oc["right_minor_weight"] * zr - oc["greens_weight"] * zg + oc.get("regional_bonus", 0.0) * regional
    gamma = oc["concentration"]["mean"] + oc["concentration"]["sd"] * rng.standard_normal(S)
    raw = np.exp(gamma[:, None] * zi[None, :])                                  # (S, N)
    ON = T[:, 2:3] * raw / (raw * wts).sum(1, keepdims=True)
    ON = np.clip(ON, 0.01, 0.6)

    # 3. other parties: proportional swing, raked to statewide targets ---------------------------
    # independents keep their own local vote; everyone else is raked to the statewide targets
    x = np.broadcast_to(B, (S, N, K)).copy()
    present = B > 0
    IND = x[..., G["IND"]].copy()
    x[..., G["ON"]] = 0.0
    x[..., G["IND"]] = 0.0
    room = np.clip(1 - ON - IND, 0.05, None)
    others_t = np.clip(T[:, 4] - (IND * wts).sum(1), 0.005, None)
    target = {"ALP": T[:, 0], "LNP": T[:, 1], "GRN": T[:, 3], "OTHERS": others_t}
    groups = {**SG, "OTHERS": ["RMIN", "PROG", "OTH"]}
    for _ in range(25):
        x *= (room / x.sum(-1))[..., None]
        for g, slots in groups.items():
            idx = [G[s] for s in slots]
            cur = (x[..., idx].sum(-1) * wts).sum(-1)                              # (S,)
            x[..., idx] *= (target[g] / np.maximum(cur, 1e-9))[:, None, None]
    x *= (room / x.sum(-1))[..., None]
    x[..., G["ON"]] = ON
    x[..., G["IND"]] = IND

    # 4. retirements and seat noise --------------------------------------------------------------
    slug_i = {m["slug"]: i for i, m in enumerate(meta)}
    pen = cfg["retirement_penalty"] / 100
    for party, slugs in cfg["retiring"].items():
        for s in slugs:
            if s in slug_i:
                i = slug_i[s]
                x[:, i, G[party]] = np.maximum(x[:, i, G[party]] - pen, 0.001)
    for s, ov in (cfg.get("seat_overrides") or {}).items():
        for g, pts in (ov.get("shift") or {}).items():
            if s in slug_i:
                x[:, slug_i[s], G[g]] = np.maximum(x[:, slug_i[s], G[g]] + pts / 100, 0.001)
    x *= np.exp(cfg["seat_noise_sd"] * rng.standard_normal(x.shape))
    present_all = present.copy(); present_all[:, G["ON"]] = True
    x *= present_all[None]
    x /= x.sum(-1, keepdims=True)

    # 5. preference flows (one draw per simulation, shared by every seat) ------------------------
    fl = cfg["flows"]
    draw = lambda k: np.clip(fl[k]["mean"] + fl[k]["sd"] * rng.standard_normal(S), 0.02, 0.98)
    W = np.broadcast_to(W0, (S, K, K)).copy()
    odds = lambda q: q / (1 - q)
    c = cfg["flows"]["coalition_internal"]
    W[:, G["LIB"], G["NAT"]] = W[:, G["LIB"], G["ALP"]] * odds(c)
    W[:, G["NAT"], :] = W[:, G["LIB"], :]
    W[:, G["NAT"], G["LIB"]] = W[:, G["NAT"], G["ALP"]] * odds(c)
    W[:, G["LIB"], G["GRN"]] = W[:, G["LIB"], G["ALP"]] * odds(draw("lib_to_grn_vs_alp"))
    W[:, G["NAT"], G["GRN"]] = W[:, G["LIB"], G["GRN"]]
    for f, ref, k in [("LIB", "ALP", "lib_to_on_vs_alp"), ("NAT", "ALP", "nat_to_on_vs_alp"),
                      ("ALP", "LIB", "alp_to_on_vs_lib"), ("GRN", "ALP", "grn_to_on_vs_alp"),
                      ("RMIN", "LIB", "rmin_to_on_vs_lib"), ("PROG", "ALP", "prog_to_on_vs_alp"),
                      ("IND", "ALP", "ind_to_on_vs_alp"), ("OTH", "ALP", "oth_to_on_vs_alp")]:
        W[:, G[f], G["ON"]] = W[:, G[f], G[ref]] * odds(draw(k))
    W[:, G["ON"], :] = W[:, G["RMIN"], :]
    W[:, G["ON"], G["LIB"]] = W[:, G["ON"], G["ALP"]] * odds(draw("on_to_lib_vs_alp"))
    W[:, G["ON"], G["NAT"]] = W[:, G["ON"], G["LIB"]]
    W[:, G["ON"], G["GRN"]] = W[:, G["ON"], G["ALP"]] * 0.3

    # 6. count every seat ------------------------------------------------------------------------
    win = np.zeros((S, N), int)
    seats = []
    for i, m in enumerate(meta):
        cand = np.where(present_all[i])[0]
        r = run_count(x[:, i, cand], cand, W)
        w_slot = cand[r.winner]
        win[:, i] = w_slot
        pair = np.sort(cand[r.final_two], axis=1)
        pairs, pc = np.unique(pair, axis=0, return_counts=True)
        top = np.argsort(-pc)[:5]
        fp = []
        for j in top:
            a, b = pairs[j]
            sel = (pair[:, 0] == a) & (pair[:, 1] == b)
            fp.append({"pair": [SLOTS[a], SLOTS[b]], "p": round(pc[j] / S, 4),
                       "p_first_wins": round(float((w_slot[sel] == a).mean()), 4),
                       "median_share_first": round(float(np.median(np.where(cand[r.winner[sel]] == a, r.final_share[sel], 1 - r.final_share[sel]))), 4)})
        probs = {SLOTS[s]: round(float((w_slot == s).mean()), 4) for s in cand}
        prim = x[:, i, :]
        seats.append({**m,
                      "win_prob": dict(sorted(probs.items(), key=lambda kv: -kv[1])),
                      "outright_prob": round(float(r.outright.mean()), 4),
                      "final_pairs": fp,
                      "primaries_2026": {SLOTS[s]: {"mean": round(100 * float(prim[:, s].mean()), 1),
                                                    "p10": round(100 * float(np.quantile(prim[:, s], 0.1)), 1),
                                                    "p90": round(100 * float(np.quantile(prim[:, s], 0.9)), 1)} for s in cand}})

    # statewide outputs ---------------------------------------------------------------------------
    counts = {g: (win == G[g]).sum(1) for g in SLOTS}
    lnp = counts["LIB"] + counts["NAT"]
    seat_dist = {g: np.bincount(v, minlength=N + 1).tolist() for g, v in {**counts, "LNP": lnp}.items()}
    summary = {
        "p_alp_majority": float((counts["ALP"] >= 45).mean()), "p_lnp_majority": float((lnp >= 45).mean()),
        "p_hung": float(((counts["ALP"] < 45) & (lnp < 45)).mean()),
        "p_lnp_largest": float((lnp > counts["ALP"]).mean()), "p_alp_largest": float((counts["ALP"] > lnp).mean()),
        "seats": {g: {"mean": round(float(v.mean()), 1), "p10": int(np.quantile(v, .1)), "p50": int(np.median(v)), "p90": int(np.quantile(v, .9))}
                  for g, v in {**counts, "LNP": lnp}.items() if v.max() > 0},
    }
    return {"generated": date.today().isoformat(), "simulations": S, "statewide_inputs": p,
            "drivers": cfg, "summary": summary, "seat_distribution": seat_dist, "seats": seats, "party_names": NICE}


def main():
    out = simulate()
    path = ROOT / "data/vic2026/forecast.json"
    path.write_text(json.dumps(out, indent=1, default=float))
    s = out["summary"]
    print("seats (mean / 10-90%):")
    for g, v in s["seats"].items():
        print(f"  {g:5s} {v['mean']:5.1f}  ({v['p10']}-{v['p90']})")
    print(f"P(Coalition majority) {s['p_lnp_majority']:.0%}  P(Labor majority) {s['p_alp_majority']:.0%}  P(hung) {s['p_hung']:.0%}")
    print(f"P(Coalition largest) {s['p_lnp_largest']:.0%}  P(Labor largest) {s['p_alp_largest']:.0%}")


if __name__ == "__main__":
    main()
