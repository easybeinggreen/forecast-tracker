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

## Data corrections between reviews (allowed: facts, not judgement)
- 30 Oct: dropped 2022 independents not standing again (Narracan Tony Wolfe, Rowville Nicole Seymour, South-West Coast Carol Altmann). Shepparton keeps an independent (Lou Costa announced) but the carried-over 24% from the Sheed era is flagged as a seat question for v2.0.
- 30 Oct: census "families with children" measure corrected (was subtracting the wrong column).

## Evidence for the 1 Nov review (v2.0)
- Roy Morgan seat poll, Bass/Hastings/Morwell/Pakenham, 21–26 Oct, n=283 (SMS): Hastings+Morwell+Pakenham average One Nation 39, Coalition 24, Labor 20, Greens 8, others 9. Says One Nation leads Hastings, Morwell, Pakenham; Liberal leads Bass. Per-seat figures only in a chart image. Candidate for `seat_polls` (about 70 per seat, so weight ~0.1 each).


## v2.0 (Sunday review, 1 Nov 2026)
Replay check: 2022 counts 86/88 winners, 86/88 final two (unchanged).

Adopted
1. **One Coalition party standing alone** (candidate lists, Tally Room, 31 Oct). In Euroa, Mildura, Morwell and Shepparton only the
   Nationals are announced; in Bass only the Liberals; in Bendigo East and West only the Nationals. v1.0 still split the 2022 Coalition
   vote between both. 80% of the absent partner's vote now goes to the one standing, the rest spread across other parties.
   Recheck on 13 Nov when nominations close.
2. **One Nation's federal base where a right-leaning independent ran.** Russell Broadbent (ex-Liberal, Monash 2025, about 10%) took
   protest votes One Nation would otherwise have got. 35% of his share is added to One Nation's federal share before placing it
   (Narracan +3.2, Bass +1.4, Gippsland South +1.5, Morwell +1.1 points of federal share). The 35% is a judgement, not fitted.
3. **Roy Morgan seat poll** (Hastings, Morwell, Pakenham; 21-26 Oct; n=283 incl. Bass). Only the three-seat average was published, so
   each seat gets it with n=70 (weight about 0.08). Small effect by design.

Tested and rejected
- **Demographic swings** (education, trades, renting, language), fitted on 2022 state to 2025 federal movement. Labor and Coalition: no
  predictive power out of sample (leave-one-out R² below zero), so it would be fitting noise. Greens: a real pattern (LOO R² 0.39) but
  mostly state-v-federal differences in the same seats (strong state Greens campaigns), not a 2026 trend. Revisit if a state poll
  breaks down by demographics.
- **Safe-seat overconfidence** (e.g. Croydon 94% v Sportsbet 79%): no evidence except the odds, which the rules don't allow as a reason.
  The replay can't test calibration. Revisit at v3.0 with any seat polls.
- **Independents not modelled** (Yildiz, Essendon): no vote evidence yet beyond the odds.

Not available: Paul's locked calls and seat-question answers (the ledger needs his passcode; the review session doesn't have it).

Effect: Coalition majority 37% → 41%, hung 59% → 55%, Labor majority 4% → 4%. Middle seat counts unchanged (Coalition 42, Labor 26,
One Nation 10, Greens 7). Biggest seat moves: Shepparton One Nation 57% → Nationals 54%; Morwell One Nation 69% → Nationals 50/50;
Mildura One Nation 53% → 45% (Nationals 32%); Narracan Liberal 82% → 64%; Euroa Nationals 83% → 96%; Bass Liberal 82% → 90%.
