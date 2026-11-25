#!/usr/bin/env bash
# Valida server/db/schema.sql em uma instância PostgreSQL temporária.
# Requer os binários do PostgreSQL (initdb, pg_ctl, psql) no PATH ou em /usr/lib/postgresql/*/bin.
set -euo pipefail
BIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1 || true)
export PATH="$BIN:$PATH"
DIR=$(mktemp -d)
PORT=${PGPORT_TEST:-55432}
RUNAS=""
if [ "$(id -u)" = "0" ]; then
  id veu_pg >/dev/null 2>&1 || useradd -M veu_pg
  chown -R veu_pg "$DIR"
  RUNAS="runuser -u veu_pg --"
fi
$RUNAS initdb -D "$DIR/data" -A trust -U postgres >/dev/null
$RUNAS pg_ctl -D "$DIR/data" -o "-p $PORT -k $DIR" -l "$DIR/log" start -w >/dev/null
trap '$RUNAS pg_ctl -D "$DIR/data" stop -m fast >/dev/null; rm -rf "$DIR"' EXIT
psql -h "$DIR" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -f "$(dirname "$0")/../server/db/schema.sql"
psql -h "$DIR" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -f "$(dirname "$0")/../server/db/schema.sql"  # idempotente
psql -h "$DIR" -p "$PORT" -U postgres -At -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"
# regras que protegem contra duplicação/manipulação
Q() { psql -h "$DIR" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -At -c "$1"; }
Q "INSERT INTO users (id, username, username_lower, pass_hash, salt, loadout, stats) VALUES ('u1','ana','ana','h','s','{}','{}')" >/dev/null
Q "INSERT INTO code_redemptions (code, user_id) VALUES ('PARAENSE01','u1')" >/dev/null
if Q "INSERT INTO code_redemptions (code, user_id) VALUES ('PARAENSE01','u1')" >/dev/null 2>&1; then echo "FALHOU: resgate duplicado aceito"; exit 1; else echo "ok: resgate duplicado recusado"; fi
if Q "UPDATE users SET total_xp = 500000098000 WHERE id='u1'" >/dev/null 2>&1; then echo "ok: XP sem teto (500 bilhões aceitos)"; else echo "FALHOU: XP alto recusado"; exit 1; fi
if Q "UPDATE users SET total_xp = -1 WHERE id='u1'" >/dev/null 2>&1; then echo "FALHOU: XP negativo aceito"; exit 1; else echo "ok: XP negativo recusado"; fi
Q "INSERT INTO week_scores (user_id, week_id, xp) VALUES ('u1','2026-11-23',400)" >/dev/null
if Q "INSERT INTO week_scores (user_id, week_id, xp) VALUES ('u1','2026-11-23',10)" >/dev/null 2>&1; then echo "FALHOU: semana duplicada"; exit 1; else echo "ok: uma pontuação por conta e semana"; fi
if Q "INSERT INTO upgrades VALUES ('u1','vida',5)" >/dev/null 2>&1; then echo "ok: melhoria 'vida' aceita"; else echo "FALHOU: melhoria vida"; exit 1; fi
if Q "INSERT INTO upgrades VALUES ('u1','estamina',6)" >/dev/null 2>&1; then echo "FALHOU: melhoria nível 6 aceita"; exit 1; else echo "ok: melhoria acima do nível 5 recusada"; fi
if Q "UPDATE users SET coins = -1 WHERE id='u1'" >/dev/null 2>&1; then echo "FALHOU: saldo negativo aceito"; exit 1; else echo "ok: saldo negativo recusado"; fi
echo "PARAENSE01: $(Q "SELECT reward_coins || ' moedas, nível máximo=' || max_level FROM gift_codes WHERE code='PARAENSE01'")"
echo "1MPARAENSE: $(Q "SELECT reward_coins FROM gift_codes WHERE code='1MPARAENSE'") · 2MPARAENSE: $(Q "SELECT reward_coins FROM gift_codes WHERE code='2MPARAENSE'")"
