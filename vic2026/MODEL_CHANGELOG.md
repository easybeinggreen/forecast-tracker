# Model changelog

Method changes happen only at the weekly Sunday review. Between reviews, only data changes (new polls,
Sportsbet snapshots, candidate lists). Every locked call records the model version that priced it.

## Rules against overfitting
1. A change needs a reason that doesn't come from the betting odds: a result (2022, 2025 federal, by-elections,
   SA 2026), a poll, a candidate list, or a pattern in Paul's seat answers that has held across several seats.
2. Odds are used to find where to look, never as a target to fit.
3. The 2022 replay must still pass (winner right in at least 85 of 88 seats).
4. Each version keeps its predictions, so v1.0 to v4.0 can all be scored after the election.
5. After v4.0 (15 Nov), the method is frozen; only data updates.

## v1.0 (27 Oct 2026)
Baseline: 2022 seat results scaled by a smoothed, house-adjusted poll average; One Nation placed by the 2025
federal vote (elasticity 0.45 above / 0.90 below average); regional swings (Roy Morgan, 35% weight);
preference flows fitted to 2022 plus One Nation drivers; candidate add/drop; seat polls mechanism (none yet).

## Candidate changes for v2.0 (review Sun 1 Nov) — from the 30 Oct Sportsbet comparison
Sportsbet's fair odds add up to: One Nation 19.4 seats (model 11.6), Liberal 28.2 (35.3), Greens 4.9 (7.3),
Labor 25.0 (26.6), Nationals 6.6 (6.4). Where they differ, and the evidence to check before changing anything:
- Overconfidence in "safe" seats (model 95-100%, market 55-70%: Polwarth, Rowville, Eildon, South-West Coast,
  Richmond, Melbourne, Kalkallo). Check: is seat-level noise (0.15) too small for a four-way contest?
- Nationals' local strength (Bendigo East, Mildura, Shepparton, Morwell): model shrinks the Nationals with the
  Coalition's statewide fall. Check against 2025 federal Nationals vote and Paul's "Nationals are stable" view.
- Sitting Labor MPs holding up better than a uniform swing (Lara, Narre Warren North, Clarinda, St Albans,
  Niddrie, Greenvale). Check: incumbency effect in 2022 and 2025.
- One Nation beating the Liberals for second in outer/regional seats (Pakenham, Bass, Yan Yean, Macedon).
- Independents not in the model (Mulgrave: Ian Cook; Essendon: Oscar Yildiz; Ringwood; Mildura: Ali Cupper).
