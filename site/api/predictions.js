// POST /api/predictions -> lock a call. Append-only: a changed mind is a new row, never an edit.
import { authorised, BUDGET, db, ensureSchema, readBody, SEAT_RE, send } from "./_db.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  if (!authorised(req)) return send(res, 401, { error: "Passcode missing or wrong." });
  let b;
  try { b = await readBody(req); } catch { return send(res, 400, { error: "Body must be JSON." }); }

  const probs = b.probs || {};
  const total = Object.values(probs).reduce((a, v) => a + Number(v), 0);
  const stake = Number(b.stake || 0);
  if (!SEAT_RE.test(b.seat || "")) return send(res, 400, { error: "Unknown seat." });
  if (!Object.keys(probs).length || Object.values(probs).some((v) => !(v >= 0 && v <= 1)) || Math.abs(total - 1) > 0.02)
    return send(res, 400, { error: "Probabilities must each be between 0 and 1 and add up to 100%." });
  if (!Number.isInteger(stake) || stake < 0) return send(res, 400, { error: "Stake must be a whole number of points." });
  if (stake > 0 && !(b.backed in probs)) return send(res, 400, { error: "Choose the outcome you are staking on." });
  if (stake > 0 && !(b.price_p > 0 && b.price_p < 1)) return send(res, 400, { error: "A stake needs a price between 0 and 100%." });

  try {
    await ensureSchema();
    const client = await db().connect();
    try {
      await client.query("begin");
      await client.query("lock table vic_predictions in share row exclusive mode");
      const { rows } = await client.query("select coalesce(sum(stake), 0)::int as c from vic_predictions");
      if (rows[0].c + stake > BUDGET) {
        await client.query("rollback");
        return send(res, 409, { error: `That stake is more than your remaining ${BUDGET - rows[0].c} points.` });
      }
      const ins = await client.query(
        `insert into vic_predictions (seat, probs, backed, stake, price_p, price_source, model_probs, adjustments, note)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
        [b.seat, probs, stake > 0 ? b.backed : b.backed || null, stake, stake > 0 ? b.price_p : b.price_p || null,
         b.price_source || null, b.model_probs || null, b.adjustments || null, (b.note || "").slice(0, 2000)]);
      await client.query("commit");
      send(res, 201, { prediction: ins.rows[0] });
    } catch (e) {
      await client.query("rollback").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    send(res, 500, { error: "Database error: " + e.message });
  }
}
