-- Forecast tracker schema
-- questions -> sources (where a crowd forecast lives) -> snapshots (daily readings)
-- plus filings (EDGAR), news_volume (GDELT), forecasts (yours), variables (register), signals (log)

create table if not exists questions (
  id            text primary key,              -- e.g. 'anthropic-ipo-month'
  title         text not null,
  kind          text not null check (kind in ('binary','multiple_choice','date','numeric')),
  outcomes      text[],                        -- for multiple_choice, in display order
  resolution    text,                          -- resolution criteria in plain words
  close_date    date,
  resolved_at   timestamptz,
  resolved_outcome text,
  created_at    timestamptz not null default now()
);

create table if not exists sources (
  id            bigint generated always as identity primary key,
  question_id   text not null references questions(id) on delete cascade,
  platform      text not null check (platform in ('manifold','polymarket','metaculus')),
  external_id   text not null,                 -- slug or numeric id on that platform
  url           text,
  outcome_map   jsonb,                         -- optional: platform answer text -> our outcome label
  active        boolean not null default true,
  unique (platform, external_id)
);

create table if not exists snapshots (
  id            bigint generated always as identity primary key,
  source_id     bigint not null references sources(id) on delete cascade,
  captured_on   date not null,                 -- one reading per source per outcome per day
  captured_at   timestamptz not null default now(),
  outcome       text not null,                 -- 'YES' for binary, else the answer label
  probability   numeric(6,5) not null check (probability between 0 and 1),
  volume        numeric,
  traders       integer,
  unique (source_id, captured_on, outcome)
);

create table if not exists filings (
  accession_no  text primary key,
  company       text not null,                 -- 'Anthropic' | 'OpenAI'
  form_type     text not null,                 -- S-1, S-1/A, 424B4 ...
  filed_on      date not null,
  url           text,
  first_seen_at timestamptz not null default now()
);

create table if not exists news_volume (
  query         text not null,
  day           date not null,
  source        text not null default 'gdelt',
  value         numeric not null,              -- GDELT: % of all monitored articles that day
  primary key (query, day, source)
);

create table if not exists forecasts (
  id            bigint generated always as identity primary key,
  question_id   text not null references questions(id) on delete cascade,
  made_on       date not null default current_date,
  outcome       text not null,
  probability   numeric(6,5) not null check (probability between 0 and 1),
  rationale     text,
  unique (question_id, made_on, outcome)
);

create table if not exists variables (
  id            text primary key,              -- e.g. 'anthropic-ipo-valuation'
  name          text not null,
  estimate      text,
  source_url    text,
  update_trigger text,
  updated_at    timestamptz not null default now()
);

create table if not exists signals (
  id            bigint generated always as identity primary key,
  occurred_on   date not null,
  kind          text not null,                 -- 'filing' | 'news' | 'market_move' | 'statement'
  description   text not null,
  url           text,
  variable_id   text references variables(id),
  created_at    timestamptz not null default now()
);

create index if not exists snapshots_source_day on snapshots (source_id, captured_on);
create index if not exists forecasts_question on forecasts (question_id, made_on);

-- Latest crowd reading per question/platform/outcome, for the dashboard
create or replace view latest_snapshots with (security_invoker = true) as
select distinct on (s.source_id, s.outcome)
  src.question_id, src.platform, s.outcome, s.probability, s.captured_on, s.traders, s.volume
from snapshots s join sources src on src.id = s.source_id
order by s.source_id, s.outcome, s.captured_on desc;
