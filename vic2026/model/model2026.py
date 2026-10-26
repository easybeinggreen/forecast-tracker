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

from vic2026.model.count import run_count, trace_count
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
        cand = cfg.get("candidates") or {}
        for g, how in ((cand.get("add") or {}).get(d["slug"]) or {}).items():
            if g == "NAT" and B[i, G["NAT"]] == 0:
                fed = json.loads((ROOT / "data/vic2026/on_federal2025.json").read_text())["seats"].get(d["slug"], {}).get("prims", {})
                frac = how if isinstance(how, (int, float)) else fed.get("NAT", 0) / max(fed.get("NAT", 0) + fed.get("LIB", 0), 1e-9)
                B[i, G["NAT"]] = B[i, G["LIB"]] * frac
                B[i, G["LIB"]] *= 1 - frac
        for g in (cand.get("drop") or {}).get(d["slug"], []) or []:
            if g != "ON":
                B[i, G[g]] = 0
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


def make_W(W0, cfg, vals, S):
    """Preference weight table per simulation: 2022 fitted base + One Nation / Nationals drivers."""
    K = W0.shape[0]
    W = np.broadcast_to(W0, (S, K, K)).copy()
    odds = lambda q: q / (1 - q)
    c = cfg["flows"]["coalition_internal"]
    W[:, G["LIB"], G["NAT"]] = W[:, G["LIB"], G["ALP"]] * odds(c)
    W[:, G["NAT"], :] = W[:, G["LIB"], :]
    W[:, G["NAT"], G["LIB"]] = W[:, G["NAT"], G["ALP"]] * odds(c)
    W[:, G["LIB"], G["GRN"]] = W[:, G["LIB"], G["ALP"]] * odds(vals["lib_to_grn_vs_alp"])
    W[:, G["NAT"], G["GRN"]] = W[:, G["LIB"], G["GRN"]]
    for f, ref, k in ON_FLOWS:
        W[:, G[f], G["ON"]] = W[:, G[f], G[ref]] * odds(vals[k])
    W[:, G["ON"], :] = W[:, G["RMIN"], :]
    W[:, G["ON"], G["LIB"]] = W[:, G["ON"], G["ALP"]] * odds(vals["on_to_lib_vs_alp"])
    W[:, G["ON"], G["NAT"]] = W[:, G["ON"], G["LIB"]]
    W[:, G["ON"], G["GRN"]] = W[:, G["ON"], G["ALP"]] * odds(vals["on_to_grn_vs_alp"])
    return W


ON_FLOWS = [("LIB", "ALP", "lib_to_on_vs_alp"), ("NAT", "ALP", "nat_to_on_vs_alp"),
            ("ALP", "LIB", "alp_to_on_vs_lib"), ("GRN", "ALP", "grn_to_on_vs_alp"),
            ("RMIN", "LIB", "rmin_to_on_vs_lib"), ("PROG", "ALP", "prog_to_on_vs_alp"),
            ("IND", "ALP", "ind_to_on_vs_alp"), ("OTH", "ALP", "oth_to_on_vs_alp")]


def on_propensity(B):
    rmin, grn = B[:, G["RMIN"]], B[:, G["GRN"]]
    z = lambda x: (x - x.mean()) / x.std()
    return z(rmin), z(grn)


RG = {"ALP": ["ALP"], "LNP": ["LIB", "NAT"], "ON": ["ON"], "GRN": ["GRN"], "OTHERS": ["RMIN", "PROG", "OTH"]}


def region_mults(x, meta, wts, cfg):
    """Multipliers per (region, party group) that move each region's vote part-way toward the pattern in
    regional poll breakdowns. Each poll's region-minus-statewide gap is compared with the model's own gap;
    `weight` of the difference is applied (regional samples are small)."""
    rc = cfg.get("regions") or {}
    if not rc.get("polls"):
        return {}, {}
    reg = json.loads((ROOT / rc["file"]).read_text())
    seat_reg = np.array([reg.get(m["slug"], "") for m in meta])
    share = lambda mask, g: float((x[mask][:, [G[s] for s in RG[g]]].sum(-1) * wts[mask]).sum() / wts[mask].sum())
    allm = np.ones(len(meta), bool)
    model_state = {g: share(allm, g) for g in RG}
    gaps = {}
    for poll in rc["polls"]:
        regs = poll["regions"]
        st = poll.get("statewide") or {g: float(np.mean([v[g] for v in regs.values() if g in v])) for g in RG
                                        if any(g in v for v in regs.values())}
        for r, v in regs.items():
            for g in RG:
                if g in v and g in st:   # some releases only give some parties
                    gaps.setdefault(r, {}).setdefault(g, []).append((v[g] - st[g]) / 100)
    mults, report = {}, {}
    for r, gg in gaps.items():
        mask = seat_reg == r
        if not mask.any():
            continue
        for g, devs in gg.items():
            poll_gap = sum(devs) / len(devs)
            cur = share(mask, g)
            model_gap = cur - model_state[g]
            target = max(cur + rc["weight"] * (poll_gap - model_gap), 0.005)
            m = float(np.clip(target / max(cur, 1e-6), 0.4, 2.5))
            mults.setdefault(r, {})[g] = m
            report.setdefault(r, {})[g] = {"model": round(100 * cur, 1), "poll_gap": round(100 * poll_gap, 1),
                                           "model_gap": round(100 * model_gap, 1), "after": round(100 * cur * m, 1)}
    return mults, report


def apply_regions(x, meta, wts, mults, targets):
    """Apply region multipliers (x: (..., N, K)), keep independents fixed, then re-rake statewide totals."""
    if not mults:
        return x
    reg = json.loads((ROOT / "data/vic2026/regions.json").read_text())
    IND = x[..., G["IND"]].copy()
    for i, m in enumerate(meta):
        for g, f in mults.get(reg.get(m["slug"], ""), {}).items():
            for s in RG[g]:
                x[..., i, G[s]] *= f
    for _ in range(3):
        x[..., G["IND"]] = 0
        x *= (np.clip(1 - IND, 0.05, None) / x.sum(-1))[..., None]
        x[..., G["IND"]] = IND
        for g, tgt in targets.items():
            idx = [G[s] for s in RG[g]]
            cur = (x[..., idx].sum(-1) * wts).sum(-1)
            x[..., idx] *= (tgt / np.maximum(cur, 1e-9))[..., None, None]
    x[..., G["IND"]] = 0
    x *= (np.clip(1 - IND, 0.05, None) / x.sum(-1))[..., None]
    x[..., G["IND"]] = IND
    return x


def explain(B, meta, cfg, p, wts):
    """Deterministic walk-through of steps 2-4 at the central values, for the 'why these numbers' panel."""
    N, K = B.shape
    keys = ["ALP", "LNP", "ON", "GRN", "OTHERS"]
    T = np.array([p[k] for k in keys], float); T /= T.sum()
    oc = cfg["one_nation"]
    fed = json.loads((ROOT / oc["federal_file"]).read_text())
    share = np.array([fed["seats"][m["slug"]]["on_share"] for m in meta])
    g = oc["elasticity"]["mean"]
    gl = oc.get("elasticity_low", oc["elasticity"])["mean"]
    zz = np.log(share / (share * wts).sum())
    raw = np.exp(np.where(zz > 0, g, gl) * zz)
    mult = raw / (raw * wts).sum()
    ON = np.clip(T[2] * mult, 0.01, 0.6)
    x = B.copy(); IND = x[:, G["IND"]].copy(); x[:, G["ON"]] = 0; x[:, G["IND"]] = 0
    room = np.clip(1 - ON - IND, 0.05, None)
    target = {"ALP": T[0], "LNP": T[1], "GRN": T[3], "OTHERS": max(T[4] - (IND * wts).sum(), 0.005)}
    groups = {**SG, "OTHERS": ["RMIN", "PROG", "OTH"]}
    for _ in range(25):
        x *= (room / x.sum(-1))[:, None]
        for gname, slots in groups.items():
            idx = [G[s] for s in slots]
            x[:, idx] *= target[gname] / max((x[:, idx].sum(-1) * wts).sum(), 1e-9)
    x *= (room / x.sum(-1))[:, None]
    x[:, G["ON"]] = ON; x[:, G["IND"]] = IND
    pre_region = x.copy()
    mults, reg_report = region_mults(x, meta, wts, cfg)
    others_c = max(T[4] - (IND * wts).sum(), 0.005)
    x = apply_regions(x[None], meta, wts, mults, {"ALP": np.array([T[0]]), "LNP": np.array([T[1]]), "ON": np.array([T[2]]),
                                                 "GRN": np.array([T[3]]), "OTHERS": np.array([others_c])})[0]
    regions = json.loads((ROOT / "data/vic2026/regions.json").read_text()) if mults else {}
    state22 = {gname: float((B[:, [G[s] for s in slots]].sum(-1) * wts).sum()) for gname, slots in SG.items()}
    retire = {s: party for party, ss in cfg["retiring"].items() for s in ss}
    out = {}
    for i, m in enumerate(meta):
        out[m["slug"]] = {
            "base": {s: round(100 * float(B[i, G[s]]), 1) for s in SLOTS if B[i, G[s]] > 0.0005},
            "swung": {s: round(100 * float(pre_region[i, G[s]]), 1) for s in SLOTS if pre_region[i, G[s]] > 0.0005},
            "regional": {s: round(100 * float(x[i, G[s]]), 1) for s in SLOTS if x[i, G[s]] > 0.0005},
            "region": regions.get(m["slug"]), "region_mult": {g: round(v, 2) for g, v in mults.get(regions.get(m["slug"], ""), {}).items()},
            "on": {"fed": round(100 * float(share[i]), 1), "fed_vic": round(100 * float((share * wts).sum()), 1),
                   "mult": round(float(mult[i]), 2), "state": round(100 * float(T[2]), 1), "elasticity": g if zz[i] > 0 else gl,
                   "elasticity_hi": g, "elasticity_lo": gl},
            "retiring": retire.get(m["slug"]), "retire_pts": cfg["retirement_penalty"],
            "shift": (cfg.get("seat_overrides") or {}).get(m["slug"], {}).get("shift"),
        }
    statewide = {"2022": {k: round(100 * v, 1) for k, v in state22.items()},
                 "2026": {k: round(100 * float(T[j]), 1) for j, k in enumerate(keys)}}
    statewide["regions"] = reg_report
    return out, statewide, mults


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
    df = cfg["statewide"].get("tails_df")
    z = rng.standard_t(df, (S, 5)) / np.sqrt(df / (df - 2)) if df else rng.standard_normal((S, 5))
    T = np.clip(mean + sd * z, 0.5, None)
    T = T / T.sum(1, keepdims=True)                                            # (S, 5) fractions

    # 2. One Nation by propensity ----------------------------------------------------------------
    zr, zg = on_propensity(B)
    oc = cfg["one_nation"]
    if oc.get("method") == "federal2025":
        fed = json.loads((ROOT / oc["federal_file"]).read_text())["seats"]
        sh = np.array([fed[m["slug"]]["on_share"] for m in meta])
        zi = np.log(sh / (sh * wts).sum())                       # log of local / Victoria-wide federal share
        eh, el = oc["elasticity"], oc.get("elasticity_low", oc["elasticity"])
        g_hi = np.clip(eh["mean"] + eh["sd"] * rng.standard_normal(S), 0.1, 1.5)
        g_lo = np.clip(el["mean"] + el["sd"] * rng.standard_normal(S), 0.1, 2.0)
        gamma = None
    else:
        regional = np.array([m["slug"] in set(oc.get("regional_seats", [])) for m in meta], float)
        zi = oc["right_minor_weight"] * zr - oc["greens_weight"] * zg + oc.get("regional_bonus", 0.0) * regional
        gamma = oc["concentration"]["mean"] + oc["concentration"]["sd"] * rng.standard_normal(S)
    if gamma is None:   # different elasticity above and below the state average
        raw = np.exp(np.where(zi[None, :] > 0, g_hi[:, None], g_lo[:, None]) * zi[None, :])
    else:
        raw = np.exp(gamma[:, None] * zi[None, :])                              # (S, N)
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
    why, why_state, mults = explain(B, meta, cfg, p, wts)
    x = apply_regions(x, meta, wts, mults, {"ALP": T[:, 0], "LNP": T[:, 1], "ON": (ON * wts).sum(1), "GRN": T[:, 3], "OTHERS": others_t})

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
    # seat polls: move each polled seat part-way toward its poll, by effective sample size
    seat_poll_info = {}
    for sp in cfg.get("seat_polls") or []:
        if sp["seat"] not in slug_i:
            continue
        i = slug_i[sp["seat"]]
        neff = sp["n"] / 1.3
        w = neff / (neff + cfg.get("seat_poll_prior_n", 600))
        tot = sum(sp["primaries"].values())
        info = {"pollster": sp["pollster"], "date": sp["date"], "n": sp["n"], "weight": round(w, 2), "url": sp.get("url"), "parties": {}}
        for g, v in sp["primaries"].items():
            idx = [G[s] for s in RG.get(g, [g])]
            cur = float(x[:, i, idx].sum(-1).mean())
            target = cur + w * (v / tot - cur)
            x[:, i, idx] *= target / max(cur, 1e-6)
            info["parties"][g] = {"model": round(100 * cur, 1), "poll": round(100 * v / tot, 1), "after": round(100 * target, 1)}
        x[:, i, :] /= x[:, i, :].sum(-1, keepdims=True)
        seat_poll_info[sp["seat"]] = info
    x *= np.exp(cfg["seat_noise_sd"] * rng.standard_normal(x.shape))
    present_all = present.copy(); present_all[:, G["ON"]] = True
    for s_, gs in ((cfg.get("candidates") or {}).get("drop") or {}).items():
        if s_ in slug_i and "ON" in gs:
            present_all[slug_i[s_], G["ON"]] = False
    x *= present_all[None]
    x /= x.sum(-1, keepdims=True)

    # 5. preference flows (one draw per simulation, shared by every seat) ------------------------
    fl = cfg["flows"]
    vals = {k: np.clip(v["mean"] + v["sd"] * rng.standard_normal(S), 0.02, 0.98)
            for k, v in fl.items() if isinstance(v, dict)}
    W = make_W(W0, cfg, vals, S)
    Wmean = make_W(W0, cfg, {k: np.array([v["mean"]]) for k, v in fl.items() if isinstance(v, dict)}, 1)[0]

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
        mu = prim[:, cand].mean(0)
        tr = trace_count(mu, cand, Wmean)
        seats.append({**m,
                      "sim": {"slots": [SLOTS[s] for s in cand], "mean": [round(float(v), 5) for v in mu],
                              "logsd": [round(float(np.log(prim[:, s]).std()), 4) for s in cand]},
                      "trace": [{"excluded": None if r["excluded"] is None else SLOTS[cand[r["excluded"]]],
                                 "totals": [None if v is None else round(100 * v, 2) for v in r["totals"]]} for r in tr],
                      "win_prob": dict(sorted(probs.items(), key=lambda kv: -kv[1])),
                      "outright_prob": round(float(r.outright.mean()), 4),
                      "final_pairs": fp,
                      "primaries_2026": {SLOTS[s]: {"mean": round(100 * float(prim[:, s].mean()), 1),
                                                    "p10": round(100 * float(np.quantile(prim[:, s], 0.1)), 1),
                                                    "p90": round(100 * float(np.quantile(prim[:, s], 0.9)), 1)} for s in cand}})

    for s in seats:
        s["why"] = why[s["slug"]]
        if s["slug"] in seat_poll_info:
            s["why"]["seat_poll"] = seat_poll_info[s["slug"]]

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
            "drivers": cfg, "flows_base": {"groups": SLOTS, "W0": W0.round(5).tolist()}, "summary": summary, "why_statewide": why_state, "seat_distribution": seat_dist, "seats": seats, "party_names": NICE}


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
