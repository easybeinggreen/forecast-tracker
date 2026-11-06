# Count Room: Victorian election 2026, how it all runs

Paul's personal forecast for the Victorian state election (Saturday 28 November 2026). The question: **does thinking in
bets help predict who wins a seat?** Paul, the model, Sportsbet and three AI agents each give chances for every seat,
and everyone is scored after the count.

Dashboard: `site/` (static site + Vercel API functions). Model and data builders: `vic2026/`. Everything below is the
standing process; `MODEL_CHANGELOG.md` records what changed and why.

---

## 1. What runs automatically

| What | When (Brisbane) | Workflow / task | Writes |
|---|---|---|---|
| Polls, poll average, model run, dashboard data, run log | Daily 05:31 | `.github/workflows/vic-model.yml` | `data/raw/polls`, `data/vic2026/poll_average.json`, `site/data/forecast.json`, `changes.json`, `runs.json` |
| Seat news headlines | Daily (same workflow) | `vic2026/fetch/fetch_news.py` | `site/data/news.json` |
| Prediction markets (Kalshi, Polymarket, Manifold) | Every 3 hours | `markets.yml` | `data/markets/history.csv`, `site/data/markets.json` |
| Agents: the local / the numbers punter / the market reader | Mon, Wed, Fri 18:47 / 19:13 / 19:37, until 27 Nov | Scheduled tasks "Agent: …" (cloud, auto-approve) | `data/agents/<name>/calls.jsonl` |
| Referee check on every agent push | On push to `data/agents/**` | `agents-referee.yml` | Reverts rule-breaking agent commits; `site/data/agents_status.json`, `data/agents/referee_last.txt` |
| Referee round report to Paul | Mon, Wed, Fri 20:41 | Scheduled task "Agents referee" (push notification) | Nothing (one line to Paul, no picks) |
| Sunday model review | Sun 8 Nov (v3.0), Sun 15 Nov (v4.0, final) 15:00 | Scheduled tasks in Paul's main session | Model config, `MODEL_CHANGELOG.md` |

Raw sources that can't be reached from Claude's sandbox are fetched by GitHub Actions (`fetch-data.yml`, manual:
`gh api -X POST repos/easybeinggreen/forecast-tracker/actions/workflows/fetch-data.yml/dispatches -f ref=main -f inputs[job]=<job>`).

## 2. On request

### "Update odds" (Sportsbet seat odds)
Sportsbet's terms forbid automated collection, so this runs **only when Paul asks**, never on a schedule (the Sunday
review uses the latest snapshot instead).
1. WebFetch the seat-betting page
   `https://www.sportsbet.com.au/betting/politics/vic-politics/victorian-state-election-seat-betting-10944986`
   asking for one line per seat: `Seat: Party odds, …`, independents as `Independent (Name)`. If the fetch is refused
   (the session only opens links Paul has sent), ask Paul to paste the link in the chat.
2. Check all 88 seats came back; flag any seat whose book total is under 100% or over 130% as a misread.
3. Save the lines to a scratch file, then `python -m vic2026.build.sportsbet --add <file> <ISO time with offset>`,
   e.g. `2026-11-04T09:06+00:00` (the dashboard parses it; a bare `T0906` breaks the charts).
4. `python -m vic2026.build.export_site`, commit "Sportsbet snapshot <date>", push.
5. Report: favourites that changed, biggest moves (chance with margin removed **and** decimal odds, e.g. "46% ($1.83)"),
   and how they compare with the model. Paul's locked calls need his passcode, so value against them is shown on each
   seat page rather than in the report.

**Statewide markets** (same request): fetch `https://www.sportsbet.com.au/betting/politics/vic-politics` (Paul may need
to paste it), then the four market pages it links: sworn-in government, seat totals (Coalition/Labor/One Nation/Greens
over/unders), hung parliament, type of government formed. Save as `data/raw/sportsbet_state/<stamp>.json`
(`{"t", "markets": {"state-govt": {...}, ...}, "lines": {...}}`, keys as in `build/sportsbet_state.py`); `export_site`
rebuilds `site/data/sportsbet_state.json` with model chances. Shown under Betting and markets → Statewide markets;
bets come from the 500-point statewide pot. If a line moves (e.g. Coalition 47.5 → 46.5), the new line is recorded.

### Seat notes and questions
- Coverage: `vic2026/config/research.yaml` (statement + link + paywalled flag per article). Shown as "What the coverage says".
- Local issues: `vic2026/config/issues.yaml` (sourced only; no source, no entry).
- Seat questions: `vic2026/config/questions.yaml`. Each answer shifts the seat calculator; answers are saved with
  Paul's locked call and reviewed on Sundays.
- Candidates reported in coverage but not yet on the Tally Room list: `EXTRA_CANDIDATES` in `build/export_site.py`.
  Tally Room pages that were wrong or missing: `TR_MANUAL` in `build/history.py` (Croydon: Tally Room's
  `/croydon2026` is South Australia's seat; the Victorian one is `/croydonvic2026`). Pages whose title isn't
  "Victoria 2026" are rejected automatically.

## 3. The model and its weekly review

Model code: `vic2026/model/model2026.py`, settings `vic2026/config/drivers.yaml` (`model_version` there).
Poll average: `model/poll_average.py` (recency half-life 30 days, window 120, house effects, pollster cap).

Versions: v1.0 (to 1 Nov), v2.0 (1 Nov), v3.0 (8 Nov), v4.0 (15 Nov, after nominations close 13 Nov; then frozen,
data-only updates to polling day). Every version is kept for scoring.

Rules for any change (also in `MODEL_CHANGELOG.md`):
- Evidence must not come from the odds. Odds only show where to look.
- The 2022 replay must still call at least 85 of 88 seats: `python -m vic2026.model.validate2022`.
- Test changes out of sample where possible (e.g. leave-one-out); reject what doesn't predict (v2.0 rejected the
  demographic swing this way).
- Data corrections (candidate lists, wrong source pages) can go in between reviews, logged in the changelog.

Review routine: refresh evidence (polls, seat polls, coverage, candidate lists, Paul's question answers if he shares
them), test each candidate change, rerun (`model2026` → `validate2022` → `export_site` → `run_log --note "…"`), bump the
version, log it, send Paul a short summary with seat moves in "chance (odds)" form.

## 4. Paul's ledger

- Vercel API (`site/api/`) + Neon Postgres. Passcode in Vercel env `LEDGER_PASSCODE`; database URL in Vercel and GitHub
  secrets only, never in chat.
- Append-only: a changed mind is a new call; nothing is edited or cancelled. Each bet settles on its own.
- Pots: **2,000 points for seats, 500 for statewide markets** (`BUDGET`, `STATE_BUDGET` in `api/_db.js`; statewide
  keys are `statewide` or `state-…`).
- A stake is priced at Sportsbet's odds at the moment of locking where Sportsbet lists that outcome; otherwise the
  model's chance (the ledger records which). Calls store the model version, seat-question answers and calculator
  adjustments.
- Shadow: what $1 per point at Sportsbet would have returned.

## 5. The agents

Three independent players: **the local** (local news and candidates, full Kelly), **the numbers punter** (polls and
data only, quarter Kelly), **the market reader** (price moves and the news behind them, half Kelly).
Rules: `agents/RULES.md`; personas: `agents/personas/`.

- Each sees the dashboard data (`site/data/`) plus its own web research; not the model's code or settings, not Paul's
  ledger, not each other.
- 2,000 points (+500 statewide once open). Goal: most points; honest chances for every seat (Brier recorded).
  Stake ≤ Kelly limit × Kelly fraction × 2,000, only where chance × odds > 1, with a reason; no sunk-cost reasoning.
- Tool: `python -m vic2026.agents.tools brief|place|referee|status`. Ledgers are hash-chained and append-only.
- **Sealed**: nothing about picks, stakes or scores is shown to Paul (or used by Claude in his session) until after
  the count. The dashboard shows only "3 agents playing along, last run …".

## 6. After the election (to build before 28 Nov)

1. Enter results per seat (winner and final two).
2. Settle Paul's and the agents' bets; Sportsbet shadow.
3. Score everyone on the Brier score (final call and campaign average), points, final-two accuracy, and beating the
   later odds; players: Paul, model (each version), Sportsbet, each agent, and the agents' average.
4. Paul's risk profile: his stakes against what Kelly would have suggested from his own chances.
5. Open the agents' ledgers and reasons for the joint analysis.

## 7. Known gaps

- Census industry and occupation (seat "what people do" line): the ABS DataPack download returned 503 to GitHub
  runners four times (30–31 Oct). Fix: Paul downloads `2021_GCP_all_for_VIC_short-header.zip` and attaches the SA1
  files `G54A`, `G54B`, `G60A`, `G60B`, `G40`.
- No Tally Room page saved for Narre Warren North, Narre Warren South, South-West Coast.
- Local issues are sourced for only a handful of seats so far.
