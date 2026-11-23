-- VÉU: Ecos da Ruptura — schema PostgreSQL (alvo de produção).
-- Espelha server/store.ts (UserRecord, SessionRecord, MatchHistoryEntry).
-- Aplicar com: psql "$DATABASE_URL" -f server/db/schema.sql

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  username        TEXT NOT NULL,
  username_lower  TEXT NOT NULL UNIQUE,
  pass_hash       TEXT NOT NULL,
  salt            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  total_xp        INTEGER NOT NULL DEFAULT 0,
  coins           INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0),
  mastery_xp      INTEGER NOT NULL DEFAULT 0,
  loadout         JSONB NOT NULL,
  stats           JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires     TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS purchases (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cosmetic_id  TEXT NOT NULL,
  bought_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, cosmetic_id)
);

CREATE TABLE IF NOT EXISTS achievements (
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id  TEXT NOT NULL,
  unlocked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, achievement_id)
);

CREATE TABLE IF NOT EXISTS season_progress (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id  TEXT NOT NULL,
  xp         INTEGER NOT NULL DEFAULT 0,
  claimed    INTEGER[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (user_id, season_id)
);

CREATE TABLE IF NOT EXISTS matches (
  id          TEXT PRIMARY KEY,
  map_id      TEXT NOT NULL,
  winner      TEXT NOT NULL CHECK (winner IN ('survivors','entity')),
  reason      TEXT NOT NULL,
  duration_s  INTEGER NOT NULL,
  played_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS match_players (
  match_id  TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL CHECK (role IN ('survivor','entity')),
  outcome   TEXT NOT NULL,
  score     INTEGER NOT NULL,
  xp        INTEGER NOT NULL,
  coins     INTEGER NOT NULL,
  PRIMARY KEY (match_id, user_id)
);
CREATE INDEX IF NOT EXISTS match_players_user_idx ON match_players(user_id);
