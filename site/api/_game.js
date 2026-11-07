// Ballot Miner storage: teams, players, sessions, and append-only calls, bets and vote forecasts.
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "./_db.js";

export const BANKROLL = 1000;
export const SEAT_CAP = 100;
export const CLOSE = new Date("2026-11-27T07:00:00Z"); // 6pm Melbourne, Fri 27 Nov
export const VOTE_KEYS = ["ALP", "LNP", "ON", "GRN", "OTHERS"];

let ready;
export function ensureGame() {
  if (!ready) {
    ready = (async () => {
      await db().query(`
        create table if not exists bm_teams (
          code text primary key,             -- what players type to join
          name text not null unique,
          created_at timestamptz not null default now()
        );
        create table if not exists bm_players (
          id bigint generated always as identity primary key,
          team text not null references bm_teams(name) on update cascade,
          name text not null,
          pin_hash text not null,
          organiser boolean not null default false,
          created_at timestamptz not null default now()
        );
        create unique index if not exists bm_players_name on bm_players (lower(name));
        create table if not exists bm_sessions (
          token_hash text primary key,
          player_id bigint not null references bm_players(id) on delete cascade,
          created_at timestamptz not null default now()
        );
        create table if not exists bm_calls (
          id bigint generated always as identity primary key,
          player_id bigint not null references bm_players(id) on delete cascade,
          seat text not null, pick text not null, why text not null default '',
          created_at timestamptz not null default now()
        );
        create table if not exists bm_bets (
          id bigint generated always as identity primary key,
          player_id bigint not null references bm_players(id) on delete cascade,
          seat text not null, pick text not null,
          stake integer not null check (stake > 0),
          odds numeric not null, odds_as_of text,
          created_at timestamptz not null default now()
        );
        create table if not exists bm_votes (
          id bigint generated always as identity primary key,
          player_id bigint not null references bm_players(id) on delete cascade,
          vote jsonb not null, why text not null default '',
          created_at timestamptz not null default now()
        );
        create table if not exists bm_throttle (
          key text primary key, fails integer not null default 0, locked_until timestamptz
        );`);
      // First run: the two teams, each with a code that can't be guessed. The admin page shows them.
      const code = (n) => `${n.toLowerCase().replace(/[^a-z]/g, "")}-${crypto.randomInt(1000, 10000)}`;
      await db().query(`insert into bm_teams (code, name) values ($1, 'Alliance'), ($2, 'AI Mates') on conflict do nothing`, [code("alliance"), code("aimates")]);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

// Seat list and Sportsbet prices, from the same file players see. Bets are priced here, not by the browser.
let seats, seatsAt = 0;
export function seatData() {
  if (!seats || Date.now() - seatsAt > 60_000) {
    const D = JSON.parse(readFileSync(join(process.cwd(), "play", "data", "office.json"), "utf8"));
    seats = Object.fromEntries(D.seats.map((s) => [s.slug, s]));
    seatsAt = Date.now();
  }
  return seats;
}

export const closed = () => Date.now() >= CLOSE.getTime();
export const playerOut = (p) => ({ id: Number(p.id), name: p.name, team: p.team, organiser: p.organiser });
