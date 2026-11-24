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

-- ------------------------------------------------------------------ v0.2: progressão, social, códigos
-- nível é derivado de total_xp (teto do nível 50 = 98.000 XP, ver shared/progression.ts)
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_total_xp_cap;
ALTER TABLE users ADD CONSTRAINT users_total_xp_cap CHECK (total_xp >= 0 AND total_xp <= 98000);

-- melhorias permanentes (níveis 0..5)
CREATE TABLE IF NOT EXISTS upgrades (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  upgrade_id  TEXT NOT NULL CHECK (upgrade_id IN ('estamina','recuperacao','velocidade','resistencia','interacao','m_velocidade','m_resistencia','m_ataque','m_recarga','m_eficiencia')),
  level       SMALLINT NOT NULL CHECK (level BETWEEN 0 AND 5),
  PRIMARY KEY (user_id, upgrade_id)
);

-- amizades (par guardado uma vez, menor id primeiro) e solicitações pendentes
CREATE TABLE IF NOT EXISTS friendships (
  user_a      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  since       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b)
);
CREATE INDEX IF NOT EXISTS friendships_b_idx ON friendships(user_b);

CREATE TABLE IF NOT EXISTS friend_requests (
  from_user   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (from_user, to_user),
  CHECK (from_user <> to_user)
);
CREATE INDEX IF NOT EXISTS friend_requests_to_idx ON friend_requests(to_user);

-- códigos de presente (administrador cadastra; PARAENSE01 é criado na primeira inicialização)
CREATE TABLE IF NOT EXISTS gift_codes (
  code          TEXT PRIMARY KEY CHECK (code ~ '^[A-Z0-9_-]{4,24}$'),
  reward_coins  INTEGER NOT NULL DEFAULT 0 CHECK (reward_coins >= 0),
  reward_xp     INTEGER NOT NULL DEFAULT 0 CHECK (reward_xp >= 0),
  max_level     BOOLEAN NOT NULL DEFAULT false,
  max_uses      INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
  uses          INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0),
  expires_at    TIMESTAMPTZ,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO gift_codes (code, reward_coins, max_level) VALUES ('PARAENSE01', 20000, true) ON CONFLICT (code) DO NOTHING;

-- uma linha por conta e código: a chave primária impede resgate duplicado
CREATE TABLE IF NOT EXISTS code_redemptions (
  code         TEXT NOT NULL REFERENCES gift_codes(code) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redeemed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (code, user_id)
);

-- histórico de recompensas (partida, conquista, temporada, nível, código, melhoria, loja)
CREATE TABLE IF NOT EXISTS reward_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  source      TEXT NOT NULL CHECK (source IN ('partida','conquista','temporada','nivel','codigo','melhoria','loja')),
  descr       TEXT NOT NULL,
  xp          INTEGER NOT NULL DEFAULT 0,
  coins       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS reward_log_user_idx ON reward_log(user_id, at DESC);

-- uma partida só recompensa a mesma conta uma vez
CREATE TABLE IF NOT EXISTS rewarded_matches (
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id  TEXT NOT NULL,
  PRIMARY KEY (user_id, match_id)
);

-- ranking: índices para ordenar por XP
CREATE INDEX IF NOT EXISTS users_rank_xp_idx ON users(total_xp DESC, created_at);
