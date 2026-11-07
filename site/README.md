# Ballot Miner (with Count Room inside)

- `/` and `/play/`: **Ballot Miner**, the players' game (`play/`). Players join with a team code, a name and a 4-6 digit PIN,
  and stay signed in on that device. API: `api/game.js` (tables `bm_*`, created automatically).
- `/admin`: sign in with the **admin passphrase** (the `LEDGER_PASSCODE` variable); 30-day cookie. Teams and codes, players,
  PIN resets, organiser flags. API: `api/admin.js`.
- `/count-room`: **Count Room**, Paul's model dashboard and ledger. Admin only: the model files (`data/forecast.json`,
  `changes.json`, `agents_status.json`, `sportsbet_state.json`) are blocked from the public site in `vercel.json`
  and served through `api/admin.js` after sign-in.

Count Room: seat-by-seat forecast, a live preference calculator for every
seat, and an append-only prediction ledger with a 1,000-point stake budget.

- `index.html`, `css/`, `js/`: static front end (no build step)
- `js/sim.js`: in-browser seat calculator, same count and preference model as `vic2026/model/`
- `data/forecast.json`: model output, rebuilt nightly by `.github/workflows/vic-model.yml`
- `api/`: Vercel functions for the ledger (`ledger`, `predictions`, `odds`), stored in Neon.
  Tables are created automatically on first use.

## Deploy on Vercel

1. Import the GitHub repo, set **Root Directory** to `site`, framework preset **Other**, no build command.
2. Environment variables: `DATABASE_URL` (Neon connection string) and `LEDGER_PASSCODE` (any passphrase you choose).
3. Deploy. The forecast and model files need the admin sign-in; players only see the game's data.

## Run locally

```
cd site && npm install
DATABASE_URL=postgresql://... LEDGER_PASSCODE=... npm run dev
```
