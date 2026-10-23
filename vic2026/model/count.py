"""Vectorised full-preferential count (Victorian Legislative Assembly rules).

Each simulation runs the real count: exclude the lowest candidate, pass their ballot papers on,
repeat until two remain. Ballot papers are tracked as bundles by ORIGIN candidate, so a Greens
vote that passed to Labor flows by Greens voters' preferences if Labor is later excluded.

Preference flows use a choice model: a vote from party f goes to remaining candidate r with
probability  w[f, party(r)] / sum over remaining of w[f, party(.)]
so one weight table covers every combination of remaining candidates.
"""
from dataclasses import dataclass

import numpy as np


@dataclass
class CountResult:
    final_two: np.ndarray      # (S, 2) candidate indices, ordered winner first
    final_share: np.ndarray    # (S,) winner's share of the final two-candidate vote
    winner: np.ndarray         # (S,) candidate index
    outright: np.ndarray       # (S,) bool: winner had > 50% of first preferences
    exclusion_order: np.ndarray  # (S, C-2) candidate indices in order of exclusion


def run_count(primaries: np.ndarray, parties: np.ndarray, weights: np.ndarray) -> CountResult:
    """
    primaries: (S, C) first-preference votes (any scale) per simulation and candidate
    parties:   (C,) int party index per candidate
    weights:   (P, P) or (S, P, P) preference weight from party (row) to party (column), > 0
    """
    S, C = primaries.shape
    if weights.ndim == 2:
        weights = np.broadcast_to(weights, (S,) + weights.shape)
    # w_cc[s, origin, recipient] = weight between candidates via their parties
    w_cc = weights[:, parties][:, :, parties]                      # (S, C, C)

    bundles = np.zeros((S, C, C))                                   # holder x origin
    idx = np.arange(C)
    bundles[:, idx, idx] = primaries
    active = np.ones((S, C), dtype=bool)
    order = np.zeros((S, max(C - 2, 0)), dtype=int)
    srange = np.arange(S)

    total0 = primaries.sum(axis=1)
    outright = (primaries.max(axis=1) / total0) > 0.5

    for k in range(C - 2):
        totals = bundles.sum(axis=2)
        totals = np.where(active, totals, np.inf)
        ex = totals.argmin(axis=1)                                  # (S,) excluded candidate
        order[:, k] = ex
        active[srange, ex] = False
        moving = bundles[srange, ex, :]                             # (S, origin)
        bundles[srange, ex, :] = 0.0
        # share of each origin's papers going to each still-active recipient
        w = w_cc * active[:, None, :]                               # (S, origin, recipient)
        share = w / w.sum(axis=2, keepdims=True)
        bundles += np.transpose(moving[:, :, None] * share, (0, 2, 1))

    totals = np.where(active, bundles.sum(axis=2), -np.inf)
    top2 = np.argsort(-totals, axis=1)[:, :2]
    t2 = np.take_along_axis(totals, top2, axis=1)
    return CountResult(final_two=top2, final_share=t2[:, 0] / t2.sum(axis=1),
                       winner=top2[:, 0], outright=outright, exclusion_order=order)


def _selftest():
    # Pascoe Vale 2022 style: ALP 38.8, GRN 22.4, LIB 21.0, others small
    parties = np.array([0, 1, 2, 3])      # ALP, GRN, LIB, OTH
    prim = np.array([[38.8, 22.4, 21.0, 17.8]])
    w = np.ones((4, 4))
    w[2, 1] = 3.0                          # Liberals preference Greens over Labor (made-up)
    r = run_count(prim, parties, w)
    assert set(r.final_two[0]) == {0, 1}, r.final_two
    print("selftest ok:", r.final_two[0], round(float(r.final_share[0]), 3), r.exclusion_order[0])


if __name__ == "__main__":
    _selftest()


def trace_count(primaries, parties, weights):
    """Single deterministic count that records every round, for display.
    primaries: (C,) votes; parties: (C,) group index; weights: (P, P).
    Returns list of rounds: {"excluded": idx or None, "totals": [C floats, nan once excluded]}."""
    C = len(primaries)
    w_cc = weights[parties][:, parties]
    bundles = np.diag(np.asarray(primaries, float))
    active = np.ones(C, bool)
    rounds = [{"excluded": None, "totals": bundles.sum(1).tolist()}]
    for _ in range(C - 2):
        t = np.where(active, bundles.sum(1), np.inf)
        ex = int(t.argmin())
        active[ex] = False
        moving = bundles[ex].copy()
        bundles[ex] = 0
        w = w_cc * active[None, :]
        share = w / w.sum(1, keepdims=True)
        bundles += (moving[:, None] * share).T
        tot = bundles.sum(1)
        rounds.append({"excluded": ex, "totals": [float(v) if active[i] else None for i, v in enumerate(tot)]})
    return rounds
