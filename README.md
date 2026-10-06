# Forecast tracker

A daily collector for the **AI Philanthropy Inflow Forecast**. It records crowd odds (Manifold, Polymarket, Metaculus), IPO filings on SEC EDGAR, and news volume (GDELT) in a Postgres database (Neon), alongside your own dated forecasts, so the two can be compared and scored.

```
config.yaml ──► collector (GitHub Actions, daily 05:47 Brisbane) ──► Neon Postgres
                 ├─ Manifold / Polymarket / Metaculus  → snapshots
                 ├─ SEC EDGAR full-text search         → filings  (+ GitHub issue on a new one)
                 └─ GDELT news volume                   → news_volume
```

## Setup (one time)

1. **Neon**: run `db/001_init.sql` in the SQL editor of the `forecasting` project.
2. **GitHub secrets**: go to *Settings → Secrets and variables → Actions*:
   - `DATABASE_URL` is the connection string from *Neon → Connect* (keep `?sslmode=require`). It grants full write access, so keep it only in GitHub secrets.
   - `METACULUS_TOKEN` (optional) is a free token from your Metaculus account settings.
   - Variable `TRACKER_USER_AGENT` is something like `forecast-tracker you@example.com`. The SEC asks for contact details.
3. **First run**: go to *Actions → Collect → Run workflow*. Without secrets it runs dry and saves `out/run.json` as an artifact.

## Daily use

- **Add a forecast**: append a dated entry under `my_forecasts` in `config.yaml` and push. Dates are kept, so nothing is overwritten.
- **Track a new market**: run *Actions → Find markets* with a topic, then add the slug under a question's `sources`.
- **A new S-1 appears**: the run opens a GitHub issue, and GitHub emails you.
- **A failed run** means one feed broke. The run summary names it, and the other feeds still write.

## Tables

| Table | Holds |
| --- | --- |
| `questions`, `sources` | What is tracked and where its market lives (synced from config) |
| `snapshots` | One crowd probability per source × outcome × day |
| `forecasts` | Your forecasts, per question × date × outcome |
| `filings` | Anthropic and OpenAI registration filings found on EDGAR |
| `news_volume` | Daily share of global news coverage per query |
| `variables`, `signals` | The model's input register and the dated signal log |
| `latest_snapshots` (view) | Most recent reading per source and outcome, for the dashboard |

## Local run

```
python -m venv .venv && .venv\Scripts\activate   # Windows
pip install -r requirements.txt
copy .env.example .env   # fill in, then load the variables into your shell
python -m collector.main --dry-run
```
