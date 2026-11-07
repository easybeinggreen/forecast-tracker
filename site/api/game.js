// Ballot Miner player API: /api/game?a=join|login|me|call|bet|vote
// Players sign in with a team code (first time), a name and a PIN; the browser keeps a token until the count.
import { db, send, readBody } from "./_db.js";
import { hashPin, pinMatches, newToken, tokenHash, throttled, failed, cleared } from "./_auth.js";
import { ensureGame, seatData, closed, playerOut, BANKROLL, SEAT_CAP, VOTE_KEYS } from "./_game.js";

const NAME_RE = /^[\p{L}\p{M}' .-]{2,40}$/u;
const PIN_RE = /^\d{4,6}$/;

async function player(req) {
  const t = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!t) return null;
  const r = await db().query("select p.* from bm_sessions s join bm_players p on p.id = s.player_id where s.token_hash = $1", [tokenHash(t)]);
  return r.rows[0] || null;
}
async function session(p) {
  const t = newToken();
  await db().query("insert into bm_sessions (token_hash, player_id) values ($1, $2)", [tokenHash(t), p.id]);
  return { token: t, player: playerOut(p) };
}

export default async function handler(req, res) {
  try {
    await ensureGame();
    const a = new URL(req.url, "http://x").searchParams.get("a");
    const b = req.method === "POST" ? await readBody(req) : {};

    if (a === "join") {
      const name = String(b.name || "").trim().replace(/\s+/g, " "), pin = String(b.pin || ""), code = String(b.code || "").trim().toLowerCase();
      const team = (await db().query("select name from bm_teams where lower(code) = $1", [code])).rows[0];
      if (!team) return send(res, 400, { error: "That team code isn't right. Check it with whoever invited you." });
      if (!NAME_RE.test(name)) return send(res, 400, { error: "Use 2 to 40 letters for your name." });
      if (!PIN_RE.test(pin)) return send(res, 400, { error: "Choose a PIN of 4 to 6 digits." });
      const taken = (await db().query("select 1 from bm_players where lower(name) = lower($1)", [name])).rows[0];
      if (taken) return send(res, 409, { error: `Someone has already joined as ${name}. Add an initial, e.g. "${name} K." If it's you, use "I've joined before".` });
      const p = (await db().query("insert into bm_players (team, name, pin_hash) values ($1, $2, $3) returning *", [team.name, name, hashPin(pin)])).rows[0];
      return send(res, 200, await session(p));
    }

    if (a === "login") {
      const name = String(b.name || "").trim().replace(/\s+/g, " "), pin = String(b.pin || ""), key = `player:${name.toLowerCase()}`;
      const wait = await throttled(key);
      if (wait) return send(res, 429, { error: `Too many wrong PINs. Try again in ${wait} minute${wait === 1 ? "" : "s"}, or ask the organiser to reset it.` });
      const p = (await db().query("select * from bm_players where lower(name) = lower($1)", [name])).rows[0];
      if (!p || !pinMatches(pin, p.pin_hash)) { await failed(key); return send(res, 401, { error: "That name and PIN don't match." }); }
      await cleared(key);
      return send(res, 200, await session(p));
    }

    const me = await player(req);
    if (!me) return send(res, 401, { error: "Please sign in again." });

    if (a === "me") {
      const q = (t) => db().query(`select * from ${t} where player_id = $1 order by created_at, id`, [me.id]).then((r) => r.rows);
      const [calls, bets, votes] = await Promise.all([q("bm_calls"), q("bm_bets"), q("bm_votes")]);
      return send(res, 200, { player: playerOut(me), calls: calls.map(({ seat, pick, why, created_at }) => ({ seat, pick, why, created_at })),
        bets: bets.map(({ seat, pick, stake, odds, odds_as_of, created_at }) => ({ seat, pick, stake, odds: Number(odds), odds_as_of, created_at })),
        votes: votes.map(({ vote, why, created_at }) => ({ vote, why, created_at })) });
    }

    if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
    if (closed()) return send(res, 403, { error: "Picks closed at 6pm Friday 27 November." });

    if (a === "call") {
      const s = seatData()[b.seat];
      if (!s) return send(res, 400, { error: "Unknown seat." });
      const outcomes = Object.keys(s.sportsbet?.odds || {});
      if (!outcomes.includes(b.pick)) return send(res, 400, { error: "Pick one of the listed candidates." });
      const why = String(b.why || "").trim().slice(0, 2000);
      const last = (await db().query("select pick from bm_calls where player_id = $1 and seat = $2 order by created_at desc, id desc limit 1", [me.id, b.seat])).rows[0];
      if (last && last.pick === b.pick) return send(res, 400, { error: "That's already your pick." });
      if (last && !why) return send(res, 400, { error: "Say what changed, in a line." });
      const c = (await db().query("insert into bm_calls (player_id, seat, pick, why) values ($1, $2, $3, $4) returning seat, pick, why, created_at", [me.id, b.seat, b.pick, why])).rows[0];
      return send(res, 200, { call: c });
    }

    if (a === "bet") {
      const s = seatData()[b.seat], stake = Number(b.stake);
      if (!s) return send(res, 400, { error: "Unknown seat." });
      const odds = s.sportsbet?.odds?.[b.pick];
      if (!odds) return send(res, 400, { error: "Sportsbet has no price for that pick." });
      if (!Number.isInteger(stake) || stake <= 0) return send(res, 400, { error: "Enter the points to bet, as a whole number." });
      const t = (await db().query("select coalesce(sum(stake), 0)::int as all, coalesce(sum(stake) filter (where seat = $2), 0)::int as here from bm_bets where player_id = $1", [me.id, b.seat])).rows[0];
      if (t.all + stake > BANKROLL) return send(res, 400, { error: `You have ${BANKROLL - t.all} points left to bet.` });
      if (t.here + stake > SEAT_CAP) return send(res, 400, { error: t.here ? `Up to ${SEAT_CAP} points a seat. You have ${t.here} on this one, so ${SEAT_CAP - t.here} more at most.` : `Up to ${SEAT_CAP} points a seat.` });
      const x = (await db().query("insert into bm_bets (player_id, seat, pick, stake, odds, odds_as_of) values ($1, $2, $3, $4, $5, $6) returning seat, pick, stake, odds, odds_as_of, created_at",
        [me.id, b.seat, b.pick, stake, odds, s.sportsbet.as_of])).rows[0];
      return send(res, 200, { bet: { ...x, odds: Number(x.odds) } });
    }

    if (a === "vote") {
      const v = Object.fromEntries(VOTE_KEYS.map((k) => [k, Number(b.vote?.[k])]));
      if (VOTE_KEYS.some((k) => !Number.isFinite(v[k]) || v[k] < 0 || v[k] > 100)) return send(res, 400, { error: "Each number must be between 0 and 100." });
      const tot = VOTE_KEYS.reduce((s, k) => s + v[k], 0);
      if (Math.abs(tot - 100) > 0.05) return send(res, 400, { error: `Your numbers add to ${tot.toFixed(1)}; they need to add to 100.` });
      const r = (await db().query("insert into bm_votes (player_id, vote, why) values ($1, $2, $3) returning vote, why, created_at", [me.id, v, String(b.why || "").trim().slice(0, 2000)])).rows[0];
      return send(res, 200, { vote: r });
    }

    return send(res, 404, { error: "Unknown action." });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: "Something went wrong on the server. Try again." });
  }
}
