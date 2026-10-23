// POST /api/odds -> record bookmaker / exchange odds for a seat (append-only).
import { authorised, db, ensureSchema, readBody, SEAT_RE, send } from "./_db.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  if (!authorised(req)) return send(res, 401, { error: "Passcode missing or wrong." });
  let b;
  try { b = await readBody(req); } catch { return send(res, 400, { error: "Body must be JSON." }); }
  const odds = Object.fromEntries(Object.entries(b.odds || {}).filter(([, v]) => Number(v) > 1).map(([k, v]) => [k, Number(v)]));
  if (!SEAT_RE.test(b.seat || "")) return send(res, 400, { error: "Unknown seat." });
  if (Object.keys(odds).length < 2) return send(res, 400, { error: "Enter decimal odds (above 1.00) for at least two outcomes." });
  if (!b.source) return send(res, 400, { error: "Say where the odds came from." });
  const inv = Object.fromEntries(Object.entries(odds).map(([k, v]) => [k, 1 / v]));
  const book = Object.values(inv).reduce((a, v) => a + v, 0);
  const implied = Object.fromEntries(Object.entries(inv).map(([k, v]) => [k, +(v / book).toFixed(4)]));
  try {
    await ensureSchema();
    const { rows } = await db().query(
      "insert into vic_market_odds (seat, source, as_of, odds, implied) values ($1,$2,$3,$4,$5) returning *",
      [b.seat, String(b.source).slice(0, 60), b.as_of || null, odds, implied]);
    send(res, 201, { odds: rows[0], overround: +(book - 1).toFixed(4) });
  } catch (e) {
    send(res, 500, { error: "Database error: " + e.message });
  }
}
