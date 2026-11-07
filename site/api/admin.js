// Admin API: /api/admin?a=login|logout|status|file|teams|players|team|reset|organiser
// Signing in with the passphrase (LEDGER_PASSCODE) sets a 30-day cookie. Model files are only served from here.
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db, send, readBody } from "./_db.js";
import { isAdmin, adminCookie, passphraseMatches, hashPin, throttled, failed, cleared } from "./_auth.js";
import { ensureGame, BANKROLL } from "./_game.js";

// Files that carry the model (or the sealed agents): blocked from the public site in vercel.json.
const PRIVATE = { forecast: "forecast.json", changes: "changes.json", agents_status: "agents_status.json", sportsbet_state: "sportsbet_state.json" };

export default async function handler(req, res) {
  try {
    const a = new URL(req.url, "http://x").searchParams.get("a");
    const b = req.method === "POST" ? await readBody(req) : {};
    const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();

    if (a === "login") {
      await ensureGame();
      if (!process.env.LEDGER_PASSCODE) return send(res, 500, { error: "No passphrase is set on the server (LEDGER_PASSCODE)." });
      const key = `admin:${ip}`, wait = await throttled(key);
      if (wait) return send(res, 429, { error: `Too many wrong tries. Wait ${wait} minute${wait === 1 ? "" : "s"}.` });
      if (!passphraseMatches(String(b.passphrase || ""))) { await failed(key); return send(res, 401, { error: "That passphrase isn't right." }); }
      await cleared(key);
      res.setHeader("set-cookie", adminCookie(true));
      return send(res, 200, { admin: true });
    }
    if (a === "logout") { res.setHeader("set-cookie", adminCookie(false)); return send(res, 200, { admin: false }); }
    if (a === "status") return send(res, 200, { admin: isAdmin(req) });

    if (!isAdmin(req)) return send(res, 401, { error: "Admin sign-in needed." });

    if (a === "file") {
      const f = PRIVATE[new URL(req.url, "http://x").searchParams.get("name")];
      if (!f) return send(res, 404, { error: "No such file." });
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.setHeader("cache-control", "private, no-store");
      return res.end(readFileSync(join(process.cwd(), "data", f)));
    }

    await ensureGame();
    if (a === "teams" && req.method === "GET") return send(res, 200, { teams: (await db().query("select code, name from bm_teams order by created_at, name")).rows });
    if (a === "team") { // add a team: name -> generated code
      const name = String(b.name || "").trim();
      if (!/^[\p{L}\p{N} '&.-]{2,40}$/u.test(name)) return send(res, 400, { error: "Use 2 to 40 letters for the team name." });
      const code = `${name.toLowerCase().replace(/[^a-z0-9]/g, "")}-${crypto.randomInt(1000, 10000)}`;
      await db().query("insert into bm_teams (code, name) values ($1, $2)", [code, name]);
      return send(res, 200, { team: { code, name } });
    }
    if (a === "players") {
      const r = await db().query(`select p.id, p.name, p.team, p.organiser, p.created_at,
          (select count(distinct seat) from bm_calls c where c.player_id = p.id)::int as seats,
          (select count(*) from bm_bets x where x.player_id = p.id)::int as bets,
          (select coalesce(sum(stake), 0) from bm_bets x where x.player_id = p.id)::int as staked,
          exists (select 1 from bm_votes v where v.player_id = p.id) as voted,
          greatest(p.created_at, (select max(created_at) from bm_calls c where c.player_id = p.id),
                   (select max(created_at) from bm_bets x where x.player_id = p.id),
                   (select max(created_at) from bm_votes v where v.player_id = p.id)) as last_seen
        from bm_players p order by p.team, lower(p.name)`);
      return send(res, 200, { players: r.rows.map((p) => ({ ...p, id: Number(p.id), left: BANKROLL - p.staked })) });
    }
    if (a === "reset") { // new PIN for a player who forgot theirs; their other devices are signed out
      const pin = String(crypto.randomInt(0, 10000)).padStart(4, "0");
      const p = (await db().query("update bm_players set pin_hash = $2 where id = $1 returning name", [b.id, hashPin(pin)])).rows[0];
      if (!p) return send(res, 404, { error: "No such player." });
      await db().query("delete from bm_sessions where player_id = $1", [b.id]);
      await cleared(`player:${p.name.toLowerCase()}`);
      return send(res, 200, { name: p.name, pin });
    }
    if (a === "organiser") {
      await db().query("update bm_players set organiser = $2 where id = $1", [b.id, !!b.on]);
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: "Unknown action." });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: "Something went wrong on the server. Try again." });
  }
}
