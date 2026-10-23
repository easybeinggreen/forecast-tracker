"""Replay all 87 counts of 2022 from actual first preferences + fitted flows; compare with reality."""
import json
from pathlib import Path

import numpy as np

from vic2026.model.count import run_count
from vic2026.model.flows import G, GROUP_OF


def main():
    D = json.loads(Path("data/vic2026/districts2022.json").read_text())
    W = np.array(json.loads(Path("data/vic2026/flows2022.json").read_text())["weights"])
    ok_win = ok_pair = 0
    errs, misses = [], []
    for d in D:
        c = d["candidates"]
        prim = np.array([[x["votes"] for x in c]], float)
        parties = np.array([G[GROUP_OF.get(x["party"], "OTH")] for x in c])
        r = run_count(prim, parties, W)
        names = [x["name"] for x in c]
        sim_pair = {names[i] for i in r.final_two[0]}
        real = {f["name"]: f["votes"] for f in d["final_two"]}
        real_winner = max(real, key=real.get)
        sim_winner = names[r.winner[0]]
        ok_win += sim_winner == real_winner
        ok_pair += sim_pair == set(real)
        if sim_pair == set(real):
            real_share = real[real_winner] / sum(real.values())
            sim_share = r.final_share[0] if sim_winner == real_winner else 1 - r.final_share[0]
            errs.append(sim_share - real_share)
        if sim_winner != real_winner or sim_pair != set(real):
            misses.append((d["district"], sorted(real), sorted(sim_pair), real_winner, sim_winner))
    n = len(D)
    print(f"winner correct: {ok_win}/{n}; final two correct: {ok_pair}/{n}")
    e = np.array(errs) * 100
    print(f"final two-candidate share error (pts): mean {e.mean():+.2f}, mean abs {np.abs(e).mean():.2f}, max abs {np.abs(e).max():.2f}")
    for m in misses:
        print("  miss:", m)


if __name__ == "__main__":
    main()
