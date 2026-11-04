// GET /api/ledger -> all locked calls, market odds and the stake budget.
import { authorised, BUDGET, db, ensureSchema, isState, send, STATE_BUDGET } from "./_db.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { error: "Use GET." });
  if (!authorised(req)) return send(res, 401, { error: "Passcode missing or wrong." });
  try {
    await ensureSchema();
    const [p, o] = await Promise.all([
      db().query("select * from vic_predictions order by created_at"),
      db().query("select * from vic_market_odds order by created_at"),
    ]);
    const committed = p.rows.filter((r) => !isState(r.seat)).reduce((a, r) => a + Number(r.stake), 0);
    const sc = p.rows.filter((r) => isState(r.seat)).reduce((a, r) => a + Number(r.stake), 0);
    send(res, 200, { predictions: p.rows, odds: o.rows, budget: { total: BUDGET, committed, remaining: BUDGET - committed },
      state_budget: { total: STATE_BUDGET, committed: sc, remaining: STATE_BUDGET - sc } });
  } catch (e) {
    send(res, 500, { error: "Database error: " + e.message });
  }
}
