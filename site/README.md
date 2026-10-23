# Count Room

Victorian election 2026 dashboard: seat-by-seat forecast, a live preference calculator for every
seat, and an append-only prediction ledger with a 1,000-point stake budget.

- `index.html`, `css/`, `js/`: static front end (no build step)
- `js/sim.js`: in-browser seat calculator, same count and preference model as `vic2026/model/`
- `data/forecast.json`: model output, rebuilt nightly by `.github/workflows/vic-model.yml`
- `api/`: Vercel functions for the ledger (`ledger`, `predictions`, `odds`), stored in Neon.
  Tables are created automatically on first use.

## Deploy on Vercel

1. Import the GitHub repo, set **Root Directory** to `site`, framework preset **Other**, no build command.
2. Environment variables: `DATABASE_URL` (Neon connection string) and `LEDGER_PASSCODE` (any passphrase you choose).
3. Deploy. The forecast is readable by anyone with the link; locking calls and recording odds need the passcode.

## Run locally

```
cd site && npm install
DATABASE_URL=postgresql://... LEDGER_PASSCODE=... npm run dev
```
