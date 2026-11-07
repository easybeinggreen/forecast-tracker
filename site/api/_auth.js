// Sign-in helpers: the admin passphrase session (a signed cookie) and player PINs.
import crypto from "node:crypto";
import { db } from "./_db.js";

const ADMIN_COOKIE = "bm_admin";
const ADMIN_DAYS = 30;

// The admin passphrase is the LEDGER_PASSCODE environment variable (set in Vercel).
const passphrase = () => process.env.LEDGER_PASSCODE || "";
const sign = (msg) => crypto.createHmac("sha256", passphrase()).update(msg).digest("base64url");

export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "").split(/;\s*/).filter(Boolean).map((c) => {
    const i = c.indexOf("="); return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))];
  }));
}

export function isAdmin(req) {
  if (!passphrase()) return false;
  const v = cookies(req)[ADMIN_COOKIE];
  if (!v) return false;
  const [exp, mac] = v.split(".");
  return Number(exp) > Date.now() && safeEqual(mac, sign(`admin.${exp}`));
}

export function adminCookie(on) {
  const secure = process.env.VERCEL ? "; Secure" : "";
  if (!on) return `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
  const exp = Date.now() + ADMIN_DAYS * 864e5;
  return `${ADMIN_COOKIE}=${exp}.${sign(`admin.${exp}`)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ADMIN_DAYS * 86400}${secure}`;
}

export const passphraseMatches = (p) => !!passphrase() && safeEqual(p, passphrase());

// PINs are stored as salted scrypt hashes, never as typed.
export function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  return `${salt.toString("base64url")}.${crypto.scryptSync(String(pin), salt, 32).toString("base64url")}`;
}
export function pinMatches(pin, stored) {
  const [salt, hash] = String(stored || "").split(".");
  if (!salt || !hash) return false;
  return safeEqual(crypto.scryptSync(String(pin), Buffer.from(salt, "base64url"), 32).toString("base64url"), hash);
}
export const newToken = () => crypto.randomBytes(32).toString("base64url");
export const tokenHash = (t) => crypto.createHash("sha256").update(String(t)).digest("base64url");

// Wrong guesses: 5 tries, then that key is locked for 15 minutes.
const MAX_FAILS = 5, LOCK_MIN = 15;
export async function throttled(key) {
  const r = await db().query("select fails, locked_until from bm_throttle where key = $1", [key]);
  const t = r.rows[0];
  return t?.locked_until && new Date(t.locked_until) > new Date() ? Math.ceil((new Date(t.locked_until) - new Date()) / 60000) : 0;
}
export async function failed(key) {
  await db().query(`insert into bm_throttle (key, fails) values ($1, 1)
    on conflict (key) do update set fails = case when bm_throttle.locked_until < now() then 1 else bm_throttle.fails + 1 end,
      locked_until = case when (case when bm_throttle.locked_until < now() then 1 else bm_throttle.fails + 1 end) >= ${MAX_FAILS}
        then now() + interval '${LOCK_MIN} minutes' else null end`, [key]);
}
export async function cleared(key) { await db().query("delete from bm_throttle where key = $1", [key]); }
