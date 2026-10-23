// Shared database + auth helpers for the ledger API (Vercel Node functions).
import crypto from "node:crypto";
import pg from "pg";

pg.types.setTypeParser(1082, (v) => v); // keep DATE columns as plain YYYY-MM-DD strings

let pool;
let ready;

export function db() {
  if (!pool) {
    const url = (process.env.DATABASE_URL || "").replace(/[?&]channel_binding=[^&]*/, "");
    const local = /localhost|127\.0\.0\.1/.test(url);
    pool = new pg.Pool({ connectionString: url, max: 3, ssl: local ? false : { rejectUnauthorized: true } });
  }
  return pool;
}

export async function ensureSchema() {
  if (!ready) {
    ready = db().query(`
      create table if not exists vic_predictions (
        id bigint generated always as identity primary key,
        created_at timestamptz not null default now(),
        seat text not null,
        probs jsonb not null,          -- your probability per outcome
        backed text,                   -- outcome you staked on
        stake integer not null default 0 check (stake >= 0),
        price_p numeric,               -- market (or model) probability of the backed outcome at lock time
        price_source text,
        model_probs jsonb,             -- model probabilities at lock time
        adjustments jsonb,             -- driver changes behind this call
        note text
      );
      create index if not exists vic_predictions_seat on vic_predictions (seat, created_at);
      create table if not exists vic_market_odds (
        id bigint generated always as identity primary key,
        created_at timestamptz not null default now(),
        seat text not null,
        source text not null,
        as_of date,
        odds jsonb not null,           -- decimal odds per outcome as quoted
        implied jsonb not null         -- probabilities with the bookmaker margin removed
      );
      create index if not exists vic_market_odds_seat on vic_market_odds (seat, created_at);
    `);
  }
  return ready;
}

export function authorised(req) {
  const want = process.env.LEDGER_PASSCODE || "";
  const got = String(req.headers["x-ledger-passcode"] || "");
  if (!want || got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

export async function readBody(req) {
  if (req.body !== undefined) return typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString() || "{}");
}

export const BUDGET = 1000;
export const SEAT_RE = /^(statewide|[a-z]+(-[a-z]+)*)$/;
